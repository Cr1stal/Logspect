import log from "electron-log";
import { mergeLogMetadata } from './logParser.js';

/**
 * Efficient storage for grouped log entries by UUID
 */
export const logEntriesByUuid = new Map();

/**
 * Adds a log entry to the storage, grouping by UUID
 * @param {string} uuid - The unique identifier
 * @param {string} content - The log content
 * @param {object} logInfo - Extracted log information {type, subType, success, metadata, title}
 * @returns {{isNewEntry: boolean, totalEntries: number}}
 */
export const addLogEntry = (uuid, content, logInfo) => {
  let isNewEntry = false;

  if (!logEntriesByUuid.has(uuid)) {
    // Create new log group
    logEntriesByUuid.set(uuid, {
      uuid: uuid,
      type: logInfo.type || 'unknown',
      subType: logInfo.subType || 'unknown',
      success: logInfo.success !== undefined ? logInfo.success : null,
      metadata: logInfo.metadata || {},
      title: logInfo.title || 'Unknown Entry',
      entries: [],
      firstSeen: new Date(),
      lastSeen: new Date()
    });
    isNewEntry = true;
  }

  const logGroup = logEntriesByUuid.get(uuid);
  logGroup.entries.push({
    content: content,
    timestamp: new Date()
  });
  logGroup.lastSeen = new Date();

  // Update success status if it's determined later
  if (logInfo.success !== undefined && logGroup.success === null) {
    logGroup.success = logInfo.success;
  }

  // Merge metadata
  if (logInfo.metadata && Object.keys(logInfo.metadata).length > 0) {
    logGroup.metadata = mergeLogMetadata(logGroup.metadata, logInfo.metadata);
  }

  return {
    isNewEntry: isNewEntry,
    totalEntries: logGroup.entries.length
  };
};

/**
 * Gets all log data formatted for the renderer process
 * @returns {{totalEntries: number, entries: Array}}
 */
export const getFormattedLogData = () => {
  const logData = [];

  for (const [uuid, group] of logEntriesByUuid) {
    logData.push({
      uuid: uuid,
      type: group.type,
      subType: group.subType,
      success: group.success,
      metadata: group.metadata,
      title: group.title,
      entriesCount: group.entries.length,
      firstSeen: group.firstSeen.toISOString(),
      lastSeen: group.lastSeen.toISOString(),
      entries: group.entries.map(entry => ({
        content: entry.content,
        timestamp: entry.timestamp.toISOString()
      }))
    });
  }

  return {
    totalEntries: logEntriesByUuid.size,
    entries: logData
  };
};

/**
 * Clears all stored log data
 * @returns {boolean} Success status
 */
export const clearAllLogData = () => {
  try {
    logEntriesByUuid.clear();
    return true;
  } catch (error) {
    log.error('Error clearing log data:', error);
    return false;
  }
};

/**
 * Gets statistics about stored log data
 * @returns {{totalEntries: number, totalLogEntries: number, oldestEntry?: Date, newestEntry?: Date, typeBreakdown: object}}
 */
export const getLogStatistics = () => {
  let totalLogEntries = 0;
  let oldestEntry = null;
  let newestEntry = null;
  const typeBreakdown = {};

  for (const [, group] of logEntriesByUuid) {
    totalLogEntries += group.entries.length;

    // Track type breakdown
    if (!typeBreakdown[group.type]) {
      typeBreakdown[group.type] = 0;
    }
    typeBreakdown[group.type]++;

    if (!oldestEntry || group.firstSeen < oldestEntry) {
      oldestEntry = group.firstSeen;
    }

    if (!newestEntry || group.lastSeen > newestEntry) {
      newestEntry = group.lastSeen;
    }
  }

  return {
    totalEntries: logEntriesByUuid.size,
    totalLogEntries: totalLogEntries,
    oldestEntry: oldestEntry,
    newestEntry: newestEntry,
    typeBreakdown: typeBreakdown
  };
};

/**
 * Gets a specific log entry's data by UUID
 * @param {string} uuid - The UUID to retrieve
 * @returns {object|null} Log entry data or null if not found
 */
export const getEntryByUuid = (uuid) => {
  const group = logEntriesByUuid.get(uuid);
  if (!group) return null;

  return {
    uuid: group.uuid,
    type: group.type,
    subType: group.subType,
    success: group.success,
    metadata: group.metadata,
    title: group.title,
    entriesCount: group.entries.length,
    firstSeen: group.firstSeen.toISOString(),
    lastSeen: group.lastSeen.toISOString(),
    entries: group.entries.map(entry => ({
      content: entry.content,
      timestamp: entry.timestamp.toISOString()
    }))
  };
};

/**
 * Displays log statistics to console (for debugging)
 */
export const displayLogsByUuid = () => {
  log.info('\n=== Current Log Groups by UUID ===');
  log.info(`Total unique entries: ${logEntriesByUuid.size}`);

  for (const [uuid, group] of logEntriesByUuid) {
    log.info(`\n📋 UUID: ${uuid}`);
    log.info(`   Type: ${group.type}/${group.subType}`);
    log.info(`   Success: ${group.success}`);
    log.info(`   Entries: ${group.entries.length}`);
    log.info(`   First seen: ${group.firstSeen.toISOString()}`);
    log.info(`   Last seen: ${group.lastSeen.toISOString()}`);
    log.info(`   Metadata: ${JSON.stringify(group.metadata)}`);
    log.info('   Recent entries:');

    // Show last 3 entries for this UUID
    const recentEntries = group.entries.slice(-3);
    recentEntries.forEach((entry, index) => {
      log.info(`     ${index + 1}. ${entry.content}`);
    });
  }
  log.info('=== End of Log Groups ===\n');
};
