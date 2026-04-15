import fs from 'fs';
import path from 'path';

const LOG_DIRECTORY_NAME = 'log';
const DEFAULT_LOG_FILENAME = 'development.log';
const DEFAULT_LOG_RELATIVE_PATH = path.join(LOG_DIRECTORY_NAME, DEFAULT_LOG_FILENAME);

const getProjectLogDirectory = (projectPath) => path.join(projectPath, LOG_DIRECTORY_NAME);

const formatProjectLogFile = (projectPath, absolutePath) => ({
  name: path.basename(absolutePath),
  path: absolutePath,
  relativePath: path.relative(projectPath, absolutePath),
  displayPath: path.relative(projectPath, absolutePath),
  source: 'project'
});

const formatExternalLogFile = (absolutePath) => ({
  name: path.basename(absolutePath),
  path: absolutePath,
  relativePath: absolutePath,
  displayPath: absolutePath,
  source: 'external'
});

const sortLogFiles = (left, right) => {
  if (left.relativePath === DEFAULT_LOG_RELATIVE_PATH && right.relativePath !== DEFAULT_LOG_RELATIVE_PATH) {
    return -1;
  }

  if (right.relativePath === DEFAULT_LOG_RELATIVE_PATH && left.relativePath !== DEFAULT_LOG_RELATIVE_PATH) {
    return 1;
  }

  if (left.name === DEFAULT_LOG_FILENAME && right.name !== DEFAULT_LOG_FILENAME) {
    return -1;
  }

  if (right.name === DEFAULT_LOG_FILENAME && left.name !== DEFAULT_LOG_FILENAME) {
    return 1;
  }

  return left.relativePath.localeCompare(right.relativePath);
};

const isPathInsideDirectory = (directoryPath, candidatePath) => {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
};

const isLogFilePath = (filePath) => path.extname(filePath).toLowerCase() === '.log';

const collectProjectLogFiles = async (projectPath, currentDirectory = projectPath) => {
  const entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true });
  const nestedResults = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      return collectProjectLogFiles(projectPath, entryPath);
    }

    if (entry.isFile() && isLogFilePath(entry.name)) {
      return formatProjectLogFile(projectPath, entryPath);
    }

    return [];
  }));

  return nestedResults.flat();
};

const mergeAvailableLogFiles = (availableLogFiles, selectedLogFile) => {
  if (!selectedLogFile) {
    return availableLogFiles;
  }

  const existingLogFileIndex = availableLogFiles.findIndex(file => file.path === selectedLogFile.path);
  if (existingLogFileIndex === -1) {
    return [selectedLogFile, ...availableLogFiles];
  }

  return availableLogFiles.map(file => (
    file.path === selectedLogFile.path ? { ...file, ...selectedLogFile } : file
  ));
};

/**
 * Validates if a directory is a Rails project by checking for Gemfile
 * @param {string} dirPath - Path to the directory to validate
 * @returns {Promise<{valid: boolean, hasRailsGem?: boolean, gemfilePath?: string, error?: string}>}
 */
export const validateRailsProject = async (dirPath) => {
  try {
    const gemfilePath = path.join(dirPath, 'Gemfile');
    await fs.promises.access(gemfilePath, fs.constants.F_OK);

    // Additional check: read Gemfile content to ensure it's actually a Rails project
    const gemfileContent = await fs.promises.readFile(gemfilePath, 'utf8');
    const hasRailsGem = gemfileContent.includes('rails') ||
                       gemfileContent.includes('gem "rails"') ||
                       gemfileContent.includes("gem 'rails'");

    return {
      valid: true,
      hasRailsGem: hasRailsGem,
      gemfilePath: gemfilePath
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

/**
 * Lists available log files anywhere inside the Rails project directory
 * @param {string} projectPath - Path to the Rails project directory
 * @returns {Promise<{exists: boolean, directory: string, files: Array, error?: string}>}
 */
export const listProjectLogFiles = async (projectPath) => {
  try {
    const files = (await collectProjectLogFiles(projectPath))
      .sort(sortLogFiles);

    return {
      exists: true,
      directory: projectPath,
      files
    };
  } catch (error) {
    return {
      exists: false,
      directory: projectPath,
      files: [],
      error: error.message
    };
  }
};

/**
 * Checks if a specific log file exists
 * @param {string} logPath - Path to the log file
 * @returns {Promise<{exists: boolean, path: string, size?: number, modified?: Date, error?: string}>}
 */
export const checkLogFile = async (logPath) => {
  try {
    const stats = await fs.promises.stat(logPath);
    return {
      exists: stats.isFile(),
      path: logPath,
      size: stats.size,
      modified: stats.mtime
    };
  } catch (error) {
    return {
      exists: false,
      path: logPath,
      error: error.message
    };
  }
};

/**
 * Resolves which project log file should be watched
 * @param {string} projectPath - Path to the Rails project directory
 * @param {string|null} requestedLogPath - Explicitly requested log file path
 * @returns {Promise<{success: boolean, logPath?: string, logFileExists?: boolean, availableLogFiles?: Array, message?: string}>}
 */
export const resolveProjectLogFile = async (projectPath, requestedLogPath = null) => {
  const projectLogDirectory = getProjectLogDirectory(projectPath);
  const logFilesResult = await listProjectLogFiles(projectPath);
  const availableProjectLogFiles = logFilesResult.files;
  const defaultLogPath = path.join(projectLogDirectory, DEFAULT_LOG_FILENAME);
  const defaultAvailableLogFile = availableProjectLogFiles.find(file => file.name === DEFAULT_LOG_FILENAME);

  let selectedLogPath = requestedLogPath
    ? path.resolve(requestedLogPath)
    : (defaultAvailableLogFile?.path || availableProjectLogFiles[0]?.path || defaultLogPath);

  if (!isLogFilePath(selectedLogPath)) {
    return {
      success: false,
      message: 'Selected file must use the .log extension.'
    };
  }

  const selectedLogFile = isPathInsideDirectory(projectPath, selectedLogPath)
    ? formatProjectLogFile(projectPath, selectedLogPath)
    : formatExternalLogFile(selectedLogPath);

  const logCheck = await checkLogFile(selectedLogPath);

  return {
    success: true,
    logPath: selectedLogPath,
    logFileExists: logCheck.exists,
    availableLogFiles: mergeAvailableLogFiles(availableProjectLogFiles, selectedLogFile)
  };
};

/**
 * Gets the project name from a directory path
 * @param {string} projectPath - Full path to the project directory
 * @returns {string} Project name (last directory in path)
 */
export const getProjectName = (projectPath) => {
  if (!projectPath) return '';
  return projectPath.split(path.sep).pop() || 'Unknown Project';
};

/**
 * Validates and prepares a Rails project for monitoring
 * @param {string} projectPath - Path to the project directory
 * @param {string|null} requestedLogPath - Explicitly requested log file path
 * @returns {Promise<{success: boolean, projectPath?: string, logPath?: string, hasRailsGem?: boolean, message: string}>}
 */
export const prepareProject = async (projectPath, requestedLogPath = null) => {
  try {
    // Validate Rails project
    const validation = await validateRailsProject(projectPath);
    if (!validation.valid) {
      return {
        success: false,
        message: 'This directory does not contain a Gemfile. Please select a Rails project directory.'
      };
    }

    // Resolve the log file to watch
    const logSelection = await resolveProjectLogFile(projectPath, requestedLogPath);
    if (!logSelection.success) {
      return {
        success: false,
        message: logSelection.message
      };
    }

    const result = {
      success: true,
      projectPath: projectPath,
      logPath: logSelection.logPath,
      logFileExists: logSelection.logFileExists,
      availableLogFiles: logSelection.availableLogFiles,
      hasRailsGem: validation.hasRailsGem,
      message: logSelection.logFileExists
        ? `Successfully connected to Rails project`
        : `Rails project selected. Waiting for log file to be created.`
    };

    return result;
  } catch (error) {
    return {
      success: false,
      message: `Error preparing project: ${error.message}`
    };
  }
};
