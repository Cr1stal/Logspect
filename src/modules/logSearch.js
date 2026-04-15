import fs from 'fs';
import log from 'electron-log';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  getLogIndexStorageDirectory,
  startLogIndexing
} from './logIndex.js';
import {
  MAX_SEARCH_RESULT_GROUPS,
  runLogSearchTask
} from './logSearchRunner.js';

let activeSearchId = 0;
let activeSearch = null;
let onSearchStatusCallback = null;
let onSearchResultsCallback = null;

const shouldRunSearchInProcess = () => (
  process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
);

const emitSearchStatus = (payload) => {
  if (onSearchStatusCallback) {
    onSearchStatusCallback(payload);
  }
};

const emitSearchResults = (payload) => {
  if (onSearchResultsCallback) {
    onSearchResultsCallback(payload);
  }
};

const isSearchCurrent = (searchState) => (
  activeSearch && activeSearch.id === searchState.id
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getWorkerPath = () => (
  path.join(__dirname, 'logSearchWorker.js')
);

const handleIndexRefreshRequest = (logFilePath) => {
  void startLogIndexing(logFilePath).catch((error) => {
    log.error('Background log indexing failed:', error);
  });
};

const buildWorkerExecArgv = () => (
  process.execArgv.filter(arg => !arg.startsWith('--input-type'))
);

const attachSearchWorker = (searchState, logFilePath, query) => {
  const worker = new Worker(getWorkerPath(), {
    workerData: {
      searchId: searchState.id,
      logFilePath,
      query,
      maxGroups: MAX_SEARCH_RESULT_GROUPS,
      logIndexStorageDirectory: getLogIndexStorageDirectory()
    },
    execArgv: buildWorkerExecArgv()
  });

  searchState.worker = worker;

  worker.on('message', (message) => {
    if (!isSearchCurrent(searchState)) {
      return;
    }

    if (message?.type === 'status') {
      searchState.lastStatus = message.payload;
      emitSearchStatus(message.payload);
      return;
    }

    if (message?.type === 'results') {
      emitSearchResults(message.payload);
      return;
    }

    if (message?.type === 'refresh-index' && message.logFilePath) {
      handleIndexRefreshRequest(message.logFilePath);
      return;
    }

    if (message?.type === 'done') {
      if (isSearchCurrent(searchState)) {
        activeSearch = null;
      }
    }
  });

  worker.on('error', (error) => {
    log.error('Log search worker failed:', error);

    if (!isSearchCurrent(searchState)) {
      return;
    }

    emitSearchStatus({
      searchId: searchState.id,
      query: searchState.query,
      backend: searchState.lastStatus?.backend ?? null,
      status: 'error',
      bytesProcessed: searchState.lastStatus?.bytesProcessed ?? 0,
      totalBytes: searchState.lastStatus?.totalBytes ?? 0,
      progressPercent: searchState.lastStatus?.progressPercent ?? 0,
      matchedLines: searchState.lastStatus?.matchedLines ?? 0,
      shownGroups: searchState.lastStatus?.shownGroups ?? 0,
      scannedLines: searchState.lastStatus?.scannedLines ?? 0,
      truncated: searchState.lastStatus?.truncated ?? false,
      error: error.message
    });

    activeSearch = null;
  });

  worker.on('exit', (code) => {
    if (!isSearchCurrent(searchState)) {
      return;
    }

    if (!searchState.cancelled && code !== 0) {
      emitSearchStatus({
        searchId: searchState.id,
        query: searchState.query,
        backend: searchState.lastStatus?.backend ?? null,
        status: 'error',
        bytesProcessed: searchState.lastStatus?.bytesProcessed ?? 0,
        totalBytes: searchState.lastStatus?.totalBytes ?? 0,
        progressPercent: searchState.lastStatus?.progressPercent ?? 0,
        matchedLines: searchState.lastStatus?.matchedLines ?? 0,
        shownGroups: searchState.lastStatus?.shownGroups ?? 0,
        scannedLines: searchState.lastStatus?.scannedLines ?? 0,
        truncated: searchState.lastStatus?.truncated ?? false,
        error: `Search worker exited unexpectedly with code ${code}.`
      });
    }

    activeSearch = null;
  });
};

export const setLogSearchStatusCallback = (callback) => {
  onSearchStatusCallback = callback;
};

export const setLogSearchResultsCallback = (callback) => {
  onSearchResultsCallback = callback;
};

export const cancelActiveLogSearch = () => {
  if (!activeSearch) {
    return {
      success: true,
      message: 'No active search to cancel.'
    };
  }

  const searchToCancel = activeSearch;
  activeSearch = null;
  searchToCancel.cancelled = true;

  if (searchToCancel.worker) {
    searchToCancel.worker.postMessage({
      type: 'cancel'
    });
    void searchToCancel.worker.terminate().catch((error) => {
      log.error('Failed to terminate log search worker:', error);
    });
  }

  return {
    success: true,
    message: 'Log search cancellation requested.',
    searchId: searchToCancel.id
  };
};

export const searchLogFile = async (logFilePath, query) => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      success: false,
      message: 'Search query cannot be empty.'
    };
  }

  cancelActiveLogSearch();

  const stats = await fs.promises.stat(logFilePath);
  const searchState = {
    id: ++activeSearchId,
    query: normalizedQuery,
    cancelled: false,
    worker: null,
    lastStatus: null
  };

  activeSearch = searchState;

  const emitStatusIfCurrent = (payload) => {
    if (!isSearchCurrent(searchState)) {
      return;
    }

    searchState.lastStatus = payload;
    emitSearchStatus(payload);
  };

  const emitResultsIfCurrent = (payload) => {
    if (!isSearchCurrent(searchState)) {
      return;
    }

    emitSearchResults(payload);
  };

  emitResultsIfCurrent({
    searchId: searchState.id,
    query: normalizedQuery,
    backend: 'scan',
    totalEntries: 0,
    entries: [],
    summary: {
      matchedLines: 0,
      shownGroups: 0,
      scannedLines: 0,
      truncated: false
    }
  });

  if (shouldRunSearchInProcess()) {
    const result = await runLogSearchTask(
      {
        searchId: searchState.id,
        logFilePath,
        query: normalizedQuery,
        maxGroups: MAX_SEARCH_RESULT_GROUPS,
        logIndexStorageDirectory: getLogIndexStorageDirectory()
      },
      {
        onStatus: emitStatusIfCurrent,
        onResults: emitResultsIfCurrent,
        onRequestIndexRefresh: handleIndexRefreshRequest,
        isCancelled: () => searchState.cancelled
      }
    );

    if (isSearchCurrent(searchState)) {
      activeSearch = null;
    }

    return result;
  }

  attachSearchWorker(searchState, logFilePath, normalizedQuery);

  return {
    success: true,
    searchId: searchState.id,
    query: normalizedQuery,
    totalBytes: stats.size
  };
};
