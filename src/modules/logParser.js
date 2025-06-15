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
 * Extracts log information including type, subType, success, metadata and title
 * @param {string} content - The log line content
 * @returns {{type: string, subType: string, success: boolean|null, metadata: object, title: string}}
 */
export const extractLogInfo = (content) => {
  // Default structure
  let logInfo = {
    type: 'unknown',
    subType: 'unknown',
    success: null,
    metadata: {},
    title: 'Unknown Entry'
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

  // Pattern 3: Rails controller format like "app/controllers/dashboard/overviews_controller.rb:17:in `show'"
  const controllerPattern = /app\/controllers\/([^\/]+)\/([^\/]+)_controller\.rb.*?`(\w+)'/;
  const controllerMatch = content.match(controllerPattern);
  if (controllerMatch) {
    const namespace = controllerMatch[1];
    const controller = controllerMatch[2];
    const action = controllerMatch[3];

    logInfo.type = 'web';
    logInfo.subType = 'RAILS';
    logInfo.title = `${namespace}/${controller}#${action}`;
    logInfo.metadata.namespace = namespace;
    logInfo.metadata.controller = controller;
    logInfo.metadata.action = action;

    return logInfo;
  }

  // Pattern 4: Simple controller format like "DashboardController#show"
  const simpleControllerPattern = /(\w+)Controller#(\w+)/;
  const simpleControllerMatch = content.match(simpleControllerPattern);
  if (simpleControllerMatch) {
    const controller = simpleControllerMatch[1].toLowerCase();
    const action = simpleControllerMatch[2];

    logInfo.type = 'web';
    logInfo.subType = 'RAILS';
    logInfo.title = `${controller}#${action}`;
    logInfo.metadata.controller = controller;
    logInfo.metadata.action = action;

    return logInfo;
  }

  // Pattern 5: Generic background job patterns (fallback for other job formats)
  const jobPatterns = [
    /(\w+Job)\s+/,
    /Performing\s+(\w+Job)/i,
    /Enqueued\s+(\w+Job)/i,
    /Job\s+(\w+)/i
  ];

  for (const pattern of jobPatterns) {
    const jobMatch = content.match(pattern);
    if (jobMatch) {
      logInfo.type = 'worker';
      logInfo.subType = 'job';
      logInfo.title = jobMatch[1];
      logInfo.metadata.jobClass = jobMatch[1];

      // Try to extract job success/failure
      if (content.toLowerCase().includes('completed') || content.toLowerCase().includes('success')) {
        logInfo.success = true;
      } else if (content.toLowerCase().includes('failed') || content.toLowerCase().includes('error')) {
        logInfo.success = false;
      }

      // Try to extract duration
      const durationMatch = content.match(/(?:in|took)\s+(\d+(?:\.\d+)?)\s*(?:ms|seconds?)/i);
      if (durationMatch) {
        logInfo.metadata.duration = parseFloat(durationMatch[1]);
      }

      return logInfo;
    }
  }

  // Pattern 6: System/Application logs
  const systemPatterns = [
    /(?:INFO|DEBUG|WARN|ERROR|FATAL)/i,
    /Starting\s+/i,
    /Stopping\s+/i,
    /Loading\s+/i,
    /Initializing\s+/i,
    /Configuration\s+/i
  ];

  for (const pattern of systemPatterns) {
    if (content.match(pattern)) {
      logInfo.type = 'app';
      logInfo.subType = 'sys';

      // Extract log level for success determination
      const levelMatch = content.match(/(INFO|DEBUG|WARN|ERROR|FATAL)/i);
      if (levelMatch) {
        logInfo.success = !['ERROR', 'FATAL'].includes(levelMatch[1].toUpperCase());
      }

      // Use first meaningful part as title
      const words = content.trim().split(/\s+/).filter(word =>
        word.length > 2 && !word.match(/^\[|\]$|^\d+$|^(INFO|DEBUG|WARN|ERROR|FATAL)$/i)
      );

      if (words.length > 0) {
        logInfo.title = words.slice(0, 4).join(' ');
        if (logInfo.title.length > 40) {
          logInfo.title = logInfo.title.substring(0, 40) + '...';
        }
      }

      return logInfo;
    }
  }

  // Pattern 7: API endpoint format like "/api/v1/users"
  const apiPattern = /\/api\/[^\s]+/;
  const apiMatch = content.match(apiPattern);
  if (apiMatch) {
    logInfo.type = 'web';
    logInfo.subType = 'API';
    logInfo.title = apiMatch[0];
    logInfo.metadata.endpoint = apiMatch[0];

    return logInfo;
  }

  // Pattern 8: Generic path format
  const pathPattern = /\/[^\s]+/;
  const pathMatch = content.match(pathPattern);
  if (pathMatch) {
    logInfo.type = 'web';
    logInfo.subType = 'WEB';
    logInfo.title = pathMatch[0];
    logInfo.metadata.path = pathMatch[0];

    return logInfo;
  }

  // Fallback: Extract first meaningful words
  const words = content.trim().split(/\s+/).filter(word =>
    word.length > 2 && !word.match(/^\[|\]$|^\d+$/)
  );

  if (words.length > 0) {
    logInfo.type = 'app';
    logInfo.subType = 'log';
    logInfo.title = words.slice(0, 3).join(' ');
    if (logInfo.title.length > 30) {
      logInfo.title = logInfo.title.substring(0, 30) + '...';
    }
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

  return {
    uuid: null,
    content: logLine.trim(),
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