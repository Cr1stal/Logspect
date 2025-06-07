import fs from 'fs';
import log from "electron-log";
import { parseLogLines } from './logParser.js';
import { addLogEntry, displayLogsByRequestId } from './logStorage.js';

// File watching state
let lastSize = 0;
let logFilePath = null;
let isWatching = false;
let watcher = null;

// Callback for when new log data is available
let onLogDataCallback = null;

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
    watcher = null;
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

    // Check if file exists and get initial size
    try {
      const stats = await fs.promises.stat(logFilePath);
      lastSize = stats.size;
      console.log(`Started watching log file: ${logFilePath}`);
      console.log(`Initial file size: ${lastSize} bytes`);
    } catch (err) {
      console.log('Log file not found, will wait for it to be created:', logFilePath);
      lastSize = 0;
    }

    // Set up file watcher
    fs.watchFile(logFilePath, {
      persistent: true,
      interval: 500
    }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        log.info('File change detected...');
        readLogFile();
      }
    });

    isWatching = true;

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

  try {
    const stats = await fs.promises.stat(logFilePath);
    const currentSize = stats.size;

    if (currentSize > lastSize) {
      // Only read the new content from where we left off
      const stream = fs.createReadStream(logFilePath, {
        start: lastSize,
        encoding: 'utf8'
      });

      let newContent = '';
      stream.on('data', (chunk) => {
        newContent += chunk;
      });

      stream.on('end', () => {
        if (newContent.trim()) {
          processNewLogContent(newContent);
        }
        lastSize = currentSize;
      });

      stream.on('error', (err) => {
        log.error('Error reading log file:', err);
      });
    }
  } catch (err) {
    log.error('Error accessing log file:', err);
  }
};

/**
 * Processes new log content and updates storage
 * @param {string} content - New log content to process
 */
const processNewLogContent = (content) => {
  log.info('=== New log entries detected ===');

  // Split by lines and process each line
  const lines = content.split('\n').filter(line => line.trim());
  const parsedEntries = parseLogLines(lines);

  parsedEntries.forEach(parsed => {
    if (parsed.requestId && parsed.titleInfo) {
      const result = addLogEntry(parsed.requestId, parsed.content, parsed.titleInfo);

      if (result.isNewRequest) {
        log.info(`🆕 New request started: ${parsed.requestId}`);
      } else {
        log.info(`📝 Additional entry for: ${parsed.requestId}`);
      }
    } else {
      log.info(`❓ Unmatched log: ${parsed.content}`);
    }
  });

  // Optionally display summary for larger batches
  if (lines.length >= 5) {
    displayLogsByRequestId();
  }

  log.info('=== End of new entries ===\n');

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