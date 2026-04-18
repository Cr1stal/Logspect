import {
  buildEvidenceRef,
  createRawLogLineRecord,
  createRootAnchorRecord,
  createSourceFileRecord
} from './evidenceModel.js';

const sourceFilesByPath = new Map();
const sourceFilesById = new Map();
const rawLogLinesById = new Map();
const anchorsById = new Map();
let appendSeq = 0;

export const resetLiveEvidenceStore = () => {
  sourceFilesByPath.clear();
  sourceFilesById.clear();
  rawLogLinesById.clear();
  anchorsById.clear();
  appendSeq = 0;
};

export const registerLiveSourceFile = ({
  path,
  encoding = 'utf8',
  snapshotKey = 'live'
}) => {
  const existing = sourceFilesByPath.get(path);
  if (existing) {
    return existing;
  }

  const sourceFile = createSourceFileRecord({
    corpusId: 'live',
    path,
    contentHash: null,
    encoding,
    lineCount: 0,
    snapshotKey
  });

  sourceFilesByPath.set(path, sourceFile);
  sourceFilesById.set(sourceFile.sourceFileId, sourceFile);
  return sourceFile;
};

export const appendLiveRawLine = ({
  sourceFile,
  lineNumber,
  byteStart,
  byteEnd,
  rawText,
  ingestedAtUtc
}) => {
  appendSeq += 1;

  const rawLogLine = createRawLogLineRecord({
    sourceFileId: sourceFile.sourceFileId,
    lineNumber,
    byteStart,
    byteEnd,
    rawText,
    ingestedAtUtc,
    appendSeq
  });

  if (rawLogLinesById.has(rawLogLine.rawLineId)) {
    const existingRawLine = rawLogLinesById.get(rawLogLine.rawLineId);
    const existingAnchor = [...anchorsById.values()].find((candidate) => candidate.rawLineId === existingRawLine.rawLineId);

    return {
      rawLogLine: existingRawLine,
      anchor: existingAnchor,
      evidence: buildEvidenceRef({
        sourceFileId: existingRawLine.sourceFileId,
        rawLineId: existingRawLine.rawLineId,
        anchorId: existingAnchor?.anchorId || null,
        lineNumber: existingRawLine.lineNumber,
        byteStart: existingRawLine.byteStart,
        byteEnd: existingRawLine.byteEnd
      })
    };
  }

  rawLogLinesById.set(rawLogLine.rawLineId, rawLogLine);
  const nextSourceFile = {
    ...sourceFile,
    lineCount: Math.max(sourceFile.lineCount || 0, lineNumber)
  };
  sourceFilesById.set(sourceFile.sourceFileId, nextSourceFile);
  sourceFilesByPath.set(sourceFile.path, nextSourceFile);

  const anchor = createRootAnchorRecord({
    rawLineId: rawLogLine.rawLineId,
    sourceFileId: rawLogLine.sourceFileId,
    lineNumber: rawLogLine.lineNumber,
    byteStart: rawLogLine.byteStart,
    byteEnd: rawLogLine.byteEnd
  });
  anchorsById.set(anchor.anchorId, anchor);

  return {
    rawLogLine,
    anchor,
    evidence: buildEvidenceRef({
      sourceFileId: rawLogLine.sourceFileId,
      rawLineId: rawLogLine.rawLineId,
      anchorId: anchor.anchorId,
      lineNumber: rawLogLine.lineNumber,
      byteStart: rawLogLine.byteStart,
      byteEnd: rawLogLine.byteEnd
    })
  };
};

export const getLiveRawLine = (rawLineId) => rawLogLinesById.get(rawLineId) || null;

export const openLiveAnchor = (anchorId) => {
  const anchor = anchorsById.get(anchorId);
  if (!anchor) {
    return null;
  }

  return {
    anchorId: anchor.anchorId,
    sourceFileId: anchor.sourceFileId,
    lineNumber: anchor.lineNumber,
    byteStart: anchor.byteStart,
    byteEnd: anchor.byteEnd,
    fieldPath: anchor.fieldPath,
    anchorKind: anchor.anchorKind,
    rawLineId: anchor.rawLineId
  };
};
