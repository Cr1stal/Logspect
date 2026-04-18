import {
  createFieldAnchorRecord,
  createLookupIndexRecord,
  createParseRecord,
  createTimestampNormalizationRecord
} from './evidenceModel.js';

export const PARSER_NORMALIZER_VERSION = 'logspect-js-1.0.0';
export const UNKNOWN_LINE_STATUS = 'UnknownLine';
export const UNSUPPORTED_LINE_STATUS = 'UnsupportedLine';

const JSON_TIMESTAMP_KEYS = ['timestamp', '@timestamp', 'time'];
const ISO_WITH_OFFSET_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})/;
const SPACE_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{4}/;
const PLAIN_PREFIX_RE = /^(?<ts>\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2}))\s+(?<level>[A-Z]+)\s*(?<rest>.*)$/;
const KV_RE = /(?<key>[A-Za-z0-9_.@/-]+)=(?<value>\{.*?\}|\"[^\"]*\"|\S+)/g;
const QUERY_TERM_RE = /[A-Za-z0-9_.:/@-]+/g;

const flattenJson = (prefix, value, sink) => {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => {
      flattenJson(prefix ? `${prefix}.${index}` : String(index), nested, sink);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      flattenJson(prefix ? `${prefix}.${key}` : key, nested, sink);
    });
    return;
  }

  sink[prefix] = value;
};

export const extractQueryTerms = (text) => {
  const seen = new Set();
  const terms = [];

  for (const term of text.match(QUERY_TERM_RE) || []) {
    if (seen.has(term)) {
      continue;
    }

    seen.add(term);
    terms.push(term);
  }

  return terms;
};

export const normalizeTimestampValue = (value) => {
  if (!value) {
    return null;
  }

  let candidate = value.trim();
  if (candidate.endsWith('Z')) {
    candidate = `${candidate.slice(0, -1)}+00:00`;
  } else if (/[+-]\d{4}$/.test(candidate)) {
    candidate = `${candidate.slice(0, -5)}${candidate.slice(-5, -2)}:${candidate.slice(-2)}`;
  }

  if (candidate.includes(' ') && !candidate.includes('T')) {
    candidate = candidate.replace(' ', 'T');
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().replace('.000Z', 'Z');
};

const firstTimestampCandidate = (rawText) => {
  for (const pattern of [ISO_WITH_OFFSET_RE, SPACE_TIMESTAMP_RE]) {
    const match = rawText.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
};

const createRootSpanHint = (rawText) => ({
  charStart: 0,
  charEnd: rawText.length
});

const extractJsonTopLevelSpanHints = (rawText, payload) => {
  const hints = {};

  Object.entries(payload).forEach(([key, value]) => {
    const keyMatch = rawText.match(new RegExp(`"${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}"\\s*:\\s*`));
    if (!keyMatch || keyMatch.index === undefined) {
      return;
    }

    const valueString = JSON.stringify(value);
    const valueStart = rawText.indexOf(valueString, keyMatch.index + keyMatch[0].length);
    if (valueStart === -1) {
      return;
    }

    hints[key] = {
      charStart: valueStart,
      charEnd: valueStart + valueString.length
    };
  });

  return hints;
};

const parseJsonLine = (rawText) => {
  let payload;

  try {
    payload = JSON.parse(rawText);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      status: UNSUPPORTED_LINE_STATUS,
      formatClass: 'unsupported',
      rawText,
      queryTerms: extractQueryTerms(rawText),
      fields: {},
      fieldSpanHints: {},
      normalizedTimestampUtc: null,
      sourceTimestampValue: null,
      timestampFieldPath: null,
      timezoneSource: null
    };
  }

  const fields = {};
  flattenJson('', payload, fields);

  let sourceTimestampValue = null;
  let timestampFieldPath = null;
  for (const key of JSON_TIMESTAMP_KEYS) {
    if (typeof payload[key] === 'string') {
      sourceTimestampValue = payload[key];
      timestampFieldPath = key;
      break;
    }
  }

  const topLevelSpanHints = extractJsonTopLevelSpanHints(rawText, payload);
  const fieldSpanHints = {};
  Object.keys(fields).forEach((fieldPath) => {
    const topLevelKey = fieldPath.split('.')[0];
    fieldSpanHints[fieldPath] = topLevelSpanHints[topLevelKey] || createRootSpanHint(rawText);
  });

  return {
    status: 'parsed',
    formatClass: 'json',
    rawText,
    queryTerms: extractQueryTerms(rawText),
    fields,
    fieldSpanHints,
    normalizedTimestampUtc: normalizeTimestampValue(sourceTimestampValue),
    sourceTimestampValue,
    timestampFieldPath,
    timezoneSource: sourceTimestampValue && /(?:Z|[+-]\d{2}:?\d{2})$/.test(sourceTimestampValue)
      ? 'explicit-offset'
      : null
  };
};

const parseKeyValueFields = (rest, rawText, restOffset) => {
  const fields = {};
  const spanHints = {};

  for (const match of rest.matchAll(KV_RE)) {
    const key = match.groups?.key;
    const rawValue = match.groups?.value;
    if (!key || !rawValue || match.index === undefined) {
      continue;
    }

    const fullMatch = match[0];
    const absoluteMatchStart = restOffset + match.index;
    const valueStart = absoluteMatchStart + fullMatch.indexOf(rawValue);
    const valueEnd = valueStart + rawValue.length;

    spanHints[key] = {
      charStart: valueStart,
      charEnd: valueEnd
    };

    if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
      try {
        const nestedPayload = JSON.parse(rawValue);
        if (nestedPayload && typeof nestedPayload === 'object' && !Array.isArray(nestedPayload)) {
          const flattened = {};
          flattenJson(key, nestedPayload, flattened);
          Object.entries(flattened).forEach(([fieldPath, value]) => {
            fields[fieldPath] = value;
            spanHints[fieldPath] = {
              charStart: valueStart,
              charEnd: valueEnd
            };
          });
          continue;
        }

        fields[key] = nestedPayload;
      } catch {
        fields[key] = rawValue;
      }

      continue;
    }

    fields[key] = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
  }

  return {
    fields,
    spanHints
  };
};

const parsePrefixedLine = (rawText) => {
  const match = rawText.match(PLAIN_PREFIX_RE);
  if (!match || !match.groups) {
    return null;
  }

  const tsValue = match.groups.ts;
  const level = match.groups.level;
  const rest = match.groups.rest || '';
  const restOffset = rawText.length - rest.length;
  const normalizedTimestampUtc = normalizeTimestampValue(tsValue);
  const { fields, spanHints } = parseKeyValueFields(rest, rawText, restOffset);
  fields.level = level;

  const fieldSpanHints = {
    ...spanHints,
    timestamp: {
      charStart: 0,
      charEnd: tsValue.length
    },
    level: {
      charStart: tsValue.length + 1,
      charEnd: tsValue.length + 1 + level.length
    }
  };

  return {
    status: 'parsed',
    formatClass: rest.includes('payload={') ? 'mixed' : 'plain_text',
    rawText,
    queryTerms: extractQueryTerms(rawText),
    fields,
    fieldSpanHints,
    normalizedTimestampUtc,
    sourceTimestampValue: tsValue,
    timestampFieldPath: 'timestamp',
    timezoneSource: /(?:Z|[+-]\d{2}:?\d{2})$/.test(tsValue) ? 'explicit-offset' : null
  };
};

export const parseNormalizedLine = (rawText) => {
  const jsonResult = parseJsonLine(rawText);
  if (jsonResult) {
    return jsonResult;
  }

  const prefixedResult = parsePrefixedLine(rawText);
  if (prefixedResult) {
    return prefixedResult;
  }

  const firstNonSpace = rawText.trimStart()[0] || '';
  const sourceTimestampValue = firstTimestampCandidate(rawText);
  const normalizedTimestampUtc = normalizeTimestampValue(sourceTimestampValue);

  if (firstNonSpace === '<') {
    return {
      status: UNSUPPORTED_LINE_STATUS,
      formatClass: 'unsupported',
      rawText,
      queryTerms: extractQueryTerms(rawText),
      fields: {},
      fieldSpanHints: {},
      normalizedTimestampUtc: null,
      sourceTimestampValue: null,
      timestampFieldPath: null,
      timezoneSource: null
    };
  }

  return {
    status: UNKNOWN_LINE_STATUS,
    formatClass: sourceTimestampValue ? 'malformed' : 'plain_text',
    rawText,
    queryTerms: extractQueryTerms(rawText),
    fields: {},
    fieldSpanHints: {},
    normalizedTimestampUtc,
    sourceTimestampValue,
    timestampFieldPath: sourceTimestampValue ? 'timestamp' : null,
    timezoneSource: sourceTimestampValue ? 'explicit-offset' : null
  };
};

const buildFieldAnchors = ({
  rawLogLine,
  rootAnchor,
  parseOutcome
}) => {
  const fieldAnchors = [];
  const fieldAnchorMap = {};

  Object.keys(parseOutcome.fields || {}).forEach((fieldPath) => {
    const spanHint = parseOutcome.fieldSpanHints[fieldPath] || createRootSpanHint(rawLogLine.rawText);
    const fieldAnchor = createFieldAnchorRecord({
      rawLineId: rawLogLine.rawLineId,
      sourceFileId: rawLogLine.sourceFileId,
      lineNumber: rawLogLine.lineNumber,
      lineByteStart: rawLogLine.byteStart,
      rawText: rawLogLine.rawText,
      fieldPath,
      charStart: spanHint.charStart,
      charEnd: spanHint.charEnd
    });

    if (fieldAnchor.anchorId === rootAnchor.anchorId) {
      fieldAnchorMap[fieldPath] = rootAnchor.anchorId;
      return;
    }

    fieldAnchorMap[fieldPath] = fieldAnchor.anchorId;
    fieldAnchors.push(fieldAnchor);
  });

  if (parseOutcome.timestampFieldPath && !fieldAnchorMap[parseOutcome.timestampFieldPath]) {
    const spanHint = parseOutcome.fieldSpanHints[parseOutcome.timestampFieldPath];
    const timestampAnchor = createFieldAnchorRecord({
      rawLineId: rawLogLine.rawLineId,
      sourceFileId: rawLogLine.sourceFileId,
      lineNumber: rawLogLine.lineNumber,
      lineByteStart: rawLogLine.byteStart,
      rawText: rawLogLine.rawText,
      fieldPath: parseOutcome.timestampFieldPath,
      charStart: spanHint?.charStart ?? 0,
      charEnd: spanHint?.charEnd ?? rawLogLine.rawText.length
    });

    fieldAnchorMap[parseOutcome.timestampFieldPath] = timestampAnchor.anchorId;
    if (timestampAnchor.anchorId !== rootAnchor.anchorId) {
      fieldAnchors.push(timestampAnchor);
    }
  }

  return {
    fieldAnchors,
    fieldAnchorMap
  };
};

const pushLookupRecord = (sink, {
  lookupKind,
  lookupValue,
  rawLineId,
  anchorId,
  appendSeq
}) => {
  if (!lookupValue) {
    return;
  }

  sink.push(createLookupIndexRecord({
    lookupKind,
    lookupValue: String(lookupValue),
    rawLineId,
    anchorId,
    appendSeq
  }));
};

export const buildParseArtifacts = ({
  rawLogLine,
  rootAnchor,
  runtimeRecord
}) => {
  const parseOutcome = parseNormalizedLine(rawLogLine.rawText);
  const { fieldAnchors, fieldAnchorMap } = buildFieldAnchors({
    rawLogLine,
    rootAnchor,
    parseOutcome
  });

  const parseRecord = createParseRecord({
    rawLineId: rawLogLine.rawLineId,
    parseStatus: parseOutcome.status,
    parserVersion: PARSER_NORMALIZER_VERSION,
    rootAnchorId: rootAnchor.anchorId,
    fieldAnchorMap,
    formatClass: parseOutcome.formatClass,
    rawText: parseOutcome.rawText,
    queryTerms: parseOutcome.queryTerms,
    fields: parseOutcome.fields,
    normalizedTimestampUtc: parseOutcome.normalizedTimestampUtc
  });

  const supportingTimestampAnchorId = parseOutcome.timestampFieldPath
    ? (fieldAnchorMap[parseOutcome.timestampFieldPath] || rootAnchor.anchorId)
    : null;
  const timestampNormalizationRecord = parseOutcome.normalizedTimestampUtc && parseOutcome.sourceTimestampValue
    ? createTimestampNormalizationRecord({
        rawLineId: rawLogLine.rawLineId,
        sourceValue: parseOutcome.sourceTimestampValue,
        normalizedValueUtc: parseOutcome.normalizedTimestampUtc,
        timezoneSource: parseOutcome.timezoneSource || 'explicit-offset',
        supportingAnchorId: supportingTimestampAnchorId || rootAnchor.anchorId
      })
    : null;

  const lookupRecords = [];
  const fields = parseOutcome.fields || {};
  const rootAnchorId = rootAnchor.anchorId;
  const appendSeq = rawLogLine.appendSeq;
  const requestId = fields.request_id || fields['request.id'] || runtimeRecord.requestId || null;
  const jobId = fields.job_id || fields['job.id'] || fields.jid || runtimeRecord.jobId || null;
  const logger = fields.logger || runtimeRecord.logger || null;
  const sourceTag = fields.source_tag || runtimeRecord.sourceTag || runtimeRecord.type || null;

  if (parseOutcome.normalizedTimestampUtc) {
    pushLookupRecord(lookupRecords, {
      lookupKind: 'timestamp_utc',
      lookupValue: parseOutcome.normalizedTimestampUtc,
      rawLineId: rawLogLine.rawLineId,
      anchorId: supportingTimestampAnchorId || rootAnchorId,
      appendSeq
    });
  }

  pushLookupRecord(lookupRecords, {
    lookupKind: 'request_id',
    lookupValue: requestId,
    rawLineId: rawLogLine.rawLineId,
    anchorId: fieldAnchorMap.request_id || fieldAnchorMap['request.id'] || rootAnchorId,
    appendSeq
  });
  pushLookupRecord(lookupRecords, {
    lookupKind: 'job_id',
    lookupValue: jobId,
    rawLineId: rawLogLine.rawLineId,
    anchorId: fieldAnchorMap.job_id || fieldAnchorMap['job.id'] || fieldAnchorMap.jid || rootAnchorId,
    appendSeq
  });
  pushLookupRecord(lookupRecords, {
    lookupKind: 'logger',
    lookupValue: logger,
    rawLineId: rawLogLine.rawLineId,
    anchorId: fieldAnchorMap.logger || rootAnchorId,
    appendSeq
  });
  pushLookupRecord(lookupRecords, {
    lookupKind: 'source_tag',
    lookupValue: sourceTag,
    rawLineId: rawLogLine.rawLineId,
    anchorId: fieldAnchorMap.source_tag || rootAnchorId,
    appendSeq
  });

  [rootAnchor, ...fieldAnchors].forEach((anchor) => {
    pushLookupRecord(lookupRecords, {
      lookupKind: 'anchor_id',
      lookupValue: anchor.anchorId,
      rawLineId: rawLogLine.rawLineId,
      anchorId: anchor.anchorId,
      appendSeq
    });
  });

  return {
    parseOutcome,
    parseRecord,
    fieldAnchors,
    fieldAnchorMap,
    timestampNormalizationRecord,
    lookupRecords
  };
};
