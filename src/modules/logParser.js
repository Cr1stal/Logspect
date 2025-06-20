import util from 'util'

/**
 * Regex to extract UUID from log lines like [aa32797f-b087-4d45-9d99-28198952a784]
 */
export const uuidRegex = /^\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/;

/**
 * Regex to extract jid from background job logs like "class=Workers::Database::RefreshMaterializedView jid=73f8e97e7e79413a3006f4ea"
 */
export const jidRegex = /class=([^\s]+)\s+jid=([a-f0-9]+)/;

/**
 * Generates a time-based UUID that groups logs by second
 * @returns {string} Time-based UUID
 */
const generateTimeBasedUuid = () => {
  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 5000); // Truncate to 5 seconds
  // Create a consistent UUID for the same second
  return `sys-${timestamp}`;
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

  // Pattern 2: Web requests - HTTP method and path like "GET /dashboard/overview"
  const httpPattern = /(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s]+)/i;
  const httpMatch = content.match(httpPattern);
  if (httpMatch) {
    logInfo.type = 'web';
    logInfo.subType = httpMatch[1].toUpperCase();
    logInfo.title = `${httpMatch[1].toUpperCase()} ${httpMatch[2]}`;
    logInfo.metadata.path = httpMatch[2];

    // Try to extract status code and response time
    const statusMatch = content.match(/(\d{3})\s+\w+/);
    if (statusMatch) {
      const statusCode = parseInt(statusMatch[1]);
      logInfo.success = statusCode >= 200 && statusCode < 400;
      logInfo.metadata.statusCode = statusCode;
    }

    const responseTimeMatch = content.match(/(\d+(?:\.\d+)?)\s*ms/);
    if (responseTimeMatch) {
      logInfo.metadata.responseTime = parseFloat(responseTimeMatch[1]);
    }

    return logInfo;
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

/**
 * Parses a single log line and extracts information
 * @param {string} logLine - The log line to parse
 * @returns {{uuid: string|null, content: string, isNewEntry: boolean, logInfo?: object}}
 */
export const parseLogLine = (logLine) => {
  // First try to match UUID format [uuid]
  const uuidMatch = logLine.match(uuidRegex);
  if (uuidMatch) {
    const uuid = uuidMatch[1];
    const content = logLine.replace(uuidRegex, '').trim();
    const logInfo = extractLogInfo(content);

    return {
      uuid: uuid,
      content: util.stripVTControlCharacters(content),
      isNewEntry: false, // Will be determined by storage layer
      logInfo: logInfo
    };
  }

  // Then try to match background job format with jid
  const jidMatch = logLine.match(jidRegex);
  console.log('jidMatch', jidMatch, logLine);
  if (jidMatch) {
    const jid = jidMatch[2]; // Use jid as uuid
    const content = logLine.trim();
    const logInfo = extractLogInfo(content);

    return {
      uuid: jid,
      content: util.stripVTControlCharacters(content),
      isNewEntry: false, // Will be determined by storage layer
      logInfo: logInfo
    };
  }

  // For all other logs (system logs), generate a time-based UUID
  const content = logLine.trim();
  const logInfo = extractLogInfo(content);

  // Only generate time-based UUID for system logs
  if (logInfo.type === 'app' && logInfo.subType === 'sys') {
    const timeBasedUuid = generateTimeBasedUuid();

    return {
      uuid: timeBasedUuid,
      content: util.stripVTControlCharacters(content),
      isNewEntry: false, // Will be determined by storage layer
      logInfo: logInfo
    };
  }

  return {
    uuid: null,
    content: content,
    isNewEntry: false
  };
};

/**
 * Processes multiple log lines and returns parsed entries
 * @param {string[]} lines - Array of log lines to process
 * @returns {Array<{uuid: string|null, content: string, logInfo?: object}>}
 */
export const parseLogLines = (lines) => {
  return lines
    .filter(line => line.trim())
    .map(line => parseLogLine(line));
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