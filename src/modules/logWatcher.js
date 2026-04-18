import fs from 'fs';
import log from "electron-log";
import { createParsingContext, parseLogLines } from './logParser.js';
import { splitContentIntoLineRecords } from './evidenceModel.js';
import {
  appendLiveRawLine,
  registerLiveSourceFile,
  resetLiveEvidenceStore
} from './liveEvidenceStore.js';
import { addLogEntry } from './logStorage.js';

export const INITIAL_HISTORY_MAX_BYTES = 10 * 1024 * 1024;
const READ_STREAM_HIGH_WATER_MARK = 256 * 1024;

// File watching state
let lastSize = 0;
let logFilePath = null;
let isWatching = false;
let isReading = false;
let hasPendingRead = false;
let dropPartialLeadingLine = false;
let parsingContext = createParsingContext();
let nextLineNumber = 1;
let liveSourceFile = null;

// Callback for when new log data is available
let onLogDataCallback = null;

const getInitialReadOffset = (fileSize) => (
  Math.max(0, fileSize - INITIAL_HISTORY_MAX_BYTES)
);

const trimPartialLeadingLine = (content) => {
  if (!content) {
    return {
      content: '',
      droppedLeadingBytes: 0
    };
  }

  const firstLineBreakIndex = content.indexOf('\n');
  if (firstLineBreakIndex === -1) {
    return {
      content: '',
      droppedLeadingBytes: Buffer.byteLength(content, 'utf8')
    };
  }

  const trimmedContent = content.slice(firstLineBreakIndex + 1);
  const droppedLeadingSlice = content.slice(0, firstLineBreakIndex + 1);

  return {
    content: trimmedContent,
    droppedLeadingBytes: Buffer.byteLength(droppedLeadingSlice, 'utf8')
  };
};

const readFileSlice = (filePath, start, end, shouldDropPartialLeadingLine = false) => (
  new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      start,
      end,
      encoding: 'utf8',
      highWaterMark: READ_STREAM_HIGH_WATER_MARK
    });

    let content = '';

    stream.on('data', (chunk) => {
      content += chunk;
    });

    stream.on('end', () => {
      if (shouldDropPartialLeadingLine) {
        resolve(trimPartialLeadingLine(content));
        return;
      }

      resolve({
        content,
        droppedLeadingBytes: 0
      });
    });

    stream.on('error', reject);
  })
);

const countLineBreaksBeforeOffset = (filePath, offset) => (
  new Promise((resolve, reject) => {
    if (!offset || offset <= 0) {
      resolve(0);
      return;
    }

    const stream = fs.createReadStream(filePath, {
      start: 0,
      end: offset - 1,
      highWaterMark: READ_STREAM_HIGH_WATER_MARK
    });

    let lineBreakCount = 0;

    stream.on('data', (chunk) => {
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 10) {
          lineBreakCount += 1;
        }
      }
    });

    stream.on('end', () => resolve(lineBreakCount));
    stream.on('error', reject);
  })
);

/**
 * Sets the callback function to be called when new log data is processed
 * @param {Function} callback - Function to call with new log data
 */
export const setLogDataCallback = (callback) => {
  onLogDataCallback = callback;
};

/**
 * Stops watching the current log file
 */
export const stopWatching = () => {
  if (isWatching && logFilePath) {
    fs.unwatchFile(logFilePath);
    isWatching = false;
    log.info('Stopped watching previous log file');
  }
};

/**
 * Starts watching a log file for changes
 * @param {string} newLogPath - Path to the log file to watch
 * @param {{startOffset?: number|null, loadExistingContent?: boolean|null, startOffsetAtLineBoundary?: boolean}} options
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export const startWatching = async (newLogPath, options = {}) => {
  try {
    stopWatching();

    logFilePath = newLogPath;
    lastSize = 0;
    dropPartialLeadingLine = false;
    parsingContext = createParsingContext();
    nextLineNumber = 1;
    liveSourceFile = null;
    resetLiveEvidenceStore();

    let shouldLoadExistingContent = false;
    const hasCustomStartOffset = Number.isInteger(options.startOffset) && options.startOffset >= 0;

    // Check if file exists and get initial size
    try {
      const stats = await fs.promises.stat(logFilePath);
      lastSize = hasCustomStartOffset
        ? Math.min(options.startOffset, stats.size)
        : getInitialReadOffset(stats.size);
      dropPartialLeadingLine = hasCustomStartOffset
        ? !options.startOffsetAtLineBoundary
        : lastSize > 0;
      shouldLoadExistingContent = typeof options.loadExistingContent === 'boolean'
        ? options.loadExistingContent && stats.size > lastSize
        : stats.size > lastSize;

      log.info(`Started watching log file: ${logFilePath}`);
      log.info(`Initial file size: ${stats.size} bytes`);

      if (hasCustomStartOffset) {
        log.info(`Starting watcher from byte offset ${lastSize}`);
      } else if (dropPartialLeadingLine) {
        log.info(`Loading the most recent ${INITIAL_HISTORY_MAX_BYTES} bytes to keep large files responsive`);
      }

      const lineBreakCount = await countLineBreaksBeforeOffset(logFilePath, lastSize);
      nextLineNumber = lineBreakCount + 1 + (dropPartialLeadingLine ? 1 : 0);
      liveSourceFile = registerLiveSourceFile({
        path: logFilePath
      });
    } catch (err) {
      log.info('Log file not found, will wait for it to be created:', logFilePath);
      lastSize = 0;
      nextLineNumber = 1;
    }

    // Set up file watcher
    fs.watchFile(logFilePath, {
      persistent: true,
      interval: 500
    }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        log.info('File change detected...');
        void readLogFile();
      }
    });

    isWatching = true;

    if (shouldLoadExistingContent) {
      void readLogFile();
    }

    return {
      success: true,
      message: `Started watching log file: ${logFilePath}`
    };
  } catch (error) {
    log.error('Error starting file watcher:', error);
    return {
      success: false,
      message: `Error starting file watcher: ${error.message}`
    };
  }
};

/**
 * Reads new content from the log file and processes it
 * @returns {Promise<void>}
 */
export const readLogFile = async () => {
  if (!logFilePath) {
    log.info('No log file path set. Please select a Rails project directory first.');
    return;
  }

  if (isReading) {
    hasPendingRead = true;
    return;
  }

  isReading = true;

  try {
    const stats = await fs.promises.stat(logFilePath);
    const currentSize = stats.size;
    if (!liveSourceFile) {
      liveSourceFile = registerLiveSourceFile({
        path: logFilePath
      });
    }

    if (currentSize < lastSize) {
      lastSize = getInitialReadOffset(currentSize);
      dropPartialLeadingLine = lastSize > 0;
      resetLiveEvidenceStore();
      liveSourceFile = registerLiveSourceFile({
        path: logFilePath
      });
      const lineBreakCount = await countLineBreaksBeforeOffset(logFilePath, lastSize);
      nextLineNumber = lineBreakCount + 1 + (dropPartialLeadingLine ? 1 : 0);
      log.info(`Log file was truncated. Resetting read offset to ${lastSize}.`);
    }

    if (currentSize > lastSize) {
      const newContent = await readFileSlice(
        logFilePath,
        lastSize,
        currentSize - 1,
        dropPartialLeadingLine
      );
      const contentStartByte = lastSize + newContent.droppedLeadingBytes;

      lastSize = currentSize;
      dropPartialLeadingLine = false;

      if (newContent.content.trim()) {
        processNewLogContent(newContent.content, contentStartByte);
      }
    }
  } catch (err) {
    log.error('Error accessing log file:', err);
  } finally {
    isReading = false;

    if (hasPendingRead) {
      hasPendingRead = false;
      void readLogFile();
    }
  }
};

/**
 * Processes new log content and updates storage
 * @param {string} content - New log content to process
 * @param {number} startByte - Starting byte offset of the provided content inside the source file
 */
const processNewLogContent = (content, startByte) => {
  const lineRecords = splitContentIntoLineRecords(content, {
    startByte,
    startLineNumber: nextLineNumber
  }).filter(record => record.rawText.trim());
  const parsedEntries = parseLogLines(lineRecords.map(record => record.rawText), {
    context: parsingContext
  });
  let matchedEntries = 0;
  let newGroups = 0;
  let unmatchedEntries = 0;

  parsedEntries.forEach((parsed, index) => {
    const lineRecord = lineRecords[index];
    const evidence = lineRecord && liveSourceFile
      ? appendLiveRawLine({
          sourceFile: liveSourceFile,
          lineNumber: lineRecord.lineNumber,
          byteStart: lineRecord.byteStart,
          byteEnd: lineRecord.byteEnd,
          rawText: lineRecord.rawText,
          ingestedAtUtc: new Date().toISOString()
        }).evidence
      : null;

    if (parsed.uuid && parsed.logInfo) {
      matchedEntries += 1;
      const result = addLogEntry(parsed.uuid, parsed.content, parsed.logInfo, evidence);

      if (result.isNewEntry) {
        newGroups += 1;
      }
    } else {
      unmatchedEntries += 1;
    }
  });

  log.info(
    `Processed ${lineRecords.length} log lines (${matchedEntries} matched, ${newGroups} new groups, ${unmatchedEntries} unmatched)`
  );

  if (lineRecords.length > 0) {
    nextLineNumber = lineRecords[lineRecords.length - 1].lineNumber + 1;
  }

  // Notify callback if set
  if (onLogDataCallback) {
    onLogDataCallback();
  }
};

/**
 * Gets the current watching status
 * @returns {{isWatching: boolean, logFilePath: string|null, lastSize: number}}
 */
export const getWatchingStatus = () => {
  return {
    isWatching: isWatching,
    logFilePath: logFilePath,
    lastSize: lastSize
  };
};

/**
 * Manually triggers a log file read (for testing or refresh)
 * @returns {Promise<void>}
 */
export const refreshLogFile = async () => {
  if (logFilePath) {
    await readLogFile();
  }
};
