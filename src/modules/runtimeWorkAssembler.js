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

const getRequestActivityLine = (request) => (
  request.lastMatchedLineNumber ?? request.startLineNumber ?? -1
);

const selectMostRecentlyActiveRequest = (requests) => (
  [...requests].sort((left, right) => {
    const activityDelta = getRequestActivityLine(left) - getRequestActivityLine(right);
    if (activityDelta !== 0) {
      return activityDelta;
    }

    return (left.startLineNumber ?? -1) - (right.startLineNumber ?? -1);
  }).at(-1) ?? null
);

const updateOpenHttpRequest = (context, groupId, patch = {}) => {
  const request = context.openHttpRequests.find(candidate => candidate.groupId === groupId);

  if (!request) {
    return null;
  }

  Object.assign(request, patch);
  return request;
};

const closeOpenHttpRequest = (context, groupId) => {
  const request = [...context.openHttpRequests]
    .reverse()
    .find(candidate => candidate.open && candidate.groupId === groupId);

  if (request) {
    request.open = false;
  }
};

const isApiRequest = (request) => (
  request.controller?.startsWith('Api::')
  || request.path?.startsWith('/api/')
  || request.format === 'JSON'
);

const isViewRequest = (request) => !isApiRequest(request);

const singularizeToken = (value) => value.endsWith('s') ? value.slice(0, -1) : value;

const normalizeControllerSegment = (segment) => segment
  .replace(/Controller$/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .toLowerCase();

const renderTargetMatchesRequest = (renderTarget, request) => {
  if (!renderTarget || !request.controller) {
    return false;
  }

  const targetLeaf = renderTarget.split('::').pop();
  if (!targetLeaf || /^(Null|CollectionSerializer)$/i.test(targetLeaf)) {
    return false;
  }

  const serializerStem = targetLeaf.replace(/Serializer$/i, '').toLowerCase();
  const controllerStem = request.controller
    .split('::')
    .pop()
    .replace(/Controller$/i, '')
    .toLowerCase();

  return singularizeToken(serializerStem) === singularizeToken(controllerStem);
};

const controllerMatchesRequestPath = (controller, requestPath) => {
  if (!controller || !requestPath) {
    return false;
  }

  const pathSegments = requestPath
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map(segment => segment.toLowerCase());
  const controllerSegments = controller
    .split('::')
    .map(normalizeControllerSegment)
    .filter(segment => !['api', 'controller'].includes(segment) && !/^v\d+$/i.test(segment));

  if (pathSegments.length === 0 || controllerSegments.length === 0) {
    return false;
  }

  const comparableSegments = controllerSegments.slice(-Math.min(3, controllerSegments.length));

  for (let index = 0; index <= pathSegments.length - comparableSegments.length; index += 1) {
    const candidateWindow = pathSegments.slice(index, index + comparableSegments.length);
    if (candidateWindow.every((segment, segmentIndex) => (
      singularizeToken(segment) === singularizeToken(comparableSegments[segmentIndex])
    ))) {
      return true;
    }
  }

  return false;
};

const buildHttpRequestPatch = (signal, lineNumber) => {
  const patch = {
    lastMatchedLineNumber: lineNumber,
    lastSignalPhase: signal.phase
  };

  if (signal.method) {
    patch.method = signal.method;
  }

  if (signal.path) {
    patch.path = signal.path;
  }

  if (signal.controller) {
    patch.controller = signal.controller;
  }

  if (signal.action) {
    patch.action = signal.action;
  }

  if (signal.format) {
    patch.format = signal.format;
  }

  if (signal.renderKind) {
    patch.lastRenderKind = signal.renderKind;
  }

  if (signal.renderTarget) {
    patch.lastRenderTarget = signal.renderTarget;
  }

  return patch;
};

const isTerminalHttpSignal = (signal, content) => (
  signal.phase === 'finish'
  || (signal.phase === 'summary' && (
    signal.statusCode !== null
    || /RoutingError|No route matches/i.test(content)
  ))
);

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
      const matchedRequest = selectMostRecentlyActiveRequest(exactMatches);
      return {
        matchedRequest,
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

  if (signal.phase === 'processing') {
    const controllerMatchedRequests = openRequests.filter(candidate => (
      controllerMatchesRequestPath(signal.controller, candidate.path)
    ));

    if (controllerMatchedRequests.length === 1) {
      return {
        matchedRequest: controllerMatchedRequests[0],
        confidence: controllerMatchedRequests[0].confidence,
        ambiguous: false,
        ambiguityReason: null
      };
    }

    if (controllerMatchedRequests.length > 1) {
      return {
        matchedRequest: selectMostRecentlyActiveRequest(controllerMatchedRequests),
        confidence: 'low',
        ambiguous: true,
        ambiguityReason: 'multiple-http-requests-match-controller-path'
      };
    }

    const unprocessedRequests = openRequests.filter(candidate => !candidate.controller);

    if (unprocessedRequests.length === 1) {
      return {
        matchedRequest: unprocessedRequests[0],
        confidence: unprocessedRequests[0].confidence,
        ambiguous: false,
        ambiguityReason: null
      };
    }

    if (unprocessedRequests.length > 1) {
      return {
        matchedRequest: selectMostRecentlyActiveRequest(unprocessedRequests),
        confidence: 'low',
        ambiguous: true,
        ambiguityReason: 'multiple-http-requests-awaiting-processing'
      };
    }
  }

  if (signal.phase === 'render') {
    const renderCandidates = signal.renderKind === 'serializer'
      ? openRequests.filter(isApiRequest)
      : openRequests.filter(isViewRequest);

    if (signal.renderKind === 'serializer') {
      const controllerMatchedCandidates = renderCandidates.filter((candidate) => (
        renderTargetMatchesRequest(signal.renderTarget, candidate)
      ));

      if (controllerMatchedCandidates.length === 1) {
        return {
          matchedRequest: controllerMatchedCandidates[0],
          confidence: controllerMatchedCandidates[0].confidence,
          ambiguous: false,
          ambiguityReason: null
        };
      }

      if (controllerMatchedCandidates.length > 1) {
        return {
          matchedRequest: selectMostRecentlyActiveRequest(controllerMatchedCandidates),
          confidence: 'low',
          ambiguous: true,
          ambiguityReason: 'multiple-http-requests-match-render-target'
        };
      }

      const priorSerializerCandidates = renderCandidates.filter(candidate => candidate.lastRenderKind === 'serializer');

      if (priorSerializerCandidates.length === 1) {
        return {
          matchedRequest: priorSerializerCandidates[0],
          confidence: priorSerializerCandidates[0].confidence,
          ambiguous: false,
          ambiguityReason: null
        };
      }

      if (priorSerializerCandidates.length > 1) {
        return {
          matchedRequest: selectMostRecentlyActiveRequest(priorSerializerCandidates),
          confidence: 'low',
          ambiguous: true,
          ambiguityReason: 'multiple-http-requests-with-prior-serializer-render'
        };
      }
    }

    if (renderCandidates.length === 1) {
      return {
        matchedRequest: renderCandidates[0],
        confidence: renderCandidates[0].confidence,
        ambiguous: false,
        ambiguityReason: null
      };
    }

    if (renderCandidates.length > 1) {
      return {
        matchedRequest: selectMostRecentlyActiveRequest(renderCandidates),
        confidence: 'low',
        ambiguous: true,
        ambiguityReason: signal.renderKind === 'serializer'
          ? 'multiple-api-http-requests'
          : 'multiple-view-http-requests'
      };
    }
  }

  return {
    matchedRequest: selectMostRecentlyActiveRequest(openRequests),
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
        confidence: 'high',
        startLineNumber: lineNumber,
        lastMatchedLineNumber: lineNumber,
        lastSignalPhase: 'start'
      });
    } else if (httpSignal) {
      updateOpenHttpRequest(context, uuid, buildHttpRequestPatch(httpSignal, lineNumber));
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
        confidence: 'medium',
        startLineNumber: lineNumber,
        lastMatchedLineNumber: lineNumber,
        lastSignalPhase: 'start'
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
      const resolvedCandidate = resolveHttpCandidate(context, httpSignal);

      if (resolvedCandidate.matchedRequest) {
        updateOpenHttpRequest(
          context,
          resolvedCandidate.matchedRequest.groupId,
          buildHttpRequestPatch(httpSignal, lineNumber)
        );

        if (isTerminalHttpSignal(httpSignal, content)) {
          closeOpenHttpRequest(context, resolvedCandidate.matchedRequest.groupId);
        }
      }

      return buildParsedRecord({
        groupId: resolvedCandidate.matchedRequest?.groupId ?? buildSyntheticHttpGroupId(context, lineNumber),
        content,
        logInfo,
        groupingStrategy: resolvedCandidate.matchedRequest
          ? 'http-context-heuristic'
          : 'http-summary-heuristic',
        groupingConfidence: resolvedCandidate.matchedRequest
          ? resolvedCandidate.confidence
          : 'medium',
        groupingAmbiguous: resolvedCandidate.matchedRequest
          ? resolvedCandidate.ambiguous
          : false,
        groupingAmbiguityReason: resolvedCandidate.matchedRequest
          ? resolvedCandidate.ambiguityReason
          : null
      });
    }

    const resolvedCandidate = resolveHttpCandidate(context, httpSignal);
    const groupId = resolvedCandidate.matchedRequest
      ? resolvedCandidate.matchedRequest.groupId
      : buildSyntheticHttpGroupId(context, lineNumber);

    if (resolvedCandidate.matchedRequest) {
      updateOpenHttpRequest(
        context,
        resolvedCandidate.matchedRequest.groupId,
        buildHttpRequestPatch(httpSignal, lineNumber)
      );
    }

    if (resolvedCandidate.matchedRequest && isTerminalHttpSignal(httpSignal, content)) {
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
