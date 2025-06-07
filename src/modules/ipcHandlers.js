import { ipcMain, dialog } from 'electron';
import log from "electron-log";
import { prepareProject } from './projectManager.js';
import { startWatching, getWatchingStatus } from './logWatcher.js';
import { getFormattedLogData, clearAllLogData } from './logStorage.js';

// Reference to main window for sending data
let mainWindow = null;

/**
 * Sets the main window reference for IPC communication
 * @param {BrowserWindow} window - The main Electron window
 */
export const setMainWindow = (window) => {
  mainWindow = window;
};

/**
 * Sends log data to the renderer process
 */
export const streamDataToRenderer = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const logData = getFormattedLogData();
    mainWindow.webContents.send('log-data-update', logData);
  }
};

/**
 * Notifies renderer about project selection
 * @param {string} projectDirectory - Path to the selected project
 * @param {string} logFilePath - Path to the log file
 * @param {boolean} isWatching - Whether file watching is active
 */
export const notifyProjectSelected = (projectDirectory, logFilePath, isWatching) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('project-selected', {
      projectDirectory: projectDirectory,
      logFilePath: logFilePath,
      isWatching: isWatching
    });
  }
};

/**
 * Sets up all IPC handlers
 * @param {string} projectDirectory - Current project directory (reference)
 */
export const setupIpcHandlers = () => {
  let projectDirectory = null;

  // Handler for directory selection
  ipcMain.handle('select-directory', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Rails Project Directory',
        message: 'Choose a directory containing a Rails project (with Gemfile)'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: 'No directory selected' };
      }

      const selectedDir = result.filePaths[0];

      // Prepare and validate the project
      const projectResult = await prepareProject(selectedDir);

      if (projectResult.success) {
        projectDirectory = projectResult.projectPath;

        // Start watching the log file
        const watchResult = await startWatching(projectResult.logPath);

        if (watchResult.success) {
          // Notify renderer about the new project
          notifyProjectSelected(projectDirectory, projectResult.logPath, true);

          return {
            success: true,
            message: projectResult.message,
            projectDir: projectResult.projectPath,
            logFilePath: projectResult.logPath,
            logFileExists: true, // We can determine this from prepareProject if needed
            hasRailsGem: projectResult.hasRailsGem
          };
        } else {
          return {
            success: false,
            message: watchResult.message
          };
        }
      } else {
        return projectResult;
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  // Handler to get current project info
  ipcMain.handle('get-project-info', () => {
    const watchingStatus = getWatchingStatus();
    return {
      projectDirectory: projectDirectory,
      logFilePath: watchingStatus.logFilePath,
      isWatching: watchingStatus.isWatching,
      hasProject: !!projectDirectory
    };
  });

  // Handler for when renderer requests log data
  ipcMain.handle('get-log-data', () => {
    return getFormattedLogData();
  });

  // Handler to clear all log data
  ipcMain.handle('clear-logs', () => {
    try {
      const success = clearAllLogData();

      if (success) {
        log.info('All log entries cleared from main process');

        // Notify renderer about the cleared data
        streamDataToRenderer();

        return { success: true, message: 'All log data cleared successfully' };
      } else {
        return { success: false, message: 'Failed to clear log data' };
      }
    } catch (error) {
      log.error('Error clearing log data:', error);
      return { success: false, message: `Error clearing log data: ${error.message}` };
    }
  });

  log.info('IPC handlers set up successfully');
};