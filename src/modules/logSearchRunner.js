import fs from 'fs';
import util from 'node:util';
import log from 'electron-log';
import { streamFileLineRecords } from './fileLineStream.js';
import {
  appendLiveRawLine,
  registerLiveSourceFile
} from './liveEvidenceStore.js';
import {
  createParsingContext,
  mergeLogMetadata,
  parseLogLine
} from './logParser.js';
import {
  searchIndexedLogFile,
  setLogIndexStorageDirectory
} from './logIndex.js';

export const MAX_SEARCH_RESULT_GROUPS = 300;
const SEARCH_PROGRESS_INTERVAL_MS = 120;
const SEARCH_RESULTS_INTERVAL_MS = 250;
const SEARCH_STREAM_HIGH_WATER_MARK = 256 * 1024;
const SEARCH_YIELD_EVERY_N_LINES = 2000;
const SEARCH_SCAN_DISCOVERY_PROGRESS_PERCENT = 90;
const DISK_SEARCH_TIMESTAMP = new Date(0).toISOString();

export const createEmptySummary = () => ({
  matchedLines: 0,
  shownGroups: 0,
  scannedLines: 0,
  truncated: false
});

const normalizeQueryTokens = (query) => (
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
);

const createSearchRecord = (lineRecord, context) => {
  const parsed = parseLogLine(lineRecord.rawText, {
    context,
    lineNumber: lineRecord.lineNumber,
    fallbackGrouping: 'line-number'
  });

  if (!parsed?.uuid || !parsed.logInfo) {
    return null;
  }

  return {
    groupId: parsed.uuid,
    content: util.stripVTControlCharacters(parsed.content).trim(),
    logInfo: parsed.logInfo,
    lineNumber: lineRecord.lineNumber,
    byteStart: lineRecord.byteStart,
    byteEnd: lineRecord.byteEnd,
    rawText: lineRecord.rawText
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
    firstSeen: DISK_SEARCH_TIMESTAMP,
    lastSeen: DISK_SEARCH_TIMESTAMP,
    entries: [],
    searchMeta: {
      isDiskSearchResult: true,
      firstLineNumber: lineNumber,
      lastLineNumber: lineNumber,
      groupFirstLineNumber: lineNumber,
      groupLastLineNumber: lineNumber,
      matchedLineCount: 0,
      matchedLineNumbers: [],
      hasHiddenMatches: false
    }
  };
};

const appendRecordToGroup = (group, record, lineNumber, evidence = null) => {
  group.entriesCount += 1;
  group.lastSeen = DISK_SEARCH_TIMESTAMP;

  if (record.logInfo.success !== undefined && group.success === null) {
    group.success = record.logInfo.success;
  }

  if (record.logInfo.metadata && Object.keys(record.logInfo.metadata).length > 0) {
    group.metadata = mergeLogMetadata(group.metadata, record.logInfo.metadata);
  }

  group.searchMeta.groupFirstLineNumber = Math.min(group.searchMeta.groupFirstLineNumber, lineNumber);
  group.searchMeta.groupLastLineNumber = Math.max(group.searchMeta.groupLastLineNumber, lineNumber);
  group.entries.push({
    content: record.content,
    timestamp: group.lastSeen,
    lineNumber,
    isMatch: group.searchMeta.matchedLineNumbers.includes(lineNumber),
    ...(evidence ? { evidence } : {})
  });
};

const trackMatchedGroup = (matchedGroups, record, lineNumber) => {
  const existingGroup = matchedGroups.get(record.groupId);
  if (existingGroup) {
    existingGroup.matchedLineCount += 1;
    existingGroup.firstLineNumber = Math.min(existingGroup.firstLineNumber, lineNumber);
    existingGroup.lastLineNumber = Math.max(existingGroup.lastLineNumber, lineNumber);
    existingGroup.matchedLineNumbers.push(lineNumber);
    return existingGroup;
  }

  const nextGroup = {
    firstLineNumber: lineNumber,
    lastLineNumber: lineNumber,
    matchedLineCount: 1,
    matchedLineNumbers: [lineNumber]
  };
  matchedGroups.set(record.groupId, nextGroup);
  return nextGroup;
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

const runStreamScan = async (
  {
    searchId,
    logFilePath,
    query,
    totalBytes,
    maxGroups
  },
  {
    onStatus,
    onResults,
    isCancelled
  }
) => {
  const queryTokens = normalizeQueryTokens(query);
  const matchedGroups = new Map();
  const resultsByGroup = new Map();
  const discoveryParsingContext = createParsingContext();
  const scanSourceFile = registerLiveSourceFile({
    path: logFilePath
  });
  const summaryState = {
    matchedLines: 0,
    shownGroups: 0,
    scannedLines: 0,
    truncated: false
  };

  let discoveryBytesProcessed = 0;
  let fullGroupBytesProcessed = 0;
  let bytesProcessed = 0;
  let progressPercent = 0;
  let lastStatusEmitAt = 0;
  let lastResultsEmitAt = 0;
  let resultsDirty = false;

  const updateProgress = (phase) => {
    if (totalBytes === 0) {
      bytesProcessed = 0;
      progressPercent = 100;
      return;
    }

    const normalizedProgress = phase === 'full-groups'
      ? SEARCH_SCAN_DISCOVERY_PROGRESS_PERCENT + (
        (Math.min(fullGroupBytesProcessed, totalBytes) / totalBytes) * (100 - SEARCH_SCAN_DISCOVERY_PROGRESS_PERCENT)
      )
      : (
        (Math.min(discoveryBytesProcessed, totalBytes) / totalBytes) * SEARCH_SCAN_DISCOVERY_PROGRESS_PERCENT
      );

    progressPercent = Math.min(100, Math.round(normalizedProgress));
    bytesProcessed = Math.min(
      totalBytes,
      Math.round((progressPercent / 100) * totalBytes)
    );
  };

  const emitStatusUpdate = (status, force = false, errorMessage = null) => {
    const now = Date.now();
    if (!force && now - lastStatusEmitAt < SEARCH_PROGRESS_INTERVAL_MS) {
      return;
    }

    lastStatusEmitAt = now;

    onStatus({
      searchId,
      query,
      backend: 'scan',
      status,
      bytesProcessed: Math.min(bytesProcessed, totalBytes),
      totalBytes,
      progressPercent,
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

    onResults(
      buildResultsPayload(
        searchId,
        query,
        resultsByGroup,
        buildSummary(summaryState)
      )
    );
  };

  try {
    emitStatusUpdate('running', true);

    for await (const lineRecord of streamFileLineRecords(logFilePath, {
      encoding: 'utf8',
      highWaterMark: SEARCH_STREAM_HIGH_WATER_MARK
    })) {
      if (isCancelled()) {
        break;
      }

      discoveryBytesProcessed = lineRecord.byteEnd;
      updateProgress('discovery');
      summaryState.scannedLines = lineRecord.lineNumber;

      const record = createSearchRecord(lineRecord, discoveryParsingContext);
      if (!record) {
        continue;
      }

      if (!matchesQuery(buildSearchableText(record), queryTokens)) {
        if (lineRecord.lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
          emitStatusUpdate('running');
          emitResultsUpdate();
          await yieldToEventLoop();
        }
        continue;
      }

      summaryState.matchedLines += 1;
      const group = matchedGroups.get(record.groupId);
      if (!group && matchedGroups.size >= maxGroups) {
        summaryState.truncated = true;
        if (lineRecord.lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
          emitStatusUpdate('running');
          await yieldToEventLoop();
        }
        continue;
      }

      trackMatchedGroup(matchedGroups, record, lineRecord.lineNumber);
      summaryState.shownGroups = matchedGroups.size;

      if (lineRecord.lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
        emitStatusUpdate('running');
        await yieldToEventLoop();
      }
    }

    discoveryBytesProcessed = totalBytes;
    updateProgress('discovery');

    if (isCancelled()) {
      emitStatusUpdate('cancelled', true);
      emitResultsUpdate(true);
      return;
    }

    if (matchedGroups.size > 0) {
      const matchedGroupIds = new Set(matchedGroups.keys());
      const fullGroupParsingContext = createParsingContext();

      try {
        for await (const lineRecord of streamFileLineRecords(logFilePath, {
          encoding: 'utf8',
          highWaterMark: SEARCH_STREAM_HIGH_WATER_MARK
        })) {
          if (isCancelled()) {
            break;
          }

          fullGroupBytesProcessed = lineRecord.byteEnd;
          updateProgress('full-groups');

          const record = createSearchRecord(lineRecord, fullGroupParsingContext);
          if (!record || !matchedGroupIds.has(record.groupId)) {
            if (lineRecord.lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
              emitStatusUpdate('running');
              emitResultsUpdate();
              await yieldToEventLoop();
            }
            continue;
          }

          let group = resultsByGroup.get(record.groupId);
          if (!group) {
            const matchedGroup = matchedGroups.get(record.groupId);
            group = createStoredGroup(record, matchedGroup.firstLineNumber);
            group.searchMeta.firstLineNumber = matchedGroup.firstLineNumber;
            group.searchMeta.lastLineNumber = matchedGroup.lastLineNumber;
            group.searchMeta.matchedLineCount = matchedGroup.matchedLineCount;
            group.searchMeta.matchedLineNumbers = [...matchedGroup.matchedLineNumbers];
            group.searchMeta.groupFirstLineNumber = lineRecord.lineNumber;
            group.searchMeta.groupLastLineNumber = lineRecord.lineNumber;
            resultsByGroup.set(record.groupId, group);
          }

          const evidence = appendLiveRawLine({
            sourceFile: scanSourceFile,
            lineNumber: lineRecord.lineNumber,
            byteStart: lineRecord.byteStart,
            byteEnd: lineRecord.byteEnd,
            rawText: lineRecord.rawText,
            ingestedAtUtc: new Date().toISOString()
          }).evidence;

          appendRecordToGroup(group, record, lineRecord.lineNumber, evidence);
          resultsDirty = true;

          if (lineRecord.lineNumber % SEARCH_YIELD_EVERY_N_LINES === 0) {
            emitStatusUpdate('running');
            emitResultsUpdate();
            await yieldToEventLoop();
          }
        }

        fullGroupBytesProcessed = totalBytes;
        updateProgress('full-groups');
      } finally {
      }
    }

    if (isCancelled()) {
      emitStatusUpdate('cancelled', true);
      emitResultsUpdate(true);
      return;
    }

    bytesProcessed = totalBytes;
    progressPercent = 100;
    emitStatusUpdate('completed', true);
    emitResultsUpdate(true);
  } catch (error) {
    log.error('Error searching log file:', error);
    emitStatusUpdate('error', true, error.message);
    emitResultsUpdate(true);
  }
};

export const runLogSearchTask = async (
  {
    searchId,
    logFilePath,
    query,
    maxGroups = MAX_SEARCH_RESULT_GROUPS,
    logIndexStorageDirectory = null
  },
  {
    onStatus = () => {},
    onResults = () => {},
    onRequestIndexRefresh = () => {},
    isCancelled = () => false
  } = {}
) => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      success: false,
      message: 'Search query cannot be empty.'
    };
  }

  if (logIndexStorageDirectory) {
    setLogIndexStorageDirectory(logIndexStorageDirectory);
  }

  const stats = await fs.promises.stat(logFilePath);

  onResults({
    searchId,
    query: normalizedQuery,
    backend: 'scan',
    totalEntries: 0,
    entries: [],
    summary: createEmptySummary()
  });

  let indexedSearch = {
    success: false,
    reason: 'sqlite_error'
  };

  try {
    indexedSearch = await searchIndexedLogFile(
      logFilePath,
      normalizedQuery,
      {
        maxGroups
      }
    );
  } catch (error) {
    log.error('Indexed log search failed, falling back to stream scan:', error);
  }

  if (isCancelled()) {
    return {
      success: true,
      searchId,
      query: normalizedQuery,
      totalBytes: stats.size
    };
  }

  if (indexedSearch.success) {
    const coveredBytes = indexedSearch.coveredBytes ?? stats.size;

    if (indexedSearch.needsRefresh) {
      onRequestIndexRefresh(logFilePath);
    }

    onStatus({
      searchId,
      query: normalizedQuery,
      backend: indexedSearch.backend,
      status: 'completed',
      bytesProcessed: coveredBytes,
      totalBytes: stats.size,
      progressPercent: indexedSearch.coverageComplete === false && stats.size > 0
        ? Math.min(100, Math.round((coveredBytes / stats.size) * 100))
        : 100,
      ...indexedSearch.summary,
      error: null
    });

    onResults({
      searchId,
      query: normalizedQuery,
      backend: indexedSearch.backend,
      totalEntries: indexedSearch.results.totalEntries,
      entries: indexedSearch.results.entries,
      summary: indexedSearch.summary
    });

    return {
      success: true,
      searchId,
      query: normalizedQuery,
      totalBytes: stats.size,
      backend: indexedSearch.backend
    };
  }

  if (indexedSearch.reason === 'stale' || indexedSearch.reason === 'not_ready') {
    onRequestIndexRefresh(logFilePath);
  }

  await runStreamScan(
    {
      searchId,
      logFilePath,
      query: normalizedQuery,
      totalBytes: stats.size,
      maxGroups
    },
    {
      onStatus,
      onResults,
      isCancelled
    }
  );

  return {
    success: true,
    searchId,
    query: normalizedQuery,
    totalBytes: stats.size,
    backend: 'scan'
  };
};
