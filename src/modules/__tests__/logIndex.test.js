import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

const temporaryDirectories = [];
const createTempLogFile = async (content) => {
  const directoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logspect-index-'));
  temporaryDirectories.push(directoryPath);

  const logFilePath = path.join(directoryPath, 'development.log');
  await fs.promises.writeFile(logFilePath, content, 'utf8');

  return { directoryPath, logFilePath };
};

const waitForIndexReady = async (logFilePath, storageDirectory) => {
  const {
    getLogIndexStatus,
    setLogIndexStorageDirectory,
    startLogIndexing
  } = await import('../logIndex.js');
  setLogIndexStorageDirectory(storageDirectory);

  await startLogIndexing(logFilePath, { waitForCompletion: true });

  const status = getLogIndexStatus();
  if (status.logFilePath === logFilePath && status.status === 'ready') {
    return status;
  }

  throw new Error(`Unexpected index status: ${JSON.stringify(status)}`);
};

afterEach(async () => {
  const { cancelLogIndexing } = await import('../logIndex.js');
  cancelLogIndexing();

  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => (
    fs.promises.rm(directoryPath, { recursive: true, force: true })
  )));

  vi.resetModules();
});

describe('logIndex', () => {
  it('returns the latest indexed groups in pages for the initial viewer load', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted',
      '[aa32797f-b087-4d45-9d99-28198952a784] Completed 200 OK in 12ms',
      '[bb32797f-b087-4d45-9d99-28198952a784] INFO: callback booted',
      '[cc32797f-b087-4d45-9d99-28198952a784] ERROR: payment timeout'
    ].join('\n'));

    await waitForIndexReady(logFilePath, directoryPath);

    const { getIndexedLogViewPage, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const firstPage = await getIndexedLogViewPage(logFilePath, { limit: 2 });

    expect(firstPage.success).toBe(true);
    expect(firstPage.page.entries.map(entry => entry.uuid)).toEqual([
      'cc32797f-b087-4d45-9d99-28198952a784',
      'bb32797f-b087-4d45-9d99-28198952a784'
    ]);
    expect(firstPage.page.entries[0].indexMeta).toMatchObject({
      isIndexedViewResult: true,
      firstLineNumber: 4,
      lastLineNumber: 4
    });
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).toBe(3);

    const secondPage = await getIndexedLogViewPage(logFilePath, {
      limit: 2,
      beforeLineNumber: firstPage.page.nextCursor
    });

    expect(secondPage.success).toBe(true);
    expect(secondPage.page.entries.map(entry => entry.uuid)).toEqual([
      'aa32797f-b087-4d45-9d99-28198952a784'
    ]);
    expect(secondPage.page.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2]);
    expect(secondPage.page.hasMore).toBe(false);
  });

  it('builds a SQLite index and searches it by content', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted',
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: cache timeout',
      'class=Workers::SearchJob jid=73f8e97e7e79413a3006f4ea INFO: start'
    ].join('\n'));

    await waitForIndexReady(logFilePath, directoryPath);

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'cache timeout');

    expect(result.success).toBe(true);
    expect(result.backend).toBe('sqlite');
    expect(result.summary.matchedLines).toBe(1);
    expect(result.results.entries[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
    expect(result.results.entries[0].entriesCount).toBe(2);
    expect(result.results.entries[0].searchMeta).toMatchObject({
      matchedLineCount: 1,
      matchedLineNumbers: [2],
      firstLineNumber: 2,
      lastLineNumber: 2,
      groupFirstLineNumber: 1,
      groupLastLineNumber: 2
    });
    expect(result.results.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2]);
    expect(result.results.entries[0].entries.map(entry => entry.isMatch)).toEqual([false, true]);
  });

  it('appends new lines into the existing index on subsequent runs', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted'
    ].join('\n'));

    await waitForIndexReady(logFilePath, directoryPath);

    await fs.promises.appendFile(
      logFilePath,
      '\n[bb32797f-b087-4d45-9d99-28198952a784] FATAL: payment timeout'
    );

    await waitForIndexReady(logFilePath, directoryPath);

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'payment timeout');

    expect(result.success).toBe(true);
    expect(result.summary.matchedLines).toBe(1);
    expect(result.results.entries[0].uuid).toBe('bb32797f-b087-4d45-9d99-28198952a784');
    expect(result.results.entries[0].entries[0].lineNumber).toBe(2);
  });

  it('does not duplicate lines when append indexing overlaps already indexed content', async () => {
    const firstLine = '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted';
    const secondLine = '[aa32797f-b087-4d45-9d99-28198952a784] DEBUG: rendering response';
    const thirdLine = '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout';
    const { directoryPath, logFilePath } = await createTempLogFile([
      firstLine,
      secondLine,
      thirdLine
    ].join('\n'));

    const status = await waitForIndexReady(logFilePath, directoryPath);
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(status.dbPath);
    const stats = await fs.promises.stat(logFilePath);

    db.prepare(`
      UPDATE index_state
      SET
        indexed_bytes = ?,
        indexed_line_count = ?,
        file_size = ?,
        file_mtime_ms = ?,
        status = 'ready'
      WHERE id = 1
    `).run(
      Buffer.byteLength(`${firstLine}\n`, 'utf8'),
      1,
      stats.size,
      stats.mtimeMs
    );
    db.close();

    await waitForIndexReady(logFilePath, directoryPath);

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'callback timeout');

    expect(result.success).toBe(true);
    expect(result.results.entries[0].entriesCount).toBe(3);
    expect(result.results.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3]);
    expect(result.results.entries[0].entries.map(entry => entry.isMatch)).toEqual([false, false, true]);
  });

  it('falls back to plain SQLite search when the FTS table is unavailable', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: callback booted',
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout'
    ].join('\n'));

    const status = await waitForIndexReady(logFilePath, directoryPath);
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(status.dbPath);
    db.exec('DROP TABLE IF EXISTS log_lines_fts;');
    db.close();

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'callback timeout');

    expect(result.success).toBe(true);
    expect(result.backend).toBe('sqlite');
    expect(result.summary.matchedLines).toBe(1);
    expect(result.results.entries[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
    expect(result.results.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2]);
  });

  it('uses the existing ready index even when the file has appended new lines', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout'
    ].join('\n'));

    await waitForIndexReady(logFilePath, directoryPath);

    await fs.promises.appendFile(
      logFilePath,
      '\n[bb32797f-b087-4d45-9d99-28198952a784] INFO: brand new tail line'
    );

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'callback timeout');

    expect(result.success).toBe(true);
    expect(result.backend).toBe('sqlite');
    expect(result.coverageComplete).toBe(false);
    expect(result.needsRefresh).toBe(true);
    expect(result.results.entries[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
  });

  it('returns all lines from each matched group when searching the index', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted',
      '[aa32797f-b087-4d45-9d99-28198952a784] DEBUG: rendering response',
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout'
    ].join('\n'));

    await waitForIndexReady(logFilePath, directoryPath);

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'callback timeout');

    expect(result.success).toBe(true);
    expect(result.results.entries).toHaveLength(1);
    expect(result.results.entries[0].entriesCount).toBe(3);
    expect(result.results.entries[0].searchMeta).toMatchObject({
      matchedLineCount: 1,
      matchedLineNumbers: [3],
      firstLineNumber: 3,
      lastLineNumber: 3,
      groupFirstLineNumber: 1,
      groupLastLineNumber: 3
    });
    expect(result.results.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3]);
    expect(result.results.entries[0].entries.map(entry => entry.isMatch)).toEqual([false, false, true]);
  });

  it('rebuilds a corrupted index from scratch when forceRebuild is requested', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted',
      '[aa32797f-b087-4d45-9d99-28198952a784] DEBUG: rendering response',
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout'
    ].join('\n'));

    const status = await waitForIndexReady(logFilePath, directoryPath);
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(status.dbPath);
    const originalMaxId = db.prepare('SELECT MAX(id) AS id FROM log_lines').get().id;

    db.exec(`
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
      SELECT
        line_number,
        group_id,
        type,
        sub_type,
        success,
        title,
        content,
        metadata_json,
        metadata_text
      FROM log_lines
    `);
    db.prepare(`
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
      WHERE id > ?
    `).run(originalMaxId);
    db.close();

    const {
      getIndexedLogViewPage,
      startLogIndexing,
      searchIndexedLogFile,
      setLogIndexStorageDirectory
    } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    await startLogIndexing(logFilePath, {
      forceRebuild: true,
      waitForCompletion: true
    });

    const searchResult = await searchIndexedLogFile(logFilePath, 'callback timeout');
    const viewerResult = await getIndexedLogViewPage(logFilePath, { limit: 20 });

    expect(searchResult.success).toBe(true);
    expect(searchResult.summary.matchedLines).toBe(1);
    expect(searchResult.results.entries[0].entriesCount).toBe(3);
    expect(searchResult.results.entries[0].searchMeta.matchedLineCount).toBe(1);
    expect(searchResult.results.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3]);
    expect(searchResult.results.entries[0].entries.map(entry => entry.isMatch)).toEqual([false, false, true]);

    expect(viewerResult.success).toBe(true);
    expect(viewerResult.page.entries[0].entriesCount).toBe(3);
    expect(viewerResult.page.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3]);
  });

  it('indexes Rails request lifecycle lines without UUID as one HTTP group', async () => {
    const { directoryPath, logFilePath } = await createTempLogFile([
      'Started GET /users',
      'Processing by UsersController#index as HTML',
      'Parameters: {"page"=>"1"}',
      'Completed 200 OK in 12ms'
    ].join('\n'));

    await waitForIndexReady(logFilePath, directoryPath);

    const { searchIndexedLogFile, setLogIndexStorageDirectory } = await import('../logIndex.js');
    setLogIndexStorageDirectory(directoryPath);

    const result = await searchIndexedLogFile(logFilePath, 'page');

    expect(result.success).toBe(true);
    expect(result.results.entries).toHaveLength(1);
    expect(result.results.entries[0].uuid).toBe('http-1');
    expect(result.results.entries[0].entriesCount).toBe(4);
    expect(result.results.entries[0].metadata).toMatchObject({
      groupingStrategy: 'http-context-heuristic',
      groupingConfidence: 'medium'
    });
    expect(result.results.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3, 4]);
  });
});
