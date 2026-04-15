import fs from 'fs';
import readline from 'node:readline';
import util from 'node:util';
import log from 'electron-log';
import { extractLogInfo, jidRegex, uuidRegex } from './logParser.js';
import { searchIndexedLogFile, startLogIndexing } from './logIndex.js';

export const MAX_SEARCH_RESULT_GROUPS = 300;
export const MAX_SEARCH_RESULT_LINES_PER_GROUP = 200;
const SEARCH_PROGRESS_INTERVAL_MS = 120;
const SEARCH_RESULTS_INTERVAL_MS = 250;
const SEARCH_STREAM_HIGH_WATER_MARK = 256 * 1024;
const SEARCH_YIELD_EVERY_N_LINES = 2000;

let activeSearchId = 0;
let activeSearch = null;
let onSearchStatusCallback = null;
let onSearchResultsCallback = null;

const createEmptySummary = () => ({
  matchedLines: 0,
  shownGroups: 0,
  scannedLines: 0,
  truncated: false
});

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

const normalizeQueryTokens = (query) => (
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
);

const createSearchRecord = (rawLine, lineNumber) => {
  const sanitizedLine = util.stripVTControlCharacters(rawLine).trim();
  if (!sanitizedLine) {
    return null;
  }

  const uuidMatch = sanitizedLine.match(uuidRegex);
  if (uuidMatch) {
    const content = sanitizedLine.replace(uuidRegex, '').trim();
    return {
      groupId: uuidMatch[1],
      content,
      logInfo: extractLogInfo(content)
    };
  }

  const jidMatch = sanitizedLine.match(jidRegex);
  if (jidMatch) {
    return {
      groupId: jidMatch[2],
      content: sanitizedLine,
      logInfo: extractLogInfo(sanitizedLine)
    };
  }

  return {
    groupId: `line-${lineNumber}`,
    content: sanitizedLine,
    logInfo: extractLogInfo(sanitizedLine)
  };
};

const buildSearchableText = (record) => {
  const metadataValues = Object.values(record.logInfo.metadata || {}).join(' ');
  return [
    record.groupId,
    record.logInfo.type,
    record.logInfo.subType,
    record.logInfo.title,
    metadataValues,
    record.content
  ].join(' ').toLowerCase();
};

const matchesQuery = (searchableText, tokens) => (
  tokens.every(token => searchableText.includes(token))
);

const createStoredGroup = (record, lineNumber) => {
  const timestamp = new Date().toISOString();

  return {
    uuid: record.groupId,
    type: record.logInfo.type || 'unknown',
    subType: record.logInfo.subType || 'unknown',
    success: record.logInfo.success !== undefined ? record.logInfo.success : null,
    metadata: {
      ...(record.logInfo.metadata || {})
    },
    title: record.logInfo.title || 'Search Match',
    entriesCount: 0,
    firstSeen: timestamp,
    lastSeen: timestamp,
    entries: [],
    searchMeta: {
      isDiskSearchResult: true,
      firstLineNumber: lineNumber,
      lastLineNumber: lineNumber,
      hasHiddenMatches: false
    }
  };
};

const appendMatchedLineToGroup = (group, record, lineNumber) => {
  group.entriesCount += 1;
  group.lastSeen = new Date().toISOString();

  if (record.logInfo.success !== undefined && group.success === null) {
    group.success = record.logInfo.success;
  }

  if (record.logInfo.metadata && Object.keys(record.logInfo.metadata).length > 0) {
    group.metadata = {
      ...group.metadata,
      ...record.logInfo.metadata
    };
  }

  group.searchMeta.firstLineNumber = Math.min(group.searchMeta.firstLineNumber, lineNumber);
  group.searchMeta.lastLineNumber = Math.max(group.searchMeta.lastLineNumber, lineNumber);

  if (group.entries.length < MAX_SEARCH_RESULT_LINES_PER_GROUP) {
    group.entries.push({
      content: record.content,
      timestamp: group.lastSeen,
      lineNumber
    });
    return false;
  } else {
    group.searchMeta.hasHiddenMatches = true;
    return true;
  }
};

const buildSummary = ({ matchedLines, shownGroups, scannedLines, truncated }) => ({
  matchedLines,
  shownGroups,
  scannedLines,
  truncated
});

const buildResultsPayload = (searchId, query, resultsByGroup, summary) => ({
  searchId,
  query,
  backend: 'scan',
  totalEntries: resultsByGroup.size,
  entries: Array.from(resultsByGroup.values()),
  summary
});

const yieldToEventLoop = () => (
  new Promise((resolve) => {
    setImmediate(resolve);
  })
);

const isSearchCurrent = (searchState) => (
  activeSearch && activeSearch.id === searchState.id
);

const runSearch = async (searchState, logFilePath, query, totalBytes) => {
  const queryTokens = normalizeQueryTokens(query);
  const resultsByGroup = new Map();
  const summaryState = {
    matchedLines: 0,
    shownGroups: 0,
    scannedLines: 0,
    truncated: false
  };

  let bytesProcessed = 0;
  let lastStatusEmitAt = 0;
  let lastResultsEmitAt = 0;
  let resultsDirty = false;

  const emitStatusUpdate = (status, force = false, errorMessage = null) => {
    const now = Date.now();
    if (!force && now - lastStatusEmitAt < SEARCH_PROGRESS_INTERVAL_MS) {
      return;
    }

    lastStatusEmitAt = now;

    emitSearchStatus({
      searchId: searchState.id,
      query,
      backend: 'scan',
      status,
      bytesProcessed: Math.min(bytesProcessed, totalBytes),
      totalBytes,
      progressPercent: totalBytes === 0
        ? 100
        : Math.min(100, Math.round((Math.min(bytesProcessed, totalBytes) / totalBytes) * 100)),
      ...buildSummary(summaryState),
      error: errorMessage
    });
  };

  const emitResultsUpdate = (force = false) => {
    const now = Date.now();
    if (!force && (!resultsDirty || now - lastResultsEmitAt < SEARCH_RESULTS_INTERVAL_MS)) {
      return;
    }

    lastResultsEmitAt = now;
    resultsDirty = false;

    emitSearchResults(
      buildResultsPayload(
        searchState.id,
        query,
        resultsByGroup,
        buildSummary(summaryState)
      )
    );
  };

  const stream = fs.createReadStream(logFilePath, {
    encoding: 'utf8',
    highWaterMark: SEARCH_STREAM_HIGH_WATER_MARK
  });

  stream.on('data', (chunk) => {
    bytesProcessed += Buffer.byteLength(chunk, 'utf8');
    emitStatusUpdate('running');
    emitResultsUpdate();
  });

  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  try {
    emitStatusUpdate('running', true);

    let lineNumber = 0;

    for await (const rawLine of lineReader) {
      if (searchState.cancelled) {
        lineReader.close();
        stream.destroy();
        break;
      }

      lineNumber += 1;
      summaryState.scannedLines = lineNumber;

      const record = createSearchRecord(rawLine, lineNumber);
      if (!record) {
        continue;
      }

      if (!matchesQuery(buildSearchableText(record), queryTokens)) {
        if (lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
          emitStatusUpdate('running');
          emitResultsUpdate();
          await yieldToEventLoop();
        }
        continue;
      }

      summaryState.matchedLines += 1;

      let group = resultsByGroup.get(record.groupId);
      if (!group) {
        if (resultsByGroup.size >= MAX_SEARCH_RESULT_GROUPS) {
          summaryState.truncated = true;
          if (lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
            emitStatusUpdate('running');
            emitResultsUpdate();
            await yieldToEventLoop();
          }
          continue;
        }

        group = createStoredGroup(record, lineNumber);
        resultsByGroup.set(record.groupId, group);
        summaryState.shownGroups = resultsByGroup.size;
      }

      const reachedStoredLineLimit = appendMatchedLineToGroup(group, record, lineNumber);
      if (reachedStoredLineLimit) {
        summaryState.truncated = true;
      }
      resultsDirty = true;

      if (lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
        emitStatusUpdate('running');
        emitResultsUpdate();
        await yieldToEventLoop();
      }
    }

    bytesProcessed = totalBytes;

    if (searchState.cancelled) {
      emitStatusUpdate('cancelled', true);
      emitResultsUpdate(true);
      return;
    }

    emitStatusUpdate('completed', true);
    emitResultsUpdate(true);
  } catch (error) {
    log.error('Error searching log file:', error);
    emitStatusUpdate('error', true, error.message);
    emitResultsUpdate(true);
  } finally {
    lineReader.close();
    stream.destroy();

    if (isSearchCurrent(searchState)) {
      activeSearch = null;
    }
  }
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

  activeSearch.cancelled = true;

  return {
    success: true,
    message: 'Log search cancellation requested.',
    searchId: activeSearch.id
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
    cancelled: false
  };

  activeSearch = searchState;

  emitSearchResults({
    searchId: searchState.id,
    query: normalizedQuery,
    backend: 'scan',
    totalEntries: 0,
    entries: [],
    summary: createEmptySummary()
  });

  const indexedSearch = await searchIndexedLogFile(
    logFilePath,
    normalizedQuery,
    {
      maxGroups: MAX_SEARCH_RESULT_GROUPS,
      maxLinesPerGroup: MAX_SEARCH_RESULT_LINES_PER_GROUP
    }
  );

  if (searchState.cancelled) {
    return {
      success: true,
      searchId: searchState.id,
      query: normalizedQuery,
      totalBytes: stats.size
    };
  }

  if (indexedSearch.success) {
    emitSearchStatus({
      searchId: searchState.id,
      query: normalizedQuery,
      backend: indexedSearch.backend,
      status: 'completed',
      bytesProcessed: stats.size,
      totalBytes: stats.size,
      progressPercent: 100,
      ...indexedSearch.summary,
      error: null
    });

    emitSearchResults({
      searchId: searchState.id,
      query: normalizedQuery,
      backend: indexedSearch.backend,
      totalEntries: indexedSearch.results.totalEntries,
      entries: indexedSearch.results.entries,
      summary: indexedSearch.summary
    });

    if (isSearchCurrent(searchState)) {
      activeSearch = null;
    }

    return {
      success: true,
      searchId: searchState.id,
      query: normalizedQuery,
      totalBytes: stats.size,
      backend: indexedSearch.backend
    };
  }

  if (indexedSearch.reason === 'stale' || indexedSearch.reason === 'not_ready') {
    void startLogIndexing(logFilePath);
  }

  emitSearchStatus({
    searchId: searchState.id,
    query: normalizedQuery,
    backend: 'scan',
    status: 'running',
    bytesProcessed: 0,
    totalBytes: stats.size,
    progressPercent: 0,
    ...createEmptySummary(),
    error: null
  });

  void runSearch(searchState, logFilePath, normalizedQuery, stats.size);

  return {
    success: true,
    searchId: searchState.id,
    query: normalizedQuery,
    totalBytes: stats.size,
    backend: 'scan'
  };
};
