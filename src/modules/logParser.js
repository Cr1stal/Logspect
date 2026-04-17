import util from 'util'

/**
 * Regex to extract UUID from log lines like [aa32797f-b087-4d45-9d99-28198952a784]
 */
export const uuidRegex = /^\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/;

/**
 * Regex to extract jid from background job logs like "class=Workers::Database::RefreshMaterializedView jid=73f8e97e7e79413a3006f4ea"
 */
export const jidRegex = /class=([^\s]+)\s+jid=([a-f0-9]+)/;

const HTTP_METHOD_PATTERN = '(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)';
const startedHttpRegex = new RegExp(`^Started\\s+${HTTP_METHOD_PATTERN}\\s+([^\\s]+)`, 'i');
const inlineHttpRegex = new RegExp(`${HTTP_METHOD_PATTERN}\\s+([^\\s]+)`, 'i');
const completedHttpRegex = /^Completed\s+(\d{3})\b.*?\bin\s+(\d+(?:\.\d+)?)ms\b/i;
const processingHttpRegex = /^Processing by\s+([^\s]+)#([^\s]+)(?:\s+as\s+([^\s]+))?/i;
const parametersHttpRegex = /^Parameters:\s+/i;
const renderedHttpRegex = /^(Rendered|Rendering)\s+/i;
const redirectedHttpRegex = /^Redirected to\s+(.+)/i;
const filterChainHaltedHttpRegex = /^Filter chain halted as\s+/i;
const sentHttpRegex = /^(Sent file|Sent data)\s+/i;
const performedHttpRegex = /^Performed\s+/i;

const GROUPING_CONFIDENCE_ORDER = {
  low: 0,
  medium: 1,
  high: 2
};

/**
 * Track the last app system log timestamp and UUID for gap-based grouping
 */
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

const withGroupingMetadata = (logInfo, metadata = {}) => ({
  ...logInfo,
  metadata: {
    ...(logInfo.metadata || {}),
    ...metadata
  }
});

/**
 * Generates a time-based UUID that groups logs based on 2-second gaps
 * @returns {string} Time-based UUID
 */
const generateTimeBasedUuid = (context) => {
  const now = new Date();
  const currentTime = now.getTime();

  // If this is the first app system log, or more than 2 seconds have passed since the last one,
  // create a new group
  if (!context.lastAppSystemLogTime || (currentTime - context.lastAppSystemLogTime) > 2000) {
    context.lastAppSystemLogTime = currentTime;
    context.lastAppSystemLogUuid = `sys-${currentTime}`;
    return context.lastAppSystemLogUuid;
  }

  // Update the last seen time for the current group
  context.lastAppSystemLogTime = currentTime;

  // Return the existing group UUID
  return context.lastAppSystemLogUuid;
};

const extractHttpSignal = (content) => {
  const startedMatch = content.match(startedHttpRegex);
  if (startedMatch) {
    return {
      phase: 'start',
      method: startedMatch[1].toUpperCase(),
      path: startedMatch[2]
    };
  }

  const completedMatch = content.match(completedHttpRegex);
  if (completedMatch) {
    return {
      phase: 'finish',
      statusCode: parseInt(completedMatch[1], 10),
      responseTime: parseFloat(completedMatch[2])
    };
  }

  const processingMatch = content.match(processingHttpRegex);
  if (processingMatch) {
    return {
      phase: 'processing',
      controller: processingMatch[1],
      action: processingMatch[2],
      format: processingMatch[3] || null
    };
  }

  if (parametersHttpRegex.test(content)) {
    return {
      phase: 'parameters'
    };
  }

  if (renderedHttpRegex.test(content)) {
    return {
      phase: 'render'
    };
  }

  const redirectedMatch = content.match(redirectedHttpRegex);
  if (redirectedMatch) {
    return {
      phase: 'redirect',
      location: redirectedMatch[1]
    };
  }

  if (filterChainHaltedHttpRegex.test(content)) {
    return {
      phase: 'filter_halt'
    };
  }

  if (sentHttpRegex.test(content)) {
    return {
      phase: 'send'
    };
  }

  if (performedHttpRegex.test(content)) {
    return {
      phase: 'performed'
    };
  }

  const inlineMatch = content.match(inlineHttpRegex);
  if (inlineMatch) {
    const metrics = extractHttpResultMetrics(content);
    return {
      phase: 'summary',
      method: inlineMatch[1].toUpperCase(),
      path: inlineMatch[2],
      statusCode: metrics.statusCode,
      responseTime: metrics.responseTime
    };
  }

  return null;
};

const createHttpLogInfo = (signal) => {
  const logInfo = {
    type: 'web',
    subType: signal.method || 'HTTP',
    success: null,
    metadata: {
      requestPhase: signal.phase
    },
    title: 'HTTP Request'
  };

  if (signal.method) {
    logInfo.metadata.method = signal.method;
  }

  if (signal.path) {
    logInfo.metadata.path = signal.path;
  }

  if (signal.phase === 'start' || signal.phase === 'summary') {
    logInfo.subType = signal.method;
    logInfo.title = `${signal.method} ${signal.path}`;
  }

  if (signal.phase === 'summary') {
    if (signal.statusCode !== null) {
      logInfo.metadata.statusCode = signal.statusCode;
      logInfo.success = signal.statusCode >= 200 && signal.statusCode < 400;
    }

    if (signal.responseTime !== null) {
      logInfo.metadata.responseTime = signal.responseTime;
    }
  }

  if (signal.phase === 'finish') {
    logInfo.metadata.statusCode = signal.statusCode;
    logInfo.metadata.responseTime = signal.responseTime;
    logInfo.success = signal.statusCode >= 200 && signal.statusCode < 400;
    logInfo.title = `HTTP ${signal.statusCode}`;
  }

  if (signal.phase === 'processing') {
    logInfo.metadata.controller = signal.controller;
    logInfo.metadata.action = signal.action;
    if (signal.format) {
      logInfo.metadata.format = signal.format;
    }
    logInfo.title = `${signal.controller}#${signal.action}`;
  }

  if (signal.phase === 'parameters') {
    logInfo.title = 'Request Parameters';
  }

  if (signal.phase === 'render') {
    logInfo.title = 'Rendered View';
  }

  if (signal.phase === 'redirect') {
    logInfo.metadata.location = signal.location;
    logInfo.title = `Redirected to ${signal.location}`;
  }

  if (signal.phase === 'filter_halt') {
    logInfo.title = 'Filter Chain Halted';
  }

  if (signal.phase === 'send') {
    logInfo.title = 'Response Payload';
  }

  if (signal.phase === 'performed') {
    logInfo.title = 'Performed Request';
  }

  return logInfo;
};

const buildSyntheticHttpGroupId = (context, lineNumber = null) => {
  if (typeof lineNumber === 'number') {
    return `http-${lineNumber}`;
  }

  const groupId = `http-live-${context.nextSyntheticHttpGroup}`;
  context.nextSyntheticHttpGroup += 1;
  return groupId;
};

const extractHttpResultMetrics = (content) => {
  const statusMatch = content.match(/\b(\d{3})\b/);
  const responseTimeMatch = content.match(/(\d+(?:\.\d+)?)\s*ms\b/i);

  return {
    statusCode: statusMatch ? parseInt(statusMatch[1], 10) : null,
    responseTime: responseTimeMatch ? parseFloat(responseTimeMatch[1]) : null
  };
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

/**
 * Extracts log information including type, subType, success, metadata and title
 * @param {string} content - The log line content
 * @returns {{type: string, subType: string, success: boolean|null, metadata: object, title: string}}
 */
export const extractLogInfo = (content) => {
  // Default structure for system logs
  let logInfo = {
    type: 'app',
    subType: 'sys',
    success: null,
    metadata: {},
    title: 'System Log'
  };

  // Pattern 1: Background job logs (check first since they have a specific format)
  const jidMatch = content.match(jidRegex);
  if (jidMatch) {
    const jobClass = jidMatch[1];
    const jid = jidMatch[2];

    logInfo.type = 'worker';
    logInfo.subType = 'job';
    logInfo.title = jobClass.split('::').pop(); // Get the last part of the class name
    logInfo.metadata.jobClass = jobClass;
    logInfo.metadata.jid = jid;

    // Extract elapsed time from "done" messages
    const elapsedMatch = content.match(/elapsed=([\d.]+)/);
    if (elapsedMatch) {
      logInfo.metadata.elapsed = parseFloat(elapsedMatch[1]);
    }

    // Determine success status
    if (content.includes('INFO: done')) {
      logInfo.success = true;
    } else if (content.includes('ERROR:') || content.includes('FATAL:')) {
      logInfo.success = false;
    } else if (content.includes('INFO: start')) {
      logInfo.success = null; // Job started, outcome unknown
    }

    // Extract database timing from DEBUG messages
    const dbTimingMatch = content.match(/\(([0-9.]+)ms\)/);
    if (dbTimingMatch) {
      logInfo.metadata.dbTiming = parseFloat(dbTimingMatch[1]);
    }

    return logInfo;
  }

  const httpSignal = extractHttpSignal(content);
  if (httpSignal) {
    return createHttpLogInfo(httpSignal);
  }

  // Everything else is a system log - extract meaningful title
  const words = content.trim().split(/\s+/).filter(word =>
    word.length > 2 && !word.match(/^\[|\]$|^\d+$|^(INFO|DEBUG|WARN|ERROR|FATAL)$/i)
  );

  if (words.length > 0) {
    logInfo.title = words.slice(0, 4).join(' ');
    if (logInfo.title.length > 50) {
      logInfo.title = logInfo.title.substring(0, 50) + '...';
    }
  }

  // Determine success status for system logs
  const levelMatch = content.match(/(INFO|DEBUG|WARN|ERROR|FATAL)/i);
  if (levelMatch) {
    logInfo.success = !['ERROR', 'FATAL'].includes(levelMatch[1].toUpperCase());
  }

  return logInfo;
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

/**
 * Parses a single log line and extracts information
 * @param {string} logLine - The log line to parse
 * @returns {{uuid: string|null, content: string, isNewEntry: boolean, logInfo?: object}}
 */
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

  // First try to match UUID format [uuid]
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

  // Then try to match background job format with jid
  const jidMatch = logLine.match(jidRegex);
  if (jidMatch) {
    const jid = jidMatch[2]; // Use jid as uuid
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

  // Only generate time-based UUID for system logs
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

/**
 * Processes multiple log lines and returns parsed entries
 * @param {string[]} lines - Array of log lines to process
 * @returns {Array<{uuid: string|null, content: string, logInfo?: object}>}
 */
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

/**
 * Validates if a string looks like a valid UUID
 * @param {string} uuid - The UUID to validate
 * @returns {boolean}
 */
export const isValidUuid = (uuid) => {
  if (!uuid || typeof uuid !== 'string') return false;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uuid);
};

/**
 * Validates if a string looks like a valid job ID (jid)
 * @param {string} jid - The job ID to validate
 * @returns {boolean}
 */
export const isValidJid = (jid) => {
  if (!jid || typeof jid !== 'string') return false;
  return /^[a-f0-9]{24}$/.test(jid); // Sidekiq jids are typically 24 hex characters
};
