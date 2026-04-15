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
  const directoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logspect-search-'));
  temporaryDirectories.push(directoryPath);

  const logFilePath = path.join(directoryPath, 'search.log');
  await fs.promises.writeFile(logFilePath, content, 'utf8');

  return logFilePath;
};

const waitForSearchCompletion = async (logFilePath, query) => {
  const statusEvents = [];
  const resultsEvents = [];

  const {
    searchLogFile,
    setLogSearchStatusCallback,
    setLogSearchResultsCallback
  } = await import('../logSearch.js');

  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timed out waiting for log search completion'));
    }, 4000);

    setLogSearchStatusCallback((payload) => {
      statusEvents.push(payload);

      if (payload.status === 'completed') {
        clearTimeout(timeoutId);
        resolve({
          statusEvents,
          resultsEvents
        });
      }

      if (payload.status === 'error') {
        clearTimeout(timeoutId);
        reject(new Error(payload.error || 'Search failed'));
      }
    });

    setLogSearchResultsCallback((payload) => {
      resultsEvents.push(payload);
    });

    try {
      const result = await searchLogFile(logFilePath, query);
      if (!result.success) {
        clearTimeout(timeoutId);
        reject(new Error(result.message));
      }
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
};

afterEach(async () => {
  const { cancelActiveLogSearch } = await import('../logSearch.js');
  cancelActiveLogSearch();

  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => (
    fs.promises.rm(directoryPath, { recursive: true, force: true })
  )));

  vi.resetModules();
});

describe('logSearch', () => {
  it('searches the whole file instead of only the loaded tail', async () => {
    const filler = Array.from({ length: 12000 }, (_, index) => `INFO filler line ${index}`).join('\n');
    const logFilePath = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] FATAL: startup exploded',
      filler,
      '[bb32797f-b087-4d45-9d99-28198952a784] Completed 200 OK in 18ms'
    ].join('\n'));

    const { resultsEvents, statusEvents } = await waitForSearchCompletion(logFilePath, 'startup exploded');
    const finalResults = resultsEvents.at(-1);
    const finalStatus = statusEvents.at(-1);

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.progressPercent).toBe(100);
    expect(finalResults.entries).toHaveLength(1);
    expect(finalResults.entries[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
    expect(finalResults.entries[0].entries[0]).toMatchObject({
      content: 'FATAL: startup exploded',
      lineNumber: 1
    });
  });

  it('reports progress and keeps matching line numbers in results', async () => {
    const logFilePath = await createTempLogFile([
      'INFO boot sequence',
      'class=Workers::SearchJob jid=73f8e97e7e79413a3006f4ea INFO: start',
      'class=Workers::SearchJob jid=73f8e97e7e79413a3006f4ea ERROR: query timeout'
    ].join('\n'));

    const { resultsEvents, statusEvents } = await waitForSearchCompletion(logFilePath, 'query timeout');
    const finalResults = resultsEvents.at(-1);

    expect(statusEvents.some(event => event.status === 'running')).toBe(true);
    expect(finalResults.summary.matchedLines).toBe(1);
    expect(finalResults.entries[0].searchMeta).toMatchObject({
      isDiskSearchResult: true,
      firstLineNumber: 3,
      lastLineNumber: 3
    });
    expect(finalResults.entries[0].entries[0].lineNumber).toBe(3);
  });
});
