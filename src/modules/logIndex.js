import crypto from 'node:crypto';
import fs from 'fs';
import { createRequire } from 'node:module';
import os from 'os';
import path from 'path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import util from 'node:util';
import { Worker } from 'node:worker_threads';
import log from 'electron-log';
import {
  createParsingContext,
  mergeLogMetadata,
  parseLogLine
} from './logParser.js';

const INDEX_STREAM_HIGH_WATER_MARK = 256 * 1024;
const INDEX_BATCH_SIZE = 2000;
const INDEX_PROGRESS_INTERVAL_MS = 150;
const INDEX_YIELD_EVERY_N_LINES = 10000;
const SQLITE_FTS5_TABLE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS log_lines_fts USING fts5(
    group_id,
    title,
    content,
    metadata_text,
    tokenize = 'unicode61'
  );
`;
const SQLITE_LOG_LINES_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_log_lines_line_number ON log_lines(line_number);
  CREATE INDEX IF NOT EXISTS idx_log_lines_group_id ON log_lines(group_id, line_number);
`;
const SQLITE_DROP_LOG_LINES_INDEXES_SQL = `
  DROP INDEX IF EXISTS idx_log_lines_line_number;
  DROP INDEX IF EXISTS idx_log_lines_group_id;
`;
const SQLITE_LOG_GROUPS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_log_groups_last_line_number ON log_groups(last_line_number DESC);
  CREATE INDEX IF NOT EXISTS idx_log_groups_first_line_number ON log_groups(first_line_number);
`;
const DISK_SEARCH_TIMESTAMP = new Date(0).toISOString();

let BetterSqlite3 = null;
let sqliteSupported = null;
let indexStorageDirectory = path.join(os.tmpdir(), 'logspect-indexes');
let activeIndexJob = null;
let onLogIndexStatusCallback = null;
const require = createRequire(import.meta.url);

const createEmptyIndexStatus = (overrides = {}) => ({
  logFilePath: '',
  dbPath: '',
  status: 'idle',
  progressPercent: 0,
  bytesIndexed: 0,
  totalBytes: 0,
  indexedLines: 0,
  backend: 'sqlite',
  error: null,
  ...overrides
});

let currentIndexStatus = createEmptyIndexStatus();

const buildIndexStatus = ({
  logFilePath,
  dbPath = '',
  status,
  totalBytes = 0,
  bytesIndexed = 0,
  indexedLines = 0,
  backend = 'sqlite',
  error = null
}) => {
  const safeTotalBytes = Math.max(0, totalBytes);
  const safeBytesIndexed = Math.min(Math.max(0, bytesIndexed), safeTotalBytes);

  return createEmptyIndexStatus({
    logFilePath,
    dbPath,
    status,
    progressPercent: safeTotalBytes === 0
      ? 100
      : Math.min(100, Math.round((safeBytesIndexed / safeTotalBytes) * 100)),
    bytesIndexed: safeBytesIndexed,
    totalBytes: safeTotalBytes,
    indexedLines,
    backend,
    error
  });
};

const emitIndexStatus = (payload) => {
  currentIndexStatus = payload;

  if (onLogIndexStatusCallback) {
    onLogIndexStatusCallback(payload);
  }
};

const yieldToEventLoop = () => (
  new Promise((resolve) => {
    setImmediate(resolve);
  })
);

const shouldRunIndexInProcess = () => (
  process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getIndexWorkerPath = () => (
  path.join(__dirname, 'logIndexWorker.js')
);

const buildWorkerExecArgv = () => (
  process.execArgv.filter(arg => !arg.startsWith('--input-type'))
);

const loadSqlite = () => {
  if (sqliteSupported === false) {
    return null;
  }

  if (BetterSqlite3) {
    return BetterSqlite3;
  }

  try {
    const loadedModule = require('better-sqlite3');
    BetterSqlite3 = loadedModule.default || loadedModule;
    sqliteSupported = true;
    return BetterSqlite3;
  } catch (error) {
    sqliteSupported = false;
    log.warn?.('better-sqlite3 is not available in this runtime:', error);
    return null;
  }
};

const ensureIndexStorageDirectory = async () => {
  await fs.promises.mkdir(indexStorageDirectory, { recursive: true });
};

const buildFileKey = (logFilePath) => (
  crypto.createHash('sha256').update(path.resolve(logFilePath)).digest('hex')
);

const getIndexDatabasePath = async (logFilePath) => {
  await ensureIndexStorageDirectory();
  return path.join(indexStorageDirectory, `${buildFileKey(logFilePath)}.sqlite`);
};

const hasTable = (db, tableName) => Boolean(
  db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE name = ?
    LIMIT 1
  `).get(tableName)
);

const supportsFts5 = (db) => Boolean(
  db.prepare(`
    SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled
  `).get().enabled
);

const openDatabase = async (dbPath) => {
  const SQLiteDatabase = loadSqlite();
  if (!SQLiteDatabase) {
    return null;
  }

  const db = new SQLiteDatabase(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE IF NOT EXISTS index_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      log_file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_mtime_ms INTEGER NOT NULL,
      indexed_bytes INTEGER NOT NULL,
      indexed_line_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_lines (
      id INTEGER PRIMARY KEY,
      line_number INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      type TEXT NOT NULL,
      sub_type TEXT NOT NULL,
      success INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      metadata_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_groups (
      group_id TEXT PRIMARY KEY,
      first_line_number INTEGER NOT NULL,
      last_line_number INTEGER NOT NULL,
      entries_count INTEGER NOT NULL
    );
  `);
  ensureLogLineIndexes(db);
  ensureLogGroupIndexes(db);
  ensureLogGroupsBackfilled(db);

  const supportsFts = supportsFts5(db);

  if (supportsFts) {
    db.exec(SQLITE_FTS5_TABLE_SQL);
  } else {
    log.warn('better-sqlite3 was loaded without FTS5 support. Falling back to plain SQLite text search.');
  }

  return {
    db,
    supportsFts
  };
};

const getPersistedIndexState = (db) => (
  db.prepare(`
    SELECT
      id,
      log_file_path AS logFilePath,
      file_size AS fileSize,
      file_mtime_ms AS fileMtimeMs,
      indexed_bytes AS indexedBytes,
      indexed_line_count AS indexedLineCount,
      status,
      updated_at AS updatedAt
    FROM index_state
    WHERE id = 1
  `).get()
);

const saveIndexState = (db, {
  logFilePath,
  fileSize,
  fileMtimeMs,
  indexedBytes,
  indexedLineCount,
  status
}) => {
  db.prepare(`
    INSERT INTO index_state (
      id,
      log_file_path,
      file_size,
      file_mtime_ms,
      indexed_bytes,
      indexed_line_count,
      status,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      log_file_path = excluded.log_file_path,
      file_size = excluded.file_size,
      file_mtime_ms = excluded.file_mtime_ms,
      indexed_bytes = excluded.indexed_bytes,
      indexed_line_count = excluded.indexed_line_count,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    logFilePath,
    fileSize,
    fileMtimeMs,
    indexedBytes,
    indexedLineCount,
    status,
    Date.now()
  );
};

const clearExistingIndexData = (db) => {
  db.exec('DELETE FROM log_lines;');
  db.exec('DELETE FROM log_groups;');

  if (hasTable(db, 'log_lines_fts')) {
    db.exec('DELETE FROM log_lines_fts;');
  }
};

const ensureLogLineIndexes = (db) => {
  db.exec(SQLITE_LOG_LINES_INDEXES_SQL);
};

const dropLogLineIndexes = (db) => {
  db.exec(SQLITE_DROP_LOG_LINES_INDEXES_SQL);
};

const ensureLogGroupIndexes = (db) => {
  db.exec(SQLITE_LOG_GROUPS_INDEXES_SQL);
};

const resetFtsTable = (db, supportsFts) => {
  if (!supportsFts) {
    return;
  }

  db.exec('DROP TABLE IF EXISTS log_lines_fts;');
  db.exec(SQLITE_FTS5_TABLE_SQL);
};

const backfillFtsTableFromLogLines = (db, supportsFts) => {
  if (!supportsFts) {
    return;
  }

  db.exec(`
    INSERT INTO log_lines_fts (
      rowid,
      group_id,
      title,
      content,
      metadata_text
    )
    SELECT
      id,
      group_id,
      title,
      content,
      metadata_text
    FROM log_lines
    ORDER BY id ASC
  `);
};

const hasIndexedRows = (db) => Boolean(
  db.prepare(`
    SELECT 1
    FROM log_lines
    LIMIT 1
  `).get()
);

const hasIndexedGroups = (db) => Boolean(
  db.prepare(`
    SELECT 1
    FROM log_groups
    LIMIT 1
  `).get()
);

const backfillLogGroupsFromLogLines = (db) => {
  db.exec('DELETE FROM log_groups;');
  db.exec(`
    INSERT INTO log_groups (
      group_id,
      first_line_number,
      last_line_number,
      entries_count
    )
    SELECT
      group_id,
      MIN(line_number),
      MAX(line_number),
      COUNT(*)
    FROM log_lines
    GROUP BY group_id
  `);
};

const ensureLogGroupsBackfilled = (db) => {
  if (!hasIndexedRows(db) || hasIndexedGroups(db)) {
    return;
  }

  log.info('Backfilling log_groups from existing indexed rows');
  backfillLogGroupsFromLogLines(db);
};

const canReadPersistedIndex = (db, persistedState, logFilePath) => {
  if (!persistedState) {
    return false;
  }

  if (persistedState.logFilePath !== path.resolve(logFilePath)) {
    return false;
  }

  if (persistedState.status === 'ready') {
    return true;
  }

  return (
    persistedState.status === 'indexing' &&
    persistedState.indexedBytes > 0 &&
    persistedState.indexedLineCount > 0 &&
    hasIndexedRows(db)
  );
};

const buildIndexedCoverageState = (persistedState, stats) => {
  const coveredBytes = Math.min(persistedState.indexedBytes || 0, stats.size);
  const coverageComplete = (
    persistedState.status === 'ready' &&
    persistedState.fileSize === stats.size &&
    persistedState.indexedBytes === stats.size &&
    persistedState.fileMtimeMs === stats.mtimeMs
  );

  return {
    coveredBytes,
    coverageComplete,
    totalBytes: stats.size,
    indexedLineCount: persistedState.indexedLineCount || 0,
    needsRefresh: !coverageComplete
  };
};

const createIndexRecord = (rawLine, lineNumber, context) => {
  const parsed = parseLogLine(rawLine, {
    context,
    lineNumber,
    fallbackGrouping: 'line-number'
  });

  if (!parsed?.uuid || !parsed.logInfo) {
    return null;
  }

  return {
    lineNumber,
    groupId: parsed.uuid,
    content: util.stripVTControlCharacters(parsed.content).trim(),
    type: parsed.logInfo.type || 'unknown',
    subType: parsed.logInfo.subType || 'unknown',
    success: parsed.logInfo.success,
    title: parsed.logInfo.title || 'Search Match',
    metadataJson: JSON.stringify(parsed.logInfo.metadata || {}),
    metadataText: Object.values(parsed.logInfo.metadata || {}).join(' ')
  };
};

const withTransaction = (db, callback) => {
  db.exec('BEGIN');

  try {
    callback();
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      log.error('Failed to rollback SQLite transaction:', rollbackError);
    }

    throw error;
  }
};

const isFtsIndexUsable = (db) => {
  if (!hasTable(db, 'log_lines_fts')) {
    return false;
  }

  if (!hasIndexedRows(db)) {
    return true;
  }

  return Boolean(
    db.prepare(`
      SELECT rowid
      FROM log_lines_fts
      LIMIT 1
    `).get()
  );
};

const determineIndexMode = (persistedState, stats, logFilePath, forceRebuild, { db, supportsFts }) => {
  if (forceRebuild || !persistedState) {
    return {
      mode: 'rebuild',
      indexedBytes: 0,
      indexedLineCount: 0
    };
  }

  if (persistedState.logFilePath !== path.resolve(logFilePath)) {
    return {
      mode: 'rebuild',
      indexedBytes: 0,
      indexedLineCount: 0
    };
  }

  if (stats.size < persistedState.indexedBytes) {
    return {
      mode: 'rebuild',
      indexedBytes: 0,
      indexedLineCount: 0
    };
  }

  if (persistedState.status !== 'ready') {
    return {
      mode: 'rebuild',
      indexedBytes: 0,
      indexedLineCount: 0
    };
  }

  if (supportsFts && !isFtsIndexUsable(db)) {
    return {
      mode: 'rebuild',
      indexedBytes: 0,
      indexedLineCount: 0
    };
  }

  if (stats.size === persistedState.indexedBytes && persistedState.status === 'ready') {
    return {
      mode: 'ready',
      indexedBytes: persistedState.indexedBytes,
      indexedLineCount: persistedState.indexedLineCount
    };
  }

  return {
    mode: 'append',
    indexedBytes: persistedState.indexedBytes,
    indexedLineCount: persistedState.indexedLineCount
  };
};

const flushBatch = (db, batch, insertLineStatement, insertFtsStatement, upsertGroupStatement) => {
  if (batch.length === 0) {
    return;
  }

  withTransaction(db, () => {
    const insertedGroups = new Map();

    batch.forEach((record) => {
      const result = insertLineStatement.run(
        record.lineNumber,
        record.groupId,
        record.type,
        record.subType,
        record.success === null || record.success === undefined ? null : (record.success ? 1 : 0),
        record.title,
        record.content,
        record.metadataJson,
        record.metadataText,
        record.lineNumber
      );

      if (result.changes === 0) {
        return;
      }

      if (insertFtsStatement) {
        insertFtsStatement.run(
          result.lastInsertRowid,
          record.groupId,
          record.title,
          record.content,
          record.metadataText
        );
      }

      const existingGroup = insertedGroups.get(record.groupId);
      if (existingGroup) {
        existingGroup.firstLineNumber = Math.min(existingGroup.firstLineNumber, record.lineNumber);
        existingGroup.lastLineNumber = Math.max(existingGroup.lastLineNumber, record.lineNumber);
        existingGroup.entriesCount += 1;
        return;
      }

      insertedGroups.set(record.groupId, {
        groupId: record.groupId,
        firstLineNumber: record.lineNumber,
        lastLineNumber: record.lineNumber,
        entriesCount: 1
      });
    });

    insertedGroups.forEach((group) => {
      upsertGroupStatement.run(
        group.groupId,
        group.firstLineNumber,
        group.lastLineNumber,
        group.entriesCount
      );
    });
  });

  batch.length = 0;
};

const isActiveIndexJob = (job) => (
  activeIndexJob && activeIndexJob.id === job.id
);

const emitIndexStatusIfCurrent = (job, payload) => {
  job.lastStatus = payload;

  if (!isActiveIndexJob(job)) {
    return;
  }

  emitIndexStatus(payload);
};

const buildUnexpectedWorkerExitStatus = (job, errorMessage) => (
  buildIndexStatus({
    logFilePath: job.logFilePath,
    dbPath: job.dbPath,
    status: 'error',
    totalBytes: job.totalBytes,
    bytesIndexed: job.lastStatus?.bytesIndexed ?? job.initialStatus.bytesIndexed,
    indexedLines: job.lastStatus?.indexedLines ?? job.initialStatus.indexedLines,
    error: errorMessage
  })
);

const attachIndexWorker = (job, task) => (
  new Promise((resolve) => {
    const worker = new Worker(getIndexWorkerPath(), {
      workerData: task,
      execArgv: buildWorkerExecArgv()
    });

    let settled = false;
    job.worker = worker;

    const finalize = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      job.worker = null;

      if (isActiveIndexJob(job)) {
        activeIndexJob = null;
      }

      resolve(result);
    };

    worker.on('message', (message) => {
      if (message?.type === 'status') {
        emitIndexStatusIfCurrent(job, message.payload);
        return;
      }

      if (message?.type === 'done') {
        finalize(message.payload);
      }
    });

    worker.on('error', (error) => {
      log.error('Log index worker failed:', error);

      const errorStatus = buildUnexpectedWorkerExitStatus(job, error.message);
      emitIndexStatusIfCurrent(job, errorStatus);

      finalize({
        success: false,
        message: error.message,
        status: errorStatus
      });
    });

    worker.on('exit', (code) => {
      if (settled) {
        return;
      }

      if (!job.cancelled && code !== 0) {
        const errorMessage = `Index worker exited unexpectedly with code ${code}.`;
        const errorStatus = buildUnexpectedWorkerExitStatus(job, errorMessage);
        emitIndexStatusIfCurrent(job, errorStatus);

        finalize({
          success: false,
          message: errorMessage,
          status: errorStatus
        });
        return;
      }

      finalize({
        success: job.lastStatus?.status !== 'error',
        cancelled: job.lastStatus?.status === 'cancelled',
        status: job.lastStatus || job.initialStatus,
        message: job.lastStatus?.error || null
      });
    });
  })
);

export const runLogIndexTask = async (
  {
    logFilePath,
    dbPath,
    statsSnapshot,
    mode,
    baselineState
  },
  {
    onStatus = null,
    isCancelled = () => false
  } = {}
) => {
  const emitTaskStatus = (payload) => {
    if (onStatus) {
      onStatus(payload);
    }
  };
  const database = await openDatabase(dbPath);
  if (!database) {
    const unsupportedStatus = buildIndexStatus({
      logFilePath,
      dbPath,
      status: 'unsupported',
      backend: 'scan',
      error: 'better-sqlite3 is not available in this runtime.'
    });
    emitTaskStatus(unsupportedStatus);

    return {
      success: false,
      message: unsupportedStatus.error,
      status: unsupportedStatus
    };
  }

  const { db, supportsFts } = database;
  const resolvedLogFilePath = path.resolve(logFilePath);
  const shouldOptimizeRebuild = mode === 'rebuild';
  const startByte = mode === 'append' ? baselineState.indexedBytes : 0;
  let indexedLineCount = mode === 'append' ? baselineState.indexedLineCount : 0;
  let lastProgressEmitAt = 0;
  let bytesIndexed = startByte;
  const parsingContext = createParsingContext();

  const insertLineStatement = db.prepare(`
    INSERT INTO log_lines (
      line_number,
      group_id,
      type,
      sub_type,
      success,
      title,
      content,
      metadata_json,
      metadata_text
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM log_lines
      WHERE line_number = ?
    )
  `);

  const insertFtsStatement = supportsFts && !shouldOptimizeRebuild
    ? db.prepare(`
      INSERT INTO log_lines_fts (
        rowid,
        group_id,
        title,
        content,
        metadata_text
      ) VALUES (?, ?, ?, ?, ?)
    `)
    : null;
  const upsertGroupStatement = db.prepare(`
    INSERT INTO log_groups (
      group_id,
      first_line_number,
      last_line_number,
      entries_count
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      first_line_number = MIN(log_groups.first_line_number, excluded.first_line_number),
      last_line_number = MAX(log_groups.last_line_number, excluded.last_line_number),
      entries_count = log_groups.entries_count + excluded.entries_count
  `);

  try {
    if (mode === 'rebuild') {
      dropLogLineIndexes(db);
      clearExistingIndexData(db);
      resetFtsTable(db, supportsFts);
      saveIndexState(db, {
        logFilePath: resolvedLogFilePath,
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: 0,
        indexedLineCount: 0,
        status: 'indexing'
      });
    } else {
      saveIndexState(db, {
        logFilePath: resolvedLogFilePath,
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: baselineState.indexedBytes,
        indexedLineCount: baselineState.indexedLineCount,
        status: 'indexing'
      });
    }

    if (statsSnapshot.size === 0 || startByte >= statsSnapshot.size) {
      saveIndexState(db, {
        logFilePath: resolvedLogFilePath,
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: statsSnapshot.size,
        indexedLineCount,
        status: 'ready'
      });

      const readyStatus = buildIndexStatus({
        logFilePath,
        dbPath,
        status: 'ready',
        totalBytes: statsSnapshot.size,
        bytesIndexed: statsSnapshot.size,
        indexedLines: indexedLineCount
      });
      emitTaskStatus(readyStatus);

      return {
        success: true,
        status: readyStatus
      };
    }

    const stream = fs.createReadStream(logFilePath, {
      start: startByte,
      end: statsSnapshot.size - 1,
      encoding: 'utf8',
      highWaterMark: INDEX_STREAM_HIGH_WATER_MARK
    });

    stream.on('data', (chunk) => {
      bytesIndexed += Buffer.byteLength(chunk, 'utf8');
    });

    const lineReader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    const batch = [];

    try {
      let shouldSkipLeadingBoundaryLine = mode === 'append' && startByte > 0;

      for await (const rawLine of lineReader) {
        if (isCancelled()) {
          lineReader.close();
          stream.destroy();
          break;
        }

        if (shouldSkipLeadingBoundaryLine) {
          shouldSkipLeadingBoundaryLine = false;
          if (rawLine === '') {
            continue;
          }
        }

        indexedLineCount += 1;
        const record = createIndexRecord(rawLine, indexedLineCount, parsingContext);

        if (record) {
          batch.push(record);
        }

        if (batch.length >= INDEX_BATCH_SIZE) {
          flushBatch(db, batch, insertLineStatement, insertFtsStatement, upsertGroupStatement);
        }

        if (indexedLineCount % INDEX_YIELD_EVERY_N_LINES === 0) {
          const now = Date.now();
          if (now - lastProgressEmitAt >= INDEX_PROGRESS_INTERVAL_MS) {
            lastProgressEmitAt = now;
            emitTaskStatus(buildIndexStatus({
              logFilePath,
              dbPath,
              status: 'indexing',
              totalBytes: statsSnapshot.size,
              bytesIndexed,
              indexedLines: indexedLineCount
            }));
          }

          await yieldToEventLoop();
        }
      }

      flushBatch(db, batch, insertLineStatement, insertFtsStatement, upsertGroupStatement);
    } finally {
      lineReader.close();
      stream.destroy();
    }

    if (isCancelled()) {
      const cancelledStatus = buildIndexStatus({
        logFilePath,
        dbPath,
        status: 'cancelled',
        totalBytes: statsSnapshot.size,
        bytesIndexed,
        indexedLines: indexedLineCount
      });
      emitTaskStatus(cancelledStatus);

      return {
        success: true,
        cancelled: true,
        status: cancelledStatus
      };
    }

    if (shouldOptimizeRebuild) {
      backfillFtsTableFromLogLines(db, supportsFts);
      ensureLogLineIndexes(db);
    }

    saveIndexState(db, {
      logFilePath: resolvedLogFilePath,
      fileSize: statsSnapshot.size,
      fileMtimeMs: statsSnapshot.mtimeMs,
      indexedBytes: statsSnapshot.size,
      indexedLineCount,
      status: 'ready'
    });

    const readyStatus = buildIndexStatus({
      logFilePath,
      dbPath,
      status: 'ready',
      totalBytes: statsSnapshot.size,
      bytesIndexed: statsSnapshot.size,
      indexedLines: indexedLineCount
    });
    emitTaskStatus(readyStatus);

    return {
      success: true,
      status: readyStatus
    };
  } catch (error) {
    log.error('Error indexing log file:', error);

    try {
      saveIndexState(db, {
        logFilePath: resolvedLogFilePath,
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: baselineState.indexedBytes,
        indexedLineCount: baselineState.indexedLineCount,
        status: 'error'
      });
    } catch (stateError) {
      log.error('Error writing index error state:', stateError);
    }

    const errorStatus = buildIndexStatus({
      logFilePath,
      dbPath,
      status: 'error',
      totalBytes: statsSnapshot.size,
      bytesIndexed,
      indexedLines: indexedLineCount,
      error: error.message
    });
    emitTaskStatus(errorStatus);

    return {
      success: false,
      message: error.message,
      status: errorStatus
    };
  } finally {
    db.close();
  }
};

export const setLogIndexStorageDirectory = (directoryPath) => {
  indexStorageDirectory = directoryPath;
};

export const getLogIndexStorageDirectory = () => indexStorageDirectory;

export const setLogIndexStatusCallback = (callback) => {
  onLogIndexStatusCallback = callback;
};

export const getLogIndexStatus = () => currentIndexStatus;

export const cancelLogIndexing = () => {
  if (!activeIndexJob) {
    return {
      success: true,
      message: 'No active index job to cancel.'
    };
  }

  activeIndexJob.cancelled = true;

  if (activeIndexJob.worker) {
    activeIndexJob.worker.postMessage({
      type: 'cancel'
    });
  }

  return {
    success: true,
    message: 'Log indexing cancellation requested.',
    logFilePath: activeIndexJob.logFilePath
  };
};

export const startLogIndexing = async (
  logFilePath,
  {
    forceRebuild = false,
    waitForCompletion = false
  } = {}
) => {
  const SQLiteDatabase = loadSqlite();
  if (!SQLiteDatabase) {
    const unsupportedStatus = createEmptyIndexStatus({
      logFilePath,
      status: 'unsupported',
      backend: 'scan',
      error: 'better-sqlite3 is not available in this runtime.'
    });
    emitIndexStatus(unsupportedStatus);

    return {
      success: false,
      message: unsupportedStatus.error,
      status: unsupportedStatus
    };
  }

  const stats = await fs.promises.stat(logFilePath);
  const dbPath = await getIndexDatabasePath(logFilePath);

  if (activeIndexJob && activeIndexJob.logFilePath === logFilePath) {
    if (activeIndexJob.cancelled && activeIndexJob.promise) {
      await activeIndexJob.promise;
    } else {
      if (waitForCompletion && activeIndexJob.promise) {
        await activeIndexJob.promise;
      }

      return {
        success: true,
        promise: activeIndexJob.promise || null,
        status: currentIndexStatus
      };
    }
  }

  const database = await openDatabase(dbPath);
  if (!database) {
    const unsupportedStatus = createEmptyIndexStatus({
      logFilePath,
      dbPath,
      status: 'unsupported',
      backend: 'scan',
      error: 'better-sqlite3 is not available in this runtime.'
    });
    emitIndexStatus(unsupportedStatus);

    return {
      success: false,
      message: unsupportedStatus.error,
      status: unsupportedStatus
    };
  }

  let baselineState;
  let indexMode;

  try {
    const { db, supportsFts } = database;
    const persistedState = getPersistedIndexState(db);
    const resolvedMode = determineIndexMode(
      persistedState,
      stats,
      logFilePath,
      forceRebuild,
      { db, supportsFts }
    );

    baselineState = {
      indexedBytes: resolvedMode.indexedBytes,
      indexedLineCount: resolvedMode.indexedLineCount
    };
    indexMode = resolvedMode.mode;
  } finally {
    database.db.close();
  }

  if (indexMode === 'ready') {
    const readyStatus = createEmptyIndexStatus({
      logFilePath,
      dbPath,
      status: 'ready',
      progressPercent: 100,
      bytesIndexed: stats.size,
      totalBytes: stats.size,
      indexedLines: baselineState.indexedLineCount
    });
    emitIndexStatus(readyStatus);

    return {
      success: true,
      status: readyStatus
    };
  }

  const job = {
    id: Date.now(),
    logFilePath,
    cancelled: false,
    promise: null,
    worker: null,
    dbPath,
    totalBytes: stats.size,
    initialStatus: null,
    lastStatus: null
  };
  activeIndexJob = job;

  const indexingStatus = buildIndexStatus({
    logFilePath,
    dbPath,
    status: 'indexing',
    totalBytes: stats.size,
    bytesIndexed: baselineState.indexedBytes,
    indexedLines: baselineState.indexedLineCount
  });
  job.initialStatus = indexingStatus;
  job.lastStatus = indexingStatus;
  emitIndexStatus(indexingStatus);

  const task = {
    logFilePath,
    dbPath,
    statsSnapshot: {
      size: stats.size,
      mtimeMs: stats.mtimeMs
    },
    mode: indexMode,
    baselineState
  };

  job.promise = shouldRunIndexInProcess()
    ? runLogIndexTask(task, {
      onStatus: (payload) => {
        emitIndexStatusIfCurrent(job, payload);
      },
      isCancelled: () => job.cancelled
    }).finally(() => {
      if (isActiveIndexJob(job)) {
        activeIndexJob = null;
      }
    })
    : attachIndexWorker(job, task);

  if (waitForCompletion) {
    await job.promise;
  } else {
    void job.promise;
  }

  return {
    success: true,
    promise: job.promise,
    status: indexingStatus
  };
};

export const getIndexedLogViewState = async (logFilePath) => {
  const dbPath = await getIndexDatabasePath(logFilePath);
  const database = await openDatabase(dbPath);
  if (!database) {
    return {
      success: false,
      reason: 'sqlite_unavailable'
    };
  }

  const { db } = database;
  try {
    const stats = await fs.promises.stat(logFilePath);
    const persistedState = getPersistedIndexState(db);

    if (!canReadPersistedIndex(db, persistedState, logFilePath)) {
      return {
        success: false,
        reason: 'not_ready'
      };
    }

    return {
      success: true,
      dbPath,
      ...buildIndexedCoverageState(persistedState, stats)
    };
  } finally {
    db.close();
  }
};

const buildFtsQuery = (query) => {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  if (tokens.some(token => token.length < 2)) {
    return null;
  }

  return tokens
    .map(token => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ');
};

const normalizeLikeQueryTokens = (query) => (
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
);

const escapeLikePattern = (token) => token.replace(/[\\%_]/g, '\\$&');

const parseMatchedLineNumbers = (value) => (
  String(value || '')
    .split(',')
    .map(candidate => Number(candidate))
    .filter(candidate => Number.isInteger(candidate))
    .sort((left, right) => left - right)
);

const buildIndexedResults = (
  groupRows,
  {
    matchedGroups,
    matchedLines,
    indexedLineCount,
    maxGroups,
    truncated = false
  }
) => {
  const resultsByGroup = new Map();
  const matchedGroupsById = new Map(
    matchedGroups.map(group => [
      group.groupId,
      {
        firstLineNumber: group.firstMatchedLineNumber,
        lastLineNumber: group.lastMatchedLineNumber,
        matchedLineCount: group.matchedLineCount,
        matchedLineNumbers: parseMatchedLineNumbers(group.matchedLineNumbers)
      }
    ])
  );

  groupRows.forEach((row) => {
    const matchedGroup = matchedGroupsById.get(row.groupId);
    if (!matchedGroup) {
      return;
    }

    let group = resultsByGroup.get(row.groupId);

    if (!group) {
      if (resultsByGroup.size >= maxGroups) {
        return;
      }

      group = {
        uuid: row.groupId,
        type: row.type || 'unknown',
        subType: row.subType || 'unknown',
        success: row.success === null || row.success === undefined ? null : Boolean(row.success),
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {},
        title: row.title || 'Search Match',
        entriesCount: 0,
        firstSeen: DISK_SEARCH_TIMESTAMP,
        lastSeen: DISK_SEARCH_TIMESTAMP,
        entries: [],
        searchMeta: {
          isDiskSearchResult: true,
          firstLineNumber: matchedGroup.firstLineNumber,
          lastLineNumber: matchedGroup.lastLineNumber,
          groupFirstLineNumber: row.lineNumber,
          groupLastLineNumber: row.lineNumber,
          matchedLineCount: matchedGroup.matchedLineCount,
          matchedLineNumbers: [...matchedGroup.matchedLineNumbers],
          hasHiddenMatches: false
        }
      };

      resultsByGroup.set(row.groupId, group);
    }

    group.entriesCount += 1;
    if (row.success !== null && row.success !== undefined && group.success === null) {
      group.success = Boolean(row.success);
    }
    if (row.metadataJson) {
      group.metadata = mergeLogMetadata(group.metadata, JSON.parse(row.metadataJson));
    }
    group.searchMeta.groupFirstLineNumber = Math.min(group.searchMeta.groupFirstLineNumber, row.lineNumber);
    group.searchMeta.groupLastLineNumber = Math.max(group.searchMeta.groupLastLineNumber, row.lineNumber);
    group.entries.push({
      content: row.content,
      timestamp: DISK_SEARCH_TIMESTAMP,
      lineNumber: row.lineNumber,
      isMatch: matchedGroup.matchedLineNumbers.includes(row.lineNumber)
    });
  });

  const shownGroups = resultsByGroup.size;

  return {
    backend: 'sqlite',
    results: {
      totalEntries: shownGroups,
      entries: Array.from(resultsByGroup.values())
    },
    summary: {
      matchedLines,
      shownGroups,
      scannedLines: indexedLineCount,
      truncated
    }
  };
};

const fetchIndexedGroupRows = (db, groupIds) => {
  if (groupIds.length === 0) {
    return [];
  }

  const placeholders = groupIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT
      line_number AS lineNumber,
      group_id AS groupId,
      type,
      sub_type AS subType,
      success,
      title,
      content,
      metadata_json AS metadataJson
    FROM log_lines
    WHERE group_id IN (${placeholders})
    ORDER BY line_number ASC
  `).all(...groupIds);
};

const fetchIndexedViewGroupPage = (db, { beforeLineNumber = null, limit }) => {
  const parameters = [];
  const paginationClause = Number.isInteger(beforeLineNumber)
    ? 'WHERE grouped.lastLineNumber < ?'
    : '';

  if (Number.isInteger(beforeLineNumber)) {
    parameters.push(beforeLineNumber);
  }

  parameters.push(limit + 1);

  return db.prepare(`
    SELECT
      group_id AS groupId,
      first_line_number AS firstLineNumber,
      last_line_number AS lastLineNumber,
      entries_count AS entriesCount
    FROM log_groups
    ${Number.isInteger(beforeLineNumber) ? 'WHERE last_line_number < ?' : ''}
    ORDER BY last_line_number DESC
    LIMIT ?
  `).all(...parameters);
};

const buildIndexedViewGroups = (groupRows, groupPage) => {
  const groupsById = new Map();
  const groupMetaById = new Map(
    groupPage.map((group) => [
      group.groupId,
      {
        firstLineNumber: group.firstLineNumber,
        lastLineNumber: group.lastLineNumber,
        entriesCount: group.entriesCount
      }
    ])
  );

  groupRows.forEach((row) => {
    const groupMeta = groupMetaById.get(row.groupId);
    if (!groupMeta) {
      return;
    }

    let group = groupsById.get(row.groupId);
    if (!group) {
      group = {
        uuid: row.groupId,
        type: row.type || 'unknown',
        subType: row.subType || 'unknown',
        success: row.success === null || row.success === undefined ? null : Boolean(row.success),
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {},
        title: row.title || 'Log Entry',
        entriesCount: 0,
        firstSeen: DISK_SEARCH_TIMESTAMP,
        lastSeen: DISK_SEARCH_TIMESTAMP,
        entries: [],
        indexMeta: {
          isIndexedViewResult: true,
          firstLineNumber: groupMeta.firstLineNumber,
          lastLineNumber: groupMeta.lastLineNumber
        }
      };

      groupsById.set(row.groupId, group);
    }

    group.entriesCount += 1;
    if (row.success !== null && row.success !== undefined && group.success === null) {
      group.success = Boolean(row.success);
    }

    if (row.metadataJson) {
      group.metadata = mergeLogMetadata(group.metadata, JSON.parse(row.metadataJson));
    }

    group.entries.push({
      content: row.content,
      timestamp: DISK_SEARCH_TIMESTAMP,
      lineNumber: row.lineNumber
    });
  });

  return groupPage
    .map((group) => groupsById.get(group.groupId))
    .filter(Boolean);
};

const searchIndexedWithFts = (db, ftsQuery, persistedState, maxGroups) => {
  const matchedGroups = db.prepare(`
    SELECT
      lines.group_id AS groupId,
      MIN(lines.line_number) AS firstMatchedLineNumber,
      MAX(lines.line_number) AS lastMatchedLineNumber,
      COUNT(*) AS matchedLineCount,
      GROUP_CONCAT(lines.line_number) AS matchedLineNumbers
    FROM log_lines_fts AS fts
    INNER JOIN log_lines AS lines
      ON lines.id = fts.rowid
    WHERE log_lines_fts MATCH ?
    GROUP BY lines.group_id
    ORDER BY firstMatchedLineNumber ASC
    LIMIT ?
  `).all(ftsQuery, maxGroups + 1);

  const truncated = matchedGroups.length > maxGroups;
  const visibleGroups = truncated ? matchedGroups.slice(0, maxGroups) : matchedGroups;
  const groupRows = fetchIndexedGroupRows(
    db,
    visibleGroups.map(group => group.groupId)
  );

  return {
    success: true,
    ...buildIndexedResults(
      groupRows,
      {
        matchedGroups: visibleGroups,
        matchedLines: visibleGroups.reduce((sum, group) => sum + group.matchedLineCount, 0),
        indexedLineCount: persistedState.indexedLineCount,
        maxGroups,
        truncated
      }
    )
  };
};

const searchIndexedWithLike = (db, query, persistedState, maxGroups) => {
  const tokens = normalizeLikeQueryTokens(query);
  if (tokens.length === 0) {
    return {
      success: false,
      reason: 'unsupported_query'
    };
  }

  const searchableExpression = `
    lower(
      group_id || ' ' ||
      type || ' ' ||
      sub_type || ' ' ||
      title || ' ' ||
      metadata_text || ' ' ||
      content
    )
  `;
  const conditions = tokens.map(() => `${searchableExpression} LIKE ? ESCAPE '\\'`).join(' AND ');
  const parameters = tokens.map(token => `%${escapeLikePattern(token)}%`);

  const matchedGroups = db.prepare(`
    SELECT
      group_id AS groupId,
      MIN(line_number) AS firstMatchedLineNumber,
      MAX(line_number) AS lastMatchedLineNumber,
      COUNT(*) AS matchedLineCount,
      GROUP_CONCAT(line_number) AS matchedLineNumbers
    FROM log_lines
    WHERE ${conditions}
    GROUP BY group_id
    ORDER BY firstMatchedLineNumber ASC
    LIMIT ?
  `).all(...parameters, maxGroups + 1);

  const truncated = matchedGroups.length > maxGroups;
  const visibleGroups = truncated ? matchedGroups.slice(0, maxGroups) : matchedGroups;
  const groupRows = fetchIndexedGroupRows(
    db,
    visibleGroups.map(group => group.groupId)
  );

  return {
    success: true,
    ...buildIndexedResults(
      groupRows,
      {
        matchedGroups: visibleGroups,
        matchedLines: visibleGroups.reduce((sum, group) => sum + group.matchedLineCount, 0),
        indexedLineCount: persistedState.indexedLineCount,
        maxGroups,
        truncated
      }
    )
  };
};

export const searchIndexedLogFile = async (logFilePath, query, { maxGroups = 300 } = {}) => {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery && normalizeLikeQueryTokens(query).length === 0) {
    return {
      success: false,
      reason: 'unsupported_query'
    };
  }

  const dbPath = await getIndexDatabasePath(logFilePath);
  const database = await openDatabase(dbPath);
  if (!database) {
    return {
      success: false,
      reason: 'sqlite_unavailable'
    };
  }

  const { db, supportsFts } = database;
  try {
    const stats = await fs.promises.stat(logFilePath);
    const persistedState = getPersistedIndexState(db);
    if (!persistedState || persistedState.status !== 'ready') {
      return {
        success: false,
        reason: 'not_ready'
      };
    }

    if (persistedState.logFilePath !== path.resolve(logFilePath)) {
      return {
        success: false,
        reason: 'stale'
      };
    }

    const coverageBytes = Math.min(persistedState.indexedBytes || 0, stats.size);
    const coverageComplete = (
      persistedState.fileSize === stats.size &&
      persistedState.indexedBytes === stats.size &&
      persistedState.fileMtimeMs === stats.mtimeMs
    );
    const needsRefresh = !coverageComplete;

    let searchResult;
    if (supportsFts && ftsQuery && isFtsIndexUsable(db)) {
      searchResult = searchIndexedWithFts(db, ftsQuery, persistedState, maxGroups);
    } else {
      searchResult = searchIndexedWithLike(db, query, persistedState, maxGroups);
    }

    if (!searchResult.success) {
      return searchResult;
    }

    return {
      success: true,
      coveredBytes: coverageBytes,
      coverageComplete,
      needsRefresh,
      ...searchResult
    };
  } finally {
    db.close();
  }
};

export const getIndexedLogViewPage = async (
  logFilePath,
  {
    beforeLineNumber = null,
    limit = 20
  } = {}
) => {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const normalizedCursor = Number.isInteger(beforeLineNumber) ? beforeLineNumber : null;
  const dbPath = await getIndexDatabasePath(logFilePath);
  const database = await openDatabase(dbPath);
  if (!database) {
    return {
      success: false,
      reason: 'sqlite_unavailable'
    };
  }

  const { db } = database;
  try {
    const stats = await fs.promises.stat(logFilePath);
    const persistedState = getPersistedIndexState(db);

    if (!canReadPersistedIndex(db, persistedState, logFilePath)) {
      return {
        success: false,
        reason: 'not_ready'
      };
    }

    const groupPage = fetchIndexedViewGroupPage(db, {
      beforeLineNumber: normalizedCursor,
      limit: normalizedLimit
    });
    const hasMore = groupPage.length > normalizedLimit;
    const visibleGroups = hasMore ? groupPage.slice(0, normalizedLimit) : groupPage;
    const groupRows = fetchIndexedGroupRows(
      db,
      visibleGroups.map((group) => group.groupId)
    );

    return {
      success: true,
      dbPath,
      page: {
        totalEntries: visibleGroups.length,
        entries: buildIndexedViewGroups(groupRows, visibleGroups),
        hasMore,
        nextCursor: hasMore && visibleGroups.length > 0
          ? visibleGroups[visibleGroups.length - 1].lastLineNumber
          : null
      },
      ...buildIndexedCoverageState(persistedState, stats)
    };
  } finally {
    db.close();
  }
};
