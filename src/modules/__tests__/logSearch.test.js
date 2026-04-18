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
  const { cancelActiveLogSearch } = await import('../logSearch.js');
  cancelActiveLogSearch();
  vi.doUnmock('../logIndex.js');

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
      matchedLineCount: 1,
      matchedLineNumbers: [3],
      firstLineNumber: 3,
      lastLineNumber: 3
    });
    expect(finalResults.entries[0].entries.map(entry => entry.lineNumber)).toEqual([2, 3]);
    expect(finalResults.entries[0].entries.map(entry => entry.isMatch)).toEqual([false, true]);
  });

  it('returns the full matched group instead of only the matching lines', async () => {
    const logFilePath = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] INFO: request booted',
      '[aa32797f-b087-4d45-9d99-28198952a784] DEBUG: rendering response',
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout'
    ].join('\n'));

    const { resultsEvents } = await waitForSearchCompletion(logFilePath, 'callback timeout');
    const finalResults = resultsEvents.at(-1);

    expect(finalResults.summary.matchedLines).toBe(1);
    expect(finalResults.entries).toHaveLength(1);
    expect(finalResults.entries[0].entriesCount).toBe(3);
    expect(finalResults.entries[0].searchMeta).toMatchObject({
      matchedLineCount: 1,
      matchedLineNumbers: [3],
      firstLineNumber: 3,
      lastLineNumber: 3,
      groupFirstLineNumber: 1,
      groupLastLineNumber: 3
    });
    expect(finalResults.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3]);
    expect(finalResults.entries[0].entries.map(entry => entry.isMatch)).toEqual([false, false, true]);
  });

  it('assembles Rails request lifecycle lines without UUID into one HTTP group', async () => {
    const logFilePath = await createTempLogFile([
      'Started GET /users',
      'Processing by UsersController#index as HTML',
      'Parameters: {"page"=>"1"}',
      'Completed 200 OK in 12ms'
    ].join('\n'));

    const { resultsEvents } = await waitForSearchCompletion(logFilePath, 'page');
    const finalResults = resultsEvents.at(-1);

    expect(finalResults.entries).toHaveLength(1);
    expect(finalResults.entries[0].uuid).toBe('http-1');
    expect(finalResults.entries[0].entriesCount).toBe(4);
    expect(finalResults.entries[0].metadata).toMatchObject({
      groupingStrategy: 'http-context-heuristic',
      groupingConfidence: 'medium',
      requestPhase: 'finish'
    });
    expect(finalResults.entries[0].entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3, 4]);
    expect(finalResults.entries[0].entries[2].evidence).toMatchObject({
      sourceFileId: expect.stringMatching(/^src_/),
      rawLineId: expect.stringMatching(/^raw_/),
      anchorId: expect.stringMatching(/^anc_/),
      lineNumber: 3
    });

    const {
      getLiveRawLine,
      openLiveAnchor
    } = await import('../liveEvidenceStore.js');
    const thirdEntryEvidence = finalResults.entries[0].entries[2].evidence;

    expect(getLiveRawLine(thirdEntryEvidence.rawLineId)).toMatchObject({
      rawLineId: thirdEntryEvidence.rawLineId,
      lineNumber: 3,
      rawText: 'Parameters: {"page"=>"1"}'
    });
    expect(openLiveAnchor(thirdEntryEvidence.anchorId)).toMatchObject({
      anchorId: thirdEntryEvidence.anchorId,
      rawLineId: thirdEntryEvidence.rawLineId,
      lineNumber: 3
    });
  });

  it('falls back to a stream scan when indexed search throws unexpectedly', async () => {
    vi.doMock('../logIndex.js', async () => {
      const actual = await vi.importActual('../logIndex.js');

      return {
        ...actual,
        searchIndexedLogFile: vi.fn().mockRejectedValue(new Error('no such module: fts5')),
        startLogIndexing: vi.fn().mockResolvedValue({
          success: false
        })
      };
    });

    const logFilePath = await createTempLogFile([
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout',
      '[bb32797f-b087-4d45-9d99-28198952a784] INFO: ignore me'
    ].join('\n'));

    const { resultsEvents, statusEvents } = await waitForSearchCompletion(logFilePath, 'callback');
    const finalResults = resultsEvents.at(-1);
    const finalStatus = statusEvents.at(-1);

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.backend).toBe('scan');
    expect(finalResults.entries).toHaveLength(1);
    expect(finalResults.entries[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
    expect(finalResults.entries[0].entries[0].lineNumber).toBe(1);
  });

  it('keeps using sqlite search when the index is ready but the file has appended lines', async () => {
    const directoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logspect-search-stale-'));
    temporaryDirectories.push(directoryPath);

    const logFilePath = path.join(directoryPath, 'search.log');
    await fs.promises.writeFile(
      logFilePath,
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout',
      'utf8'
    );

    await waitForIndexReady(logFilePath, directoryPath);
    await fs.promises.appendFile(
      logFilePath,
      '\n[bb32797f-b087-4d45-9d99-28198952a784] INFO: appended tail'
    );

    const { resultsEvents, statusEvents } = await waitForSearchCompletion(logFilePath, 'callback timeout');
    const finalResults = resultsEvents.at(-1);
    const finalStatus = statusEvents.at(-1);

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.backend).toBe('sqlite');
    expect(finalStatus.bytesProcessed).toBeLessThan(finalStatus.totalBytes);
    expect(finalResults.entries).toHaveLength(1);
    expect(finalResults.entries[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
  });
});
