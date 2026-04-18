import crypto from 'node:crypto';

const hashStableId = (...parts) => (
  crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('::'))
    .digest('hex')
);

export const createSourceFileId = ({
  path,
  snapshotKey = 'live'
}) => (
  `src_${hashStableId(path, snapshotKey)}`
);

export const createSourceFileRecord = ({
  corpusId = 'live',
  path,
  contentHash = null,
  encoding = 'utf8',
  lineCount = 0,
  snapshotKey = 'live'
}) => ({
  sourceFileId: createSourceFileId({ path, snapshotKey }),
  corpusId,
  path,
  contentHash,
  encoding,
  lineCount
});

export const createRawLineId = ({
  sourceFileId,
  lineNumber,
  byteStart,
  byteEnd,
  rawText
}) => (
  `raw_${hashStableId(sourceFileId, lineNumber, byteStart, byteEnd, rawText)}`
);

export const createRawLogLineRecord = ({
  sourceFileId,
  lineNumber,
  byteStart,
  byteEnd,
  rawText,
  ingestedAtUtc,
  appendSeq
}) => ({
  rawLineId: createRawLineId({
    sourceFileId,
    lineNumber,
    byteStart,
    byteEnd,
    rawText
  }),
  sourceFileId,
  lineNumber,
  byteStart,
  byteEnd,
  rawText,
  ingestedAtUtc,
  appendSeq
});

export const createAnchorId = ({
  rawLineId,
  fieldPath = '$',
  anchorKind = 'root'
}) => (
  `anc_${hashStableId(rawLineId, fieldPath, anchorKind)}`
);

export const createRootAnchorRecord = ({
  rawLineId,
  sourceFileId,
  lineNumber,
  byteStart,
  byteEnd,
  fieldPath = '$',
  anchorKind = 'root'
}) => ({
  anchorId: createAnchorId({
    rawLineId,
    fieldPath,
    anchorKind
  }),
  rawLineId,
  sourceFileId,
  lineNumber,
  byteStart,
  byteEnd,
  fieldPath,
  anchorKind
});

export const byteOffsetForCharacterIndex = (
  text,
  characterIndex,
  encoding = 'utf8'
) => Buffer.byteLength(text.slice(0, Math.max(0, characterIndex)), encoding);

export const createFieldAnchorRecord = ({
  rawLineId,
  sourceFileId,
  lineNumber,
  lineByteStart,
  rawText,
  fieldPath,
  charStart = 0,
  charEnd = rawText.length,
  anchorKind = 'field'
}) => {
  const startOffset = byteOffsetForCharacterIndex(rawText, charStart);
  const endOffset = byteOffsetForCharacterIndex(rawText, charEnd);

  return {
    anchorId: createAnchorId({
      rawLineId,
      fieldPath,
      anchorKind
    }),
    rawLineId,
    sourceFileId,
    lineNumber,
    byteStart: lineByteStart + startOffset,
    byteEnd: lineByteStart + endOffset,
    fieldPath,
    anchorKind
  };
};

export const createParseRecordId = ({
  rawLineId,
  parserVersion
}) => (
  `pr_${hashStableId(rawLineId, parserVersion)}`
);

export const createParseRecord = ({
  rawLineId,
  parseStatus,
  parserVersion,
  rootAnchorId,
  fieldAnchorMap,
  formatClass,
  rawText,
  queryTerms,
  fields,
  normalizedTimestampUtc = null
}) => ({
  parseRecordId: createParseRecordId({
    rawLineId,
    parserVersion
  }),
  rawLineId,
  parseStatus,
  parserVersion,
  rootAnchorId,
  fieldAnchorMap,
  formatClass,
  rawText,
  queryTerms,
  fields,
  normalizedTimestampUtc
});

export const createTimestampNormalizationRecord = ({
  rawLineId,
  sourceValue,
  normalizedValueUtc,
  timezoneSource,
  supportingAnchorId
}) => ({
  normalizationRecordId: `tnr_${hashStableId(rawLineId, sourceValue, normalizedValueUtc, supportingAnchorId)}`,
  rawLineId,
  sourceValue,
  normalizedValueUtc,
  timezoneSource,
  supportingAnchorId
});

export const createLookupIndexRecord = ({
  lookupKind,
  lookupValue,
  rawLineId,
  anchorId,
  appendSeq
}) => ({
  lookupIndexId: `lki_${hashStableId(lookupKind, lookupValue, rawLineId, anchorId, appendSeq)}`,
  lookupKind,
  lookupValue,
  rawLineId,
  anchorId,
  appendSeq
});

const createLineRecord = ({
  rawText,
  lineNumber,
  byteStart,
  byteEnd
}) => ({
  rawText,
  lineNumber,
  byteStart,
  byteEnd
});

export const splitContentIntoLineRecords = (
  content,
  {
    startByte = 0,
    startLineNumber = 1
  } = {}
) => {
  const records = [];
  let remaining = content;
  let nextByteStart = startByte;
  let nextLineNumber = startLineNumber;

  while (remaining.length > 0) {
    const newlineMatch = remaining.match(/\r\n|\n|\r/);

    if (!newlineMatch) {
      const rawText = remaining;
      records.push(createLineRecord({
        rawText,
        lineNumber: nextLineNumber,
        byteStart: nextByteStart,
        byteEnd: nextByteStart + Buffer.byteLength(rawText, 'utf8')
      }));
      break;
    }

    const separator = newlineMatch[0];
    const separatorIndex = newlineMatch.index ?? 0;
    const rawText = remaining.slice(0, separatorIndex);
    const fullSlice = remaining.slice(0, separatorIndex + separator.length);
    const rawByteLength = Buffer.byteLength(rawText, 'utf8');
    const fullByteLength = Buffer.byteLength(fullSlice, 'utf8');

    records.push(createLineRecord({
      rawText,
      lineNumber: nextLineNumber,
      byteStart: nextByteStart,
      byteEnd: nextByteStart + rawByteLength
    }));

    nextByteStart += fullByteLength;
    nextLineNumber += 1;
    remaining = remaining.slice(separatorIndex + separator.length);
  }

  return records;
};

export const buildEvidenceRef = ({
  sourceFileId,
  rawLineId,
  anchorId,
  lineNumber,
  byteStart,
  byteEnd
}) => ({
  sourceFileId,
  rawLineId,
  anchorId,
  lineNumber,
  byteStart,
  byteEnd
});
