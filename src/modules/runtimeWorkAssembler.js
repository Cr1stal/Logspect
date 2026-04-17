import util from 'util'

import {
  extractHttpSignal,
  extractLogInfo,
  jidRegex,
  uuidRegex
} from './logClassification.js'

const GROUPING_CONFIDENCE_ORDER = {
  low: 0,
  medium: 1,
  high: 2
};

const createEmptyParsingContext = () => ({
  lastAppSystemLogTime: null,
  lastAppSystemLogUuid: null,
  nextSyntheticHttpGroup: 1,
  openHttpRequests: []
});

let defaultParsingContext = createEmptyParsingContext();

const getWeakerConfidence = (left = null, right = null) => {
  if (!left) {
    return right || null;
  }

  if (!right) {
    return left;
  }

  return GROUPING_CONFIDENCE_ORDER[left] <= GROUPING_CONFIDENCE_ORDER[right]
    ? left
    : right;
};

const generateTimeBasedUuid = (context) => {
  const now = new Date();
  const currentTime = now.getTime();

  if (!context.lastAppSystemLogTime || (currentTime - context.lastAppSystemLogTime) > 2000) {
    context.lastAppSystemLogTime = currentTime;
    context.lastAppSystemLogUuid = `sys-${currentTime}`;
    return context.lastAppSystemLogUuid;
  }

  context.lastAppSystemLogTime = currentTime;
  return context.lastAppSystemLogUuid;
};

const buildSyntheticHttpGroupId = (context, lineNumber = null) => {
  if (typeof lineNumber === 'number') {
    return `http-${lineNumber}`;
  }

  const groupId = `http-live-${context.nextSyntheticHttpGroup}`;
  context.nextSyntheticHttpGroup += 1;
  return groupId;
};

const registerOpenHttpRequest = (context, request) => {
  context.openHttpRequests.push({
    ...request,
    open: true
  });
};

const closeOpenHttpRequest = (context, groupId) => {
  const request = [...context.openHttpRequests]
    .reverse()
    .find(candidate => candidate.open && candidate.groupId === groupId);

  if (request) {
    request.open = false;
  }
};

const resolveHttpCandidate = (context, signal) => {
  const openRequests = context.openHttpRequests.filter(candidate => candidate.open);

  if (openRequests.length === 0) {
    return {
      matchedRequest: null,
      confidence: 'low',
      ambiguous: false,
      ambiguityReason: 'orphan-http-line'
    };
  }

  if (signal.method && signal.path) {
    const exactMatches = openRequests.filter((candidate) => (
      candidate.method === signal.method && candidate.path === signal.path
    ));

    if (exactMatches.length === 1) {
      return {
        matchedRequest: exactMatches[0],
        confidence: exactMatches[0].confidence,
        ambiguous: false,
        ambiguityReason: null
      };
    }

    if (exactMatches.length > 1) {
      return {
        matchedRequest: exactMatches[exactMatches.length - 1],
        confidence: 'low',
        ambiguous: true,
        ambiguityReason: 'multiple-http-requests-with-same-method-and-path'
      };
    }
  }

  if (openRequests.length === 1) {
    return {
      matchedRequest: openRequests[0],
      confidence: openRequests[0].confidence,
      ambiguous: false,
      ambiguityReason: null
    };
  }

  return {
    matchedRequest: openRequests[openRequests.length - 1],
    confidence: 'low',
    ambiguous: true,
    ambiguityReason: 'multiple-open-http-requests'
  };
};

const mergeGroupingFlags = (existingMetadata = {}, incomingMetadata = {}) => {
  const mergedMetadata = {
    ...existingMetadata,
    ...incomingMetadata
  };

  mergedMetadata.groupingConfidence = getWeakerConfidence(
    existingMetadata.groupingConfidence,
    incomingMetadata.groupingConfidence
  );

  if (existingMetadata.groupingAmbiguous || incomingMetadata.groupingAmbiguous) {
    mergedMetadata.groupingAmbiguous = true;
  }

  mergedMetadata.groupingStrategy = incomingMetadata.groupingStrategy
    || existingMetadata.groupingStrategy
    || null;

  mergedMetadata.groupingAmbiguityReason = incomingMetadata.groupingAmbiguityReason
    || existingMetadata.groupingAmbiguityReason
    || null;

  return mergedMetadata;
};

const buildParsedRecord = ({
  groupId,
  content,
  logInfo,
  groupingStrategy,
  groupingConfidence,
  groupingAmbiguous = false,
  groupingAmbiguityReason = null
}) => {
  const metadata = mergeGroupingFlags(logInfo.metadata, {
    groupingStrategy,
    groupingConfidence,
    groupingAmbiguous,
    groupingAmbiguityReason
  });

  return {
    uuid: groupId,
    content: util.stripVTControlCharacters(content),
    isNewEntry: false,
    logInfo: {
      ...logInfo,
      metadata
    }
  };
};

export const createParsingContext = () => createEmptyParsingContext();

export const resetDefaultParsingContext = () => {
  defaultParsingContext = createEmptyParsingContext();
};

export const mergeLogMetadata = (existingMetadata = {}, incomingMetadata = {}) => (
  mergeGroupingFlags(existingMetadata, incomingMetadata)
);

export const parseLogLine = (logLine, options = {}) => {
  const {
    context = defaultParsingContext,
    lineNumber = null,
    fallbackGrouping = 'time-window'
  } = options;

  const uuidMatch = logLine.match(uuidRegex);
  if (uuidMatch) {
    const uuid = uuidMatch[1];
    const content = logLine.replace(uuidRegex, '').trim();
    const logInfo = extractLogInfo(content);
    const httpSignal = extractHttpSignal(content);

    if (httpSignal?.phase === 'start') {
      registerOpenHttpRequest(context, {
        groupId: uuid,
        method: httpSignal.method,
        path: httpSignal.path,
        confidence: 'high'
      });
    }

    if (httpSignal?.phase === 'finish') {
      closeOpenHttpRequest(context, uuid);
    }

    return buildParsedRecord({
      groupId: uuid,
      content,
      logInfo,
      groupingStrategy: 'uuid',
      groupingConfidence: 'high'
    });
  }

  const jidMatch = logLine.match(jidRegex);
  if (jidMatch) {
    const jid = jidMatch[2];
    const content = logLine.trim();
    const logInfo = extractLogInfo(content);

    return buildParsedRecord({
      groupId: jid,
      content,
      logInfo,
      groupingStrategy: 'jid',
      groupingConfidence: 'high'
    });
  }

  const content = logLine.trim();
  const logInfo = extractLogInfo(content);
  const httpSignal = extractHttpSignal(content);

  if (httpSignal) {
    if (httpSignal.phase === 'start') {
      const groupId = buildSyntheticHttpGroupId(context, lineNumber);
      registerOpenHttpRequest(context, {
        groupId,
        method: httpSignal.method,
        path: httpSignal.path,
        confidence: 'medium'
      });

      return buildParsedRecord({
        groupId,
        content,
        logInfo,
        groupingStrategy: 'http-start-heuristic',
        groupingConfidence: 'medium'
      });
    }

    if (httpSignal.phase === 'summary') {
      return buildParsedRecord({
        groupId: buildSyntheticHttpGroupId(context, lineNumber),
        content,
        logInfo,
        groupingStrategy: 'http-summary-heuristic',
        groupingConfidence: 'medium'
      });
    }

    const resolvedCandidate = resolveHttpCandidate(context, httpSignal);
    const groupId = resolvedCandidate.matchedRequest
      ? resolvedCandidate.matchedRequest.groupId
      : buildSyntheticHttpGroupId(context, lineNumber);

    if (httpSignal.phase === 'finish' && resolvedCandidate.matchedRequest) {
      closeOpenHttpRequest(context, resolvedCandidate.matchedRequest.groupId);
    }

    return buildParsedRecord({
      groupId,
      content,
      logInfo,
      groupingStrategy: resolvedCandidate.matchedRequest
        ? 'http-context-heuristic'
        : 'http-orphan-line',
      groupingConfidence: resolvedCandidate.confidence,
      groupingAmbiguous: resolvedCandidate.ambiguous,
      groupingAmbiguityReason: resolvedCandidate.ambiguityReason
    });
  }

  if (logInfo.type === 'app' && logInfo.subType === 'sys') {
    if (fallbackGrouping === 'line-number' && typeof lineNumber === 'number') {
      return buildParsedRecord({
        groupId: `line-${lineNumber}`,
        content,
        logInfo,
        groupingStrategy: 'line-fallback',
        groupingConfidence: 'low'
      });
    }

    const timeBasedUuid = generateTimeBasedUuid(context);

    return buildParsedRecord({
      groupId: timeBasedUuid,
      content,
      logInfo,
      groupingStrategy: 'system-gap',
      groupingConfidence: 'medium'
    });
  }

  if (fallbackGrouping === 'line-number' && typeof lineNumber === 'number') {
    return buildParsedRecord({
      groupId: `line-${lineNumber}`,
      content,
      logInfo,
      groupingStrategy: 'line-fallback',
      groupingConfidence: 'low'
    });
  }

  return {
    uuid: null,
    content,
    isNewEntry: false
  };
};

export const parseLogLines = (lines, options = {}) => {
  return lines
    .filter(line => line.trim())
    .map((line, index) => parseLogLine(line, {
      ...options,
      lineNumber: Number.isInteger(options.lineNumberOffset)
        ? options.lineNumberOffset + index
        : options.lineNumber ?? null
    }));
};
