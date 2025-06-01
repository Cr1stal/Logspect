import fs from 'fs';
import path from 'path';

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
 * Checks if the Rails development log file exists
 * @param {string} dirPath - Path to the Rails project directory
 * @returns {Promise<{exists: boolean, path: string, size?: number, modified?: Date, error?: string}>}
 */
export const checkLogFile = async (dirPath) => {
  try {
    const logPath = path.join(dirPath, 'log', 'development.log');
    const stats = await fs.promises.stat(logPath);
    return {
      exists: true,
      path: logPath,
      size: stats.size,
      modified: stats.mtime
    };
  } catch (error) {
    return {
      exists: false,
      path: path.join(dirPath, 'log', 'development.log'),
      error: error.message
    };
  }
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
 * @returns {Promise<{success: boolean, projectPath?: string, logPath?: string, hasRailsGem?: boolean, message: string}>}
 */
export const prepareProject = async (projectPath) => {
  try {
    // Validate Rails project
    const validation = await validateRailsProject(projectPath);
    if (!validation.valid) {
      return {
        success: false,
        message: 'This directory does not contain a Gemfile. Please select a Rails project directory.'
      };
    }

    // Check log file
    const logCheck = await checkLogFile(projectPath);

    const result = {
      success: true,
      projectPath: projectPath,
      logPath: logCheck.path,
      hasRailsGem: validation.hasRailsGem,
      message: logCheck.exists
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