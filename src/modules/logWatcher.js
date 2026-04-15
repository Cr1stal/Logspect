import fs from 'fs';
import log from "electron-log";
import { parseLogLines } from './logParser.js';
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

// Callback for when new log data is available
let onLogDataCallback = null;

const getInitialReadOffset = (fileSize) => (
  Math.max(0, fileSize - INITIAL_HISTORY_MAX_BYTES)
);

const trimPartialLeadingLine = (content) => {
  if (!content) {
    return '';
  }

  const firstLineBreakIndex = content.indexOf('\n');
  if (firstLineBreakIndex === -1) {
    return '';
  }

  return content.slice(firstLineBreakIndex + 1);
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
      resolve(
        shouldDropPartialLeadingLine
          ? trimPartialLeadingLine(content)
          : content
      );
    });

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
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export const startWatching = async (newLogPath) => {
  try {
    stopWatching();

    logFilePath = newLogPath;
    lastSize = 0;
    dropPartialLeadingLine = false;

    let shouldLoadExistingContent = false;

    // Check if file exists and get initial size
    try {
      const stats = await fs.promises.stat(logFilePath);
      lastSize = getInitialReadOffset(stats.size);
      dropPartialLeadingLine = lastSize > 0;
      shouldLoadExistingContent = stats.size > lastSize;

      log.info(`Started watching log file: ${logFilePath}`);
      log.info(`Initial file size: ${stats.size} bytes`);

      if (dropPartialLeadingLine) {
        log.info(`Loading the most recent ${INITIAL_HISTORY_MAX_BYTES} bytes to keep large files responsive`);
      }
    } catch (err) {
      log.info('Log file not found, will wait for it to be created:', logFilePath);
      lastSize = 0;
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

    if (currentSize < lastSize) {
      lastSize = getInitialReadOffset(currentSize);
      dropPartialLeadingLine = lastSize > 0;
      log.info(`Log file was truncated. Resetting read offset to ${lastSize}.`);
    }

    if (currentSize > lastSize) {
      const newContent = await readFileSlice(
        logFilePath,
        lastSize,
        currentSize - 1,
        dropPartialLeadingLine
      );

      lastSize = currentSize;
      dropPartialLeadingLine = false;

      if (newContent.trim()) {
        processNewLogContent(newContent);
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
 */
const processNewLogContent = (content) => {
  // Split by lines and process each line
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  const parsedEntries = parseLogLines(lines);
  let matchedEntries = 0;
  let newGroups = 0;
  let unmatchedEntries = 0;

  parsedEntries.forEach(parsed => {
    if (parsed.uuid && parsed.logInfo) {
      matchedEntries += 1;
      const result = addLogEntry(parsed.uuid, parsed.content, parsed.logInfo);

      if (result.isNewEntry) {
        newGroups += 1;
      }
    } else {
      unmatchedEntries += 1;
    }
  });

  log.info(
    `Processed ${lines.length} log lines (${matchedEntries} matched, ${newGroups} new groups, ${unmatchedEntries} unmatched)`
  );

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
