/**
 * Efficient storage for grouped log entries by request ID
 */
export const logEntriesByRequestId = new Map();

/**
 * Adds a log entry to the storage, grouping by request ID
 * @param {string} requestId - The request ID
 * @param {string} content - The log content
 * @param {object} titleInfo - Extracted title information {method, path, title}
 * @returns {{isNewRequest: boolean, totalEntries: number}}
 */
export const addLogEntry = (requestId, content, titleInfo) => {
  let isNewRequest = false;

  if (!logEntriesByRequestId.has(requestId)) {
    // Create new request group
    logEntriesByRequestId.set(requestId, {
      requestId: requestId,
      entries: [],
      firstSeen: new Date(),
      lastSeen: new Date(),
      method: titleInfo.method,
      path: titleInfo.path,
      title: titleInfo.title
    });
    isNewRequest = true;
  }

  const requestGroup = logEntriesByRequestId.get(requestId);
  requestGroup.entries.push({
    content: content,
    timestamp: new Date()
  });
  requestGroup.lastSeen = new Date();

  return {
    isNewRequest: isNewRequest,
    totalEntries: requestGroup.entries.length
  };
};

/**
 * Gets all log data formatted for the renderer process
 * @returns {{totalRequests: number, requests: Array}}
 */
export const getFormattedLogData = () => {
  const logData = [];

  for (const [requestId, group] of logEntriesByRequestId) {
    logData.push({
      requestId: requestId,
      entriesCount: group.entries.length,
      firstSeen: group.firstSeen.toISOString(),
      lastSeen: group.lastSeen.toISOString(),
      method: group.method || 'UNKNOWN',
      path: group.path || 'Unknown',
      title: group.title || 'Unknown Request',
      entries: group.entries.map(entry => ({
        content: entry.content,
        timestamp: entry.timestamp.toISOString()
      }))
    });
  }

  return {
    totalRequests: logEntriesByRequestId.size,
    requests: logData
  };
};

/**
 * Clears all stored log data
 * @returns {boolean} Success status
 */
export const clearAllLogData = () => {
  try {
    logEntriesByRequestId.clear();
    return true;
  } catch (error) {
    console.error('Error clearing log data:', error);
    return false;
  }
};

/**
 * Gets statistics about stored log data
 * @returns {{totalRequests: number, totalEntries: number, oldestEntry?: Date, newestEntry?: Date}}
 */
export const getLogStatistics = () => {
  let totalEntries = 0;
  let oldestEntry = null;
  let newestEntry = null;

  for (const [, group] of logEntriesByRequestId) {
    totalEntries += group.entries.length;

    if (!oldestEntry || group.firstSeen < oldestEntry) {
      oldestEntry = group.firstSeen;
    }

    if (!newestEntry || group.lastSeen > newestEntry) {
      newestEntry = group.lastSeen;
    }
  }

  return {
    totalRequests: logEntriesByRequestId.size,
    totalEntries: totalEntries,
    oldestEntry: oldestEntry,
    newestEntry: newestEntry
  };
};

/**
 * Gets a specific request's data by ID
 * @param {string} requestId - The request ID to retrieve
 * @returns {object|null} Request data or null if not found
 */
export const getRequestById = (requestId) => {
  const group = logEntriesByRequestId.get(requestId);
  if (!group) return null;

  return {
    requestId: group.requestId,
    entriesCount: group.entries.length,
    firstSeen: group.firstSeen.toISOString(),
    lastSeen: group.lastSeen.toISOString(),
    method: group.method || 'UNKNOWN',
    path: group.path || 'Unknown',
    title: group.title || 'Unknown Request',
    entries: group.entries.map(entry => ({
      content: entry.content,
      timestamp: entry.timestamp.toISOString()
    }))
  };
};

/**
 * Displays log statistics to console (for debugging)
 */
export const displayLogsByRequestId = () => {
  console.log('\n=== Current Log Groups by Request ID ===');
  console.log(`Total unique requests: ${logEntriesByRequestId.size}`);

  for (const [requestId, group] of logEntriesByRequestId) {
    console.log(`\n📋 Request ID: ${requestId}`);
    console.log(`   Entries: ${group.entries.length}`);
    console.log(`   First seen: ${group.firstSeen.toISOString()}`);
    console.log(`   Last seen: ${group.lastSeen.toISOString()}`);
    console.log('   Recent entries:');

    // Show last 3 entries for this request
    const recentEntries = group.entries.slice(-3);
    recentEntries.forEach((entry, index) => {
      console.log(`     ${index + 1}. ${entry.content}`);
    });
  }
  console.log('=== End of Log Groups ===\n');
};