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
    expect(result.results.entries[0].entries[0].lineNumber).toBe(2);
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
    expect(result.results.entries[0].entries[0].lineNumber).toBe(2);
  });
});
