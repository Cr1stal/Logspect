import util from 'util'

/**
 * Regex to extract request ID from log lines like [aa32797f-b087-4d45-9d99-28198952a784]
 */
export const requestIdRegex = /^\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/;

/**
 * Extracts meaningful title and metadata from log content
 * @param {string} content - The log line content
 * @returns {{method: string, path: string, title: string}}
 */
export const extractRequestTitle = (content) => {
  // Try to extract HTTP method and path from various log formats

  // Pattern 1: Standard HTTP request log like "GET /dashboard/overview"
  const httpPattern = /(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s]+)/i;
  const httpMatch = content.match(httpPattern);
  if (httpMatch) {
    return {
      method: httpMatch[1].toUpperCase(),
      path: httpMatch[2],
      title: `${httpMatch[1].toUpperCase()} ${httpMatch[2]}`
    };
  }

  // Pattern 2: Rails controller format like "app/controllers/dashboard/overviews_controller.rb:17:in `show'"
  const controllerPattern = /app\/controllers\/([^\/]+)\/([^\/]+)_controller\.rb.*?`(\w+)'/;
  const controllerMatch = content.match(controllerPattern);
  if (controllerMatch) {
    const namespace = controllerMatch[1];
    const controller = controllerMatch[2];
    const action = controllerMatch[3];
    return {
      method: 'RAILS',
      path: `/${namespace}/${controller}#${action}`,
      title: `${namespace}/${controller}#${action}`
    };
  }

  // Pattern 3: Simple controller format like "DashboardController#show"
  const simpleControllerPattern = /(\w+)Controller#(\w+)/;
  const simpleControllerMatch = content.match(simpleControllerPattern);
  if (simpleControllerMatch) {
    const controller = simpleControllerMatch[1].toLowerCase();
    const action = simpleControllerMatch[2];
    return {
      method: 'RAILS',
      path: `/${controller}#${action}`,
      title: `${controller}#${action}`
    };
  }

  // Pattern 4: API endpoint format like "/api/v1/users"
  const apiPattern = /\/api\/[^\s]+/;
  const apiMatch = content.match(apiPattern);
  if (apiMatch) {
    return {
      method: 'API',
      path: apiMatch[0],
      title: apiMatch[0]
    };
  }

  // Pattern 5: Generic path format
  const pathPattern = /\/[^\s]+/;
  const pathMatch = content.match(pathPattern);
  if (pathMatch) {
    return {
      method: 'WEB',
      path: pathMatch[0],
      title: pathMatch[0]
    };
  }

  // Pattern 6: Extract first meaningful word/phrase (fallback)
  const words = content.trim().split(/\s+/).filter(word =>
    word.length > 2 && !word.match(/^\[|\]$|^\d+$/)
  );

  if (words.length > 0) {
    const title = words.slice(0, 3).join(' ');
    return {
      method: 'LOG',
      path: title,
      title: title.length > 30 ? title.substring(0, 30) + '...' : title
    };
  }

  return {
    method: 'UNKNOWN',
    path: 'Unknown Request',
    title: 'Unknown Request'
  };
};

/**
 * Parses a single log line and extracts request information
 * @param {string} logLine - The log line to parse
 * @returns {{requestId: string|null, content: string, isNewRequest: boolean, titleInfo?: object}}
 */
export const parseLogLine = (logLine) => {
  const match = logLine.match(requestIdRegex);

  if (match) {
    const requestId = match[1];
    const content = logLine.replace(requestIdRegex, '').trim();
    const titleInfo = extractRequestTitle(content);

    return {
      requestId: requestId,
      content: util.stripVTControlCharacters(content),
      isNewRequest: false, // Will be determined by storage layer
      titleInfo: titleInfo
    };
  }

  return {
    requestId: null,
    content: logLine.trim(),
    isNewRequest: false
  };
};

/**
 * Processes multiple log lines and returns parsed entries
 * @param {string[]} lines - Array of log lines to process
 * @returns {Array<{requestId: string|null, content: string, titleInfo?: object}>}
 */
export const parseLogLines = (lines) => {
  return lines
    .filter(line => line.trim())
    .map(line => parseLogLine(line));
};

/**
 * Validates if a string looks like a valid request ID
 * @param {string} requestId - The request ID to validate
 * @returns {boolean}
 */
export const isValidRequestId = (requestId) => {
  if (!requestId || typeof requestId !== 'string') return false;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId);
};