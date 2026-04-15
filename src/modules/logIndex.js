import crypto from 'node:crypto';
import fs from 'fs';
import { createRequire } from 'node:module';
import os from 'os';
import path from 'path';
import readline from 'node:readline';
import util from 'node:util';
import log from 'electron-log';
import { extractLogInfo, jidRegex, uuidRegex } from './logParser.js';

const INDEX_STREAM_HIGH_WATER_MARK = 256 * 1024;
const INDEX_BATCH_SIZE = 500;
const INDEX_PROGRESS_INTERVAL_MS = 150;
const INDEX_YIELD_EVERY_N_LINES = 2000;

let DatabaseSync = null;
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

const loadSqlite = async () => {
  if (sqliteSupported === false) {
    return null;
  }

  if (DatabaseSync) {
    return DatabaseSync;
  }

  try {
    ({ DatabaseSync } = require('node:sqlite'));
    sqliteSupported = true;
    return DatabaseSync;
  } catch (error) {
    sqliteSupported = false;
    log.warn?.('SQLite is not available in this runtime:', error);
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

const openDatabase = async (dbPath) => {
  const SQLiteDatabaseSync = await loadSqlite();
  if (!SQLiteDatabaseSync) {
    return null;
  }

  const db = new SQLiteDatabaseSync(dbPath);
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

    CREATE INDEX IF NOT EXISTS idx_log_lines_line_number ON log_lines(line_number);
    CREATE INDEX IF NOT EXISTS idx_log_lines_group_id ON log_lines(group_id, line_number);

    CREATE VIRTUAL TABLE IF NOT EXISTS log_lines_fts USING fts5(
      group_id,
      title,
      content,
      metadata_text,
      tokenize = 'unicode61'
    );
  `);

  return db;
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
  db.exec(`
    DELETE FROM log_lines;
    DELETE FROM log_lines_fts;
  `);
};

const createIndexRecord = (rawLine, lineNumber) => {
  const sanitizedLine = util.stripVTControlCharacters(rawLine).trim();
  if (!sanitizedLine) {
    return null;
  }

  const uuidMatch = sanitizedLine.match(uuidRegex);
  if (uuidMatch) {
    const content = sanitizedLine.replace(uuidRegex, '').trim();
    const logInfo = extractLogInfo(content);

    return {
      lineNumber,
      groupId: uuidMatch[1],
      content,
      type: logInfo.type || 'unknown',
      subType: logInfo.subType || 'unknown',
      success: logInfo.success,
      title: logInfo.title || 'Search Match',
      metadataJson: JSON.stringify(logInfo.metadata || {}),
      metadataText: Object.values(logInfo.metadata || {}).join(' ')
    };
  }

  const jidMatch = sanitizedLine.match(jidRegex);
  if (jidMatch) {
    const logInfo = extractLogInfo(sanitizedLine);

    return {
      lineNumber,
      groupId: jidMatch[2],
      content: sanitizedLine,
      type: logInfo.type || 'unknown',
      subType: logInfo.subType || 'unknown',
      success: logInfo.success,
      title: logInfo.title || 'Search Match',
      metadataJson: JSON.stringify(logInfo.metadata || {}),
      metadataText: Object.values(logInfo.metadata || {}).join(' ')
    };
  }

  const logInfo = extractLogInfo(sanitizedLine);

  return {
    lineNumber,
    groupId: `line-${lineNumber}`,
    content: sanitizedLine,
    type: logInfo.type || 'unknown',
    subType: logInfo.subType || 'unknown',
    success: logInfo.success,
    title: logInfo.title || 'Search Match',
    metadataJson: JSON.stringify(logInfo.metadata || {}),
    metadataText: Object.values(logInfo.metadata || {}).join(' ')
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

const determineIndexMode = (persistedState, stats, logFilePath, forceRebuild) => {
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

const flushBatch = (db, batch, insertLineStatement, insertFtsStatement) => {
  if (batch.length === 0) {
    return;
  }

  withTransaction(db, () => {
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
        record.metadataText
      );

      insertFtsStatement.run(
        result.lastInsertRowid,
        record.groupId,
        record.title,
        record.content,
        record.metadataText
      );
    });
  });

  batch.length = 0;
};

const isActiveIndexJob = (job) => (
  activeIndexJob && activeIndexJob.id === job.id
);

const runIndexJob = async (job, dbPath, statsSnapshot, mode, baselineState) => {
  const db = await openDatabase(dbPath);
  if (!db) {
    emitIndexStatus(createEmptyIndexStatus({
      logFilePath: job.logFilePath,
      dbPath,
      status: 'unsupported',
      backend: 'scan',
      error: 'SQLite is not available in this runtime.'
    }));
    return;
  }

  const startByte = mode === 'append' ? baselineState.indexedBytes : 0;
  let indexedLineCount = mode === 'append' ? baselineState.indexedLineCount : 0;
  let lastProgressEmitAt = 0;
  let bytesIndexed = startByte;

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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFtsStatement = db.prepare(`
    INSERT INTO log_lines_fts (
      rowid,
      group_id,
      title,
      content,
      metadata_text
    ) VALUES (?, ?, ?, ?, ?)
  `);

  try {
    if (mode === 'rebuild') {
      clearExistingIndexData(db);
      saveIndexState(db, {
        logFilePath: path.resolve(job.logFilePath),
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: 0,
        indexedLineCount: 0,
        status: 'indexing'
      });
    } else {
      saveIndexState(db, {
        logFilePath: path.resolve(job.logFilePath),
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: baselineState.indexedBytes,
        indexedLineCount: baselineState.indexedLineCount,
        status: 'indexing'
      });
    }

    if (statsSnapshot.size === 0 || startByte >= statsSnapshot.size) {
      saveIndexState(db, {
        logFilePath: path.resolve(job.logFilePath),
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: statsSnapshot.size,
        indexedLineCount,
        status: 'ready'
      });

      emitIndexStatus(createEmptyIndexStatus({
        logFilePath: job.logFilePath,
        dbPath,
        status: 'ready',
        progressPercent: 100,
        bytesIndexed: statsSnapshot.size,
        totalBytes: statsSnapshot.size,
        indexedLines: indexedLineCount
      }));
      return;
    }

    const stream = fs.createReadStream(job.logFilePath, {
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
        if (job.cancelled) {
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
        const record = createIndexRecord(rawLine, indexedLineCount);

        if (record) {
          batch.push(record);
        }

        if (batch.length >= INDEX_BATCH_SIZE) {
          flushBatch(db, batch, insertLineStatement, insertFtsStatement);
        }

        if (indexedLineCount % INDEX_YIELD_EVERY_N_LINES === 0) {
          const now = Date.now();
          if (now - lastProgressEmitAt >= INDEX_PROGRESS_INTERVAL_MS) {
            lastProgressEmitAt = now;
            emitIndexStatus(createEmptyIndexStatus({
              logFilePath: job.logFilePath,
              dbPath,
              status: 'indexing',
              progressPercent: statsSnapshot.size === 0
                ? 100
                : Math.min(100, Math.round((Math.min(bytesIndexed, statsSnapshot.size) / statsSnapshot.size) * 100)),
              bytesIndexed: Math.min(bytesIndexed, statsSnapshot.size),
              totalBytes: statsSnapshot.size,
              indexedLines: indexedLineCount
            }));
          }

          await yieldToEventLoop();
        }
      }

      flushBatch(db, batch, insertLineStatement, insertFtsStatement);
    } finally {
      lineReader.close();
      stream.destroy();
    }

    if (job.cancelled) {
      emitIndexStatus(createEmptyIndexStatus({
        logFilePath: job.logFilePath,
        dbPath,
        status: 'cancelled',
        progressPercent: statsSnapshot.size === 0
          ? 100
          : Math.min(100, Math.round((Math.min(bytesIndexed, statsSnapshot.size) / statsSnapshot.size) * 100)),
        bytesIndexed: Math.min(bytesIndexed, statsSnapshot.size),
        totalBytes: statsSnapshot.size,
        indexedLines: indexedLineCount
      }));
      return;
    }

    saveIndexState(db, {
      logFilePath: path.resolve(job.logFilePath),
      fileSize: statsSnapshot.size,
      fileMtimeMs: statsSnapshot.mtimeMs,
      indexedBytes: statsSnapshot.size,
      indexedLineCount,
      status: 'ready'
    });

    emitIndexStatus(createEmptyIndexStatus({
      logFilePath: job.logFilePath,
      dbPath,
      status: 'ready',
      progressPercent: 100,
      bytesIndexed: statsSnapshot.size,
      totalBytes: statsSnapshot.size,
      indexedLines: indexedLineCount
    }));
  } catch (error) {
    log.error('Error indexing log file:', error);

    try {
      saveIndexState(db, {
        logFilePath: path.resolve(job.logFilePath),
        fileSize: statsSnapshot.size,
        fileMtimeMs: statsSnapshot.mtimeMs,
        indexedBytes: baselineState.indexedBytes,
        indexedLineCount: baselineState.indexedLineCount,
        status: 'error'
      });
    } catch (stateError) {
      log.error('Error writing index error state:', stateError);
    }

    emitIndexStatus(createEmptyIndexStatus({
      logFilePath: job.logFilePath,
      dbPath,
      status: 'error',
      progressPercent: statsSnapshot.size === 0
        ? 100
        : Math.min(100, Math.round((Math.min(bytesIndexed, statsSnapshot.size) / statsSnapshot.size) * 100)),
      bytesIndexed: Math.min(bytesIndexed, statsSnapshot.size),
      totalBytes: statsSnapshot.size,
      indexedLines: indexedLineCount,
      error: error.message
    }));
  } finally {
    db.close();

    if (isActiveIndexJob(job)) {
      activeIndexJob = null;
    }
  }
};

export const setLogIndexStorageDirectory = (directoryPath) => {
  indexStorageDirectory = directoryPath;
};

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
  const SQLiteDatabaseSync = await loadSqlite();
  if (!SQLiteDatabaseSync) {
    const unsupportedStatus = createEmptyIndexStatus({
      logFilePath,
      status: 'unsupported',
      backend: 'scan',
      error: 'SQLite is not available in this runtime.'
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

  if (activeIndexJob && activeIndexJob.logFilePath === logFilePath && !activeIndexJob.cancelled) {
    if (waitForCompletion && activeIndexJob.promise) {
      await activeIndexJob.promise;
    }

    return {
      success: true,
      promise: activeIndexJob.promise || null,
      status: currentIndexStatus
    };
  }

  const db = await openDatabase(dbPath);
  if (!db) {
    const unsupportedStatus = createEmptyIndexStatus({
      logFilePath,
      dbPath,
      status: 'unsupported',
      backend: 'scan',
      error: 'SQLite is not available in this runtime.'
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
    const persistedState = getPersistedIndexState(db);
    const resolvedMode = determineIndexMode(persistedState, stats, logFilePath, forceRebuild);

    baselineState = {
      indexedBytes: resolvedMode.indexedBytes,
      indexedLineCount: resolvedMode.indexedLineCount
    };
    indexMode = resolvedMode.mode;
  } finally {
    db.close();
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
    promise: null
  };
  activeIndexJob = job;

  const indexingStatus = createEmptyIndexStatus({
    logFilePath,
    dbPath,
    status: 'indexing',
    progressPercent: stats.size === 0
      ? 100
      : Math.min(100, Math.round((baselineState.indexedBytes / stats.size) * 100)),
    bytesIndexed: baselineState.indexedBytes,
    totalBytes: stats.size,
    indexedLines: baselineState.indexedLineCount
  });
  emitIndexStatus(indexingStatus);

  job.promise = runIndexJob(job, dbPath, stats, indexMode, baselineState);
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

export const searchIndexedLogFile = async (logFilePath, query, { maxGroups = 300, maxLinesPerGroup = 200 } = {}) => {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) {
    return {
      success: false,
      reason: 'unsupported_query'
    };
  }

  const dbPath = await getIndexDatabasePath(logFilePath);
  const db = await openDatabase(dbPath);
  if (!db) {
    return {
      success: false,
      reason: 'sqlite_unavailable'
    };
  }

  try {
    const stats = await fs.promises.stat(logFilePath);
    const persistedState = getPersistedIndexState(db);
    if (!persistedState || persistedState.status !== 'ready') {
      return {
        success: false,
        reason: 'not_ready'
      };
    }

    if (persistedState.logFilePath !== path.resolve(logFilePath) || persistedState.indexedBytes !== stats.size) {
      return {
        success: false,
        reason: 'stale'
      };
    }

    const totalMatchedLines = db.prepare(`
      SELECT COUNT(*) AS count
      FROM log_lines_fts
      WHERE log_lines_fts MATCH ?
    `).get(ftsQuery).count;

    const matchedRows = db.prepare(`
      SELECT
        lines.line_number AS lineNumber,
        lines.group_id AS groupId,
        lines.type,
        lines.sub_type AS subType,
        lines.success,
        lines.title,
        lines.content,
        lines.metadata_json AS metadataJson
      FROM log_lines_fts AS fts
      INNER JOIN log_lines AS lines
        ON lines.id = fts.rowid
      WHERE log_lines_fts MATCH ?
      ORDER BY lines.line_number ASC
      LIMIT ?
    `).all(ftsQuery, maxGroups * maxLinesPerGroup);

    const resultsByGroup = new Map();
    let truncated = totalMatchedLines > matchedRows.length;

    matchedRows.forEach((row) => {
      let group = resultsByGroup.get(row.groupId);

      if (!group) {
        if (resultsByGroup.size >= maxGroups) {
          truncated = true;
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
          firstSeen: new Date(0).toISOString(),
          lastSeen: new Date(0).toISOString(),
          entries: [],
          searchMeta: {
            isDiskSearchResult: true,
            firstLineNumber: row.lineNumber,
            lastLineNumber: row.lineNumber,
            hasHiddenMatches: false
          }
        };

        resultsByGroup.set(row.groupId, group);
      }

      group.entriesCount += 1;
      group.searchMeta.firstLineNumber = Math.min(group.searchMeta.firstLineNumber, row.lineNumber);
      group.searchMeta.lastLineNumber = Math.max(group.searchMeta.lastLineNumber, row.lineNumber);

      if (group.entries.length < maxLinesPerGroup) {
        group.entries.push({
          content: row.content,
          timestamp: new Date(0).toISOString(),
          lineNumber: row.lineNumber
        });
      } else {
        group.searchMeta.hasHiddenMatches = true;
        truncated = true;
      }
    });

    const shownGroups = resultsByGroup.size;
    const shownLines = Array.from(resultsByGroup.values()).reduce((sum, group) => sum + group.entriesCount, 0);

    return {
      success: true,
      backend: 'sqlite',
      results: {
        totalEntries: shownGroups,
        entries: Array.from(resultsByGroup.values())
      },
      summary: {
        matchedLines: totalMatchedLines,
        shownGroups,
        scannedLines: persistedState.indexedLineCount,
        truncated: truncated || totalMatchedLines > shownLines
      }
    };
  } finally {
    db.close();
  }
};
