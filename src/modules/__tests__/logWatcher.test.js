import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn()
  }
}));

const temporaryDirectories = [];

const createTempLogFile = async (content) => {
  const directoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logspect-watcher-'));
  temporaryDirectories.push(directoryPath);

  const logFilePath = path.join(directoryPath, 'development.log');
  await fs.promises.writeFile(logFilePath, content, 'utf8');

  return logFilePath;
};

const waitForInitialLoad = (setLogDataCallback, startWatching, logFilePath) => (
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timed out waiting for initial log load'));
    }, 3000);

    setLogDataCallback(() => {
      clearTimeout(timeoutId);
      resolve();
    });

    try {
      startWatching(logFilePath).catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  })
);

afterEach(async () => {
  const { stopWatching } = await import('../logWatcher.js');
  const { clearAllLogData } = await import('../logStorage.js');

  stopWatching();
  clearAllLogData();

  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => (
    fs.promises.rm(directoryPath, { recursive: true, force: true })
  )));

  vi.resetModules();
});

describe('logWatcher', () => {
  it('loads existing log history when watching an existing file', async () => {
    const logFilePath = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] Started GET /users',
      '[aa32797f-b087-4d45-9d99-28198952a784] Completed 200 OK in 12ms',
      'class=Workers::DigestJob jid=73f8e97e7e79413a3006f4ea INFO: start'
    ].join('\n'));

    const { startWatching, setLogDataCallback } = await import('../logWatcher.js');
    const { getFormattedLogData } = await import('../logStorage.js');

    await waitForInitialLoad(setLogDataCallback, startWatching, logFilePath);

    const data = getFormattedLogData();

    expect(data.totalEntries).toBe(2);
    expect(data.entries.map(entry => entry.uuid)).toContain('aa32797f-b087-4d45-9d99-28198952a784');
    expect(data.entries.map(entry => entry.uuid)).toContain('73f8e97e7e79413a3006f4ea');
  });

  it('loads only the recent tail of very large files and skips partial leading lines', async () => {
    const { INITIAL_HISTORY_MAX_BYTES, startWatching, setLogDataCallback } = await import('../logWatcher.js');
    const { getFormattedLogData } = await import('../logStorage.js');

    const largePrefix = 'x'.repeat(INITIAL_HISTORY_MAX_BYTES + 1024);
    const logFilePath = await createTempLogFile([
      largePrefix,
      '[bb32797f-b087-4d45-9d99-28198952a784] Completed 200 OK in 9ms'
    ].join('\n'));

    await waitForInitialLoad(setLogDataCallback, startWatching, logFilePath);

    const data = getFormattedLogData();

    expect(data.totalEntries).toBe(1);
    expect(data.entries[0].uuid).toBe('bb32797f-b087-4d45-9d99-28198952a784');
    expect(data.entries[0].entries[0].content).toBe('Completed 200 OK in 9ms');
  });

  it('can start from an indexed offset without reloading old history', async () => {
    const logFilePath = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] Started GET /users',
      '[aa32797f-b087-4d45-9d99-28198952a784] Completed 200 OK in 12ms'
    ].join('\n'));

    const initialSize = (await fs.promises.stat(logFilePath)).size;
    const { startWatching, setLogDataCallback } = await import('../logWatcher.js');
    const { getFormattedLogData } = await import('../logStorage.js');

    await startWatching(logFilePath, {
      startOffset: initialSize,
      loadExistingContent: false,
      startOffsetAtLineBoundary: true
    });

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timed out waiting for appended log line'));
      }, 3000);

      setLogDataCallback(() => {
        clearTimeout(timeoutId);
        resolve();
      });

      fs.promises.appendFile(
        logFilePath,
        '\n[bb32797f-b087-4d45-9d99-28198952a784] Completed 500 Failed in 3ms'
      ).catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    const data = getFormattedLogData();

    expect(data.totalEntries).toBe(1);
    expect(data.entries[0].uuid).toBe('bb32797f-b087-4d45-9d99-28198952a784');
  });
});
