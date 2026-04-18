import { describe, expect, it } from 'vitest';

import {
  createRawLogLineRecord,
  createRootAnchorRecord
} from '../evidenceModel.js';
import {
  buildParseArtifacts,
  parseNormalizedLine,
  UNKNOWN_LINE_STATUS,
  UNSUPPORTED_LINE_STATUS
} from '../parserNormalizer.js';

const buildRawContext = (rawText) => {
  const rawLogLine = createRawLogLineRecord({
    sourceFileId: 'src_test',
    lineNumber: 1,
    byteStart: 0,
    byteEnd: Buffer.byteLength(rawText, 'utf8'),
    rawText,
    ingestedAtUtc: '2026-04-18T00:00:00Z',
    appendSeq: 1
  });
  const rootAnchor = createRootAnchorRecord({
    rawLineId: rawLogLine.rawLineId,
    sourceFileId: rawLogLine.sourceFileId,
    lineNumber: rawLogLine.lineNumber,
    byteStart: rawLogLine.byteStart,
    byteEnd: rawLogLine.byteEnd
  });

  return {
    rawLogLine,
    rootAnchor
  };
};

describe('parserNormalizer', () => {
  it('parses plain text prefixed rows with normalized timestamp and fields', () => {
    const result = parseNormalizedLine(
      '2026-04-17T10:00:00-0700 INFO request_id=req-123 status=200 path=/api/items Completed request'
    );

    expect(result.status).toBe('parsed');
    expect(result.formatClass).toBe('plain_text');
    expect(result.normalizedTimestampUtc).toBe('2026-04-17T17:00:00Z');
    expect(result.fields).toMatchObject({
      level: 'INFO',
      request_id: 'req-123',
      status: '200',
      path: '/api/items'
    });
  });

  it('parses json and mixed rows without silent drop', () => {
    const jsonResult = parseNormalizedLine(
      '{"timestamp":"2026-04-17T17:03:00Z","event":"job_retry","job":{"id":"job-77","attempt":2},"queue":"default"}'
    );
    expect(jsonResult.status).toBe('parsed');
    expect(jsonResult.formatClass).toBe('json');
    expect(jsonResult.fields).toMatchObject({
      event: 'job_retry',
      'job.id': 'job-77',
      'job.attempt': 2,
      queue: 'default'
    });

    const mixedResult = parseNormalizedLine(
      '2026-04-17 19:05:00+0200 WARN job_id=job-88 trace_id=tr-555 payload={"attempt":2,"queue":"priority"}'
    );
    expect(mixedResult.status).toBe('parsed');
    expect(mixedResult.formatClass).toBe('mixed');
    expect(mixedResult.normalizedTimestampUtc).toBe('2026-04-17T17:05:00Z');
    expect(mixedResult.fields).toMatchObject({
      level: 'WARN',
      job_id: 'job-88',
      trace_id: 'tr-555',
      'payload.attempt': 2,
      'payload.queue': 'priority'
    });
  });

  it('retains malformed and unsupported rows as explicit outcomes', () => {
    const malformed = parseNormalizedLine(
      '{"timestamp":"2026-04-17T17:05:00Z","event":"bad",payload=<<unterminated>>'
    );
    expect(malformed.status).toBe(UNKNOWN_LINE_STATUS);
    expect(malformed.formatClass).toBe('malformed');
    expect(malformed.normalizedTimestampUtc).toBe('2026-04-17T17:05:00Z');
    expect(malformed.queryTerms.length).toBeGreaterThan(0);

    const unsupported = parseNormalizedLine('<event ts="2026-04-17T17:07:00Z" kind="xml" user="bot" />');
    expect(unsupported.status).toBe(UNSUPPORTED_LINE_STATUS);
    expect(unsupported.formatClass).toBe('unsupported');
    expect(unsupported.queryTerms.length).toBeGreaterThan(0);
  });

  it('builds parse records, field anchors, and timestamp normalization artifacts', () => {
    const { rawLogLine, rootAnchor } = buildRawContext(
      '2026-04-17T10:00:00-0700 INFO request_id=req-123 status=200 path=/api/items'
    );

    const artifacts = buildParseArtifacts({
      rawLogLine,
      rootAnchor,
      runtimeRecord: {
        requestId: null,
        jobId: null,
        logger: 'rails',
        sourceTag: 'web',
        type: 'web'
      }
    });

    expect(artifacts.parseRecord).toMatchObject({
      rawLineId: rawLogLine.rawLineId,
      parseStatus: 'parsed',
      formatClass: 'plain_text',
      normalizedTimestampUtc: '2026-04-17T17:00:00Z'
    });
    expect(artifacts.parseRecord.fieldAnchorMap).toMatchObject({
      timestamp: expect.stringMatching(/^anc_/),
      level: expect.stringMatching(/^anc_/),
      request_id: expect.stringMatching(/^anc_/),
      status: expect.stringMatching(/^anc_/),
      path: expect.stringMatching(/^anc_/)
    });
    expect(artifacts.fieldAnchors.length).toBeGreaterThanOrEqual(5);
    expect(artifacts.timestampNormalizationRecord).toMatchObject({
      rawLineId: rawLogLine.rawLineId,
      normalizedValueUtc: '2026-04-17T17:00:00Z'
    });
    expect(artifacts.lookupRecords.some((record) => (
      record.lookupKind === 'timestamp_utc' && record.lookupValue === '2026-04-17T17:00:00Z'
    ))).toBe(true);
    expect(artifacts.lookupRecords.some((record) => (
      record.lookupKind === 'request_id' && record.lookupValue === 'req-123'
    ))).toBe(true);
  });

  it('derives request and job lookup entries from runtime assembly when the row is unstructured', () => {
    const { rawLogLine, rootAnchor } = buildRawContext(
      '[aa32797f-b087-4d45-9d99-28198952a784] ERROR: callback timeout'
    );

    const requestArtifacts = buildParseArtifacts({
      rawLogLine,
      rootAnchor,
      runtimeRecord: {
        requestId: 'aa32797f-b087-4d45-9d99-28198952a784',
        jobId: null,
        logger: null,
        sourceTag: 'web',
        type: 'web'
      }
    });
    expect(requestArtifacts.lookupRecords.some((record) => (
      record.lookupKind === 'request_id'
      && record.lookupValue === 'aa32797f-b087-4d45-9d99-28198952a784'
    ))).toBe(true);

    const jobArtifacts = buildParseArtifacts({
      rawLogLine: {
        ...rawLogLine,
        rawLineId: 'raw_job',
        rawText: 'class=Workers::SearchJob jid=73f8e97e7e79413a3006f4ea INFO: start'
      },
      rootAnchor: {
        ...rootAnchor,
        rawLineId: 'raw_job',
        anchorId: 'anc_job'
      },
      runtimeRecord: {
        requestId: null,
        jobId: '73f8e97e7e79413a3006f4ea',
        logger: null,
        sourceTag: 'worker',
        type: 'worker'
      }
    });
    expect(jobArtifacts.lookupRecords.some((record) => (
      record.lookupKind === 'job_id'
      && record.lookupValue === '73f8e97e7e79413a3006f4ea'
    ))).toBe(true);
  });
});
