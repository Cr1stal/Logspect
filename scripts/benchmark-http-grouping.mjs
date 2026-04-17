import fs from 'fs';
import readline from 'readline';

import { createParsingContext, parseLogLine } from '../src/modules/logParser.js';

const UUID_PREFIX = /^\[([0-9a-f-]{36})\]\s?/i;

const parseArgs = (argv) => {
  const options = {
    source: null,
    limit: 5000,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--source') {
      options.source = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--limit') {
      options.limit = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
    }
  }

  if (!options.source) {
    throw new Error('Missing required --source argument');
  }

  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  return options;
};

const buildMergedGroupSummaries = (predictedGroups) => (
  [...predictedGroups.entries()]
    .map(([groupId, entries]) => ({
      groupId,
      entries,
      goldIds: [...new Set(entries.map((entry) => entry.goldId))]
    }))
    .filter((group) => group.goldIds.length > 1)
);

const buildBenchmarkResult = ({ limit, source, eligibleLines, goldGroups, predictedGroups }) => {
  const mergedGroups = buildMergedGroupSummaries(predictedGroups);
  const silentMergedGroups = mergedGroups.filter((group) => (
    group.entries.every((entry) => !entry.metadata?.groupingAmbiguous)
  ));
  const ambiguousMergedGroups = mergedGroups.filter((group) => (
    group.entries.some((entry) => entry.metadata?.groupingAmbiguous)
  ));

  const recalledRequestCount = [...goldGroups.values()]
    .filter((predictedSet) => predictedSet.size === 1)
    .length;

  const mergedLineCount = mergedGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const silentMergedLineCount = silentMergedGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const ambiguousMergedLineCount = ambiguousMergedGroups.reduce((sum, group) => sum + group.entries.length, 0);

  return {
    source,
    limit,
    eligibleLines,
    goldRequestCount: goldGroups.size,
    predictedGroupCount: predictedGroups.size,
    metrics: {
      requestRecall: recalledRequestCount / goldGroups.size,
      mergedGroupRate: mergedGroups.length / predictedGroups.size,
      silentMergedGroupRate: silentMergedGroups.length / predictedGroups.size,
      ambiguousMergedGroupRate: ambiguousMergedGroups.length / predictedGroups.size,
      mergedLineRate: mergedLineCount / eligibleLines,
      silentMergedLineRate: silentMergedLineCount / eligibleLines,
      ambiguousMergedLineRate: ambiguousMergedLineCount / eligibleLines
    },
    counts: {
      recalledRequestCount,
      splitRequestCount: goldGroups.size - recalledRequestCount,
      mergedGroupCount: mergedGroups.length,
      silentMergedGroupCount: silentMergedGroups.length,
      ambiguousMergedGroupCount: ambiguousMergedGroups.length
    },
    definitions: {
      eligibleLine: 'A non-empty log line with a request UUID in the source corpus after UUID stripping.',
      requestRecall: 'Share of gold requests whose eligible lines land in exactly one predicted group.',
      mergedGroupRate: 'Share of predicted groups containing eligible lines from more than one gold request.',
      silentMergedGroupRate: 'Share of predicted groups containing lines from more than one gold request without ambiguity markers on any line.',
      ambiguousMergedGroupRate: 'Share of predicted groups containing lines from more than one gold request with at least one ambiguity-marked line.'
    },
    acceptanceSnapshot: {
      recallTarget: 0.92,
      silentMergeTarget: 0.015,
      recallPass: (recalledRequestCount / goldGroups.size) >= 0.92,
      silentMergePass: (silentMergedGroups.length / predictedGroups.size) <= 0.015
    }
  };
};

const renderHumanReadableReport = (report) => {
  const formatPercent = (value) => `${(value * 100).toFixed(2)}%`;

  return [
    'HTTP grouping benchmark',
    `Source: ${report.source}`,
    `Eligible lines: ${report.eligibleLines}`,
    `Gold requests: ${report.goldRequestCount}`,
    `Predicted groups: ${report.predictedGroupCount}`,
    '',
    `Request recall: ${formatPercent(report.metrics.requestRecall)}`,
    `Merged groups (all): ${formatPercent(report.metrics.mergedGroupRate)}`,
    `Merged groups (silent only): ${formatPercent(report.metrics.silentMergedGroupRate)}`,
    `Merged groups (ambiguity-flagged): ${formatPercent(report.metrics.ambiguousMergedGroupRate)}`,
    '',
    `Recall pass (>= 92.00%): ${report.acceptanceSnapshot.recallPass ? 'yes' : 'no'}`,
    `Silent merge pass (<= 1.50%): ${report.acceptanceSnapshot.silentMergePass ? 'yes' : 'no'}`
  ].join('\n');
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const lineReader = readline.createInterface({
    input: fs.createReadStream(options.source),
    crlfDelay: Infinity
  });

  const context = createParsingContext();
  const goldGroups = new Map();
  const predictedGroups = new Map();

  let lineNumber = 0;
  let eligibleLines = 0;

  for await (const rawLine of lineReader) {
    lineNumber += 1;

    const uuidMatch = rawLine.match(UUID_PREFIX);
    if (!uuidMatch) {
      continue;
    }

    const goldId = uuidMatch[1];
    const content = rawLine.replace(UUID_PREFIX, '').trim();
    if (!content) {
      continue;
    }

    const parsed = parseLogLine(content, {
      context,
      lineNumber,
      fallbackGrouping: 'line-number'
    });
    const predictedGroupId = parsed.uuid ?? `null-${lineNumber}`;

    if (!goldGroups.has(goldId)) {
      goldGroups.set(goldId, new Set());
    }
    goldGroups.get(goldId).add(predictedGroupId);

    if (!predictedGroups.has(predictedGroupId)) {
      predictedGroups.set(predictedGroupId, []);
    }
    predictedGroups.get(predictedGroupId).push({
      goldId,
      metadata: parsed.logInfo?.metadata || null
    });

    eligibleLines += 1;
    if (eligibleLines >= options.limit) {
      break;
    }
  }

  const report = buildBenchmarkResult({
    limit: options.limit,
    source: options.source,
    eligibleLines,
    goldGroups,
    predictedGroups
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(renderHumanReadableReport(report));
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
