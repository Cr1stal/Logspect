import { ipcMain, dialog } from 'electron';
import path from 'path';
import log from "electron-log";
import { prepareProject } from './projectManager.js';
import { startWatching, getWatchingStatus } from './logWatcher.js';
import { getFormattedLogData, clearAllLogData } from './logStorage.js';
import {
  cancelLogIndexing,
  getIndexedRawLine,
  getIndexedLogViewPage,
  getIndexedLogViewState,
  getLogIndexStatus,
  openIndexedAnchor,
  setLogIndexStatusCallback,
  startLogIndexing
} from './logIndex.js';
import {
  getLiveRawLine,
  openLiveAnchor
} from './liveEvidenceStore.js';
import {
  cancelActiveLogSearch,
  searchLogFile,
  setLogSearchResultsCallback,
  setLogSearchStatusCallback
} from './logSearch.js';
import { getRecentProjects, addRecentProject, removeRecentProject, clearRecentProjects } from './recentProjects.js';

// Reference to main window for sending data
let mainWindow = null;

/**
 * Sets the main window reference for IPC communication
 * @param {BrowserWindow} window - The main Electron window
 */
export const setMainWindow = (window) => {
  mainWindow = window;

  setLogSearchStatusCallback((searchStatus) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-search-status', searchStatus);
    }
  });

  setLogSearchResultsCallback((searchResults) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-search-results', searchResults);
    }
  });

  setLogIndexStatusCallback((indexStatus) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-index-status', indexStatus);
    }
  });
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
 * @param {Array} availableLogFiles - Available log files inside the project
 */
export const notifyProjectSelected = (projectDirectory, logFilePath, isWatching, availableLogFiles = []) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('project-selected', {
      projectDirectory: projectDirectory,
      logFilePath: logFilePath,
      isWatching: isWatching,
      availableLogFiles: availableLogFiles
    });
  }
};

/**
 * Sets up all IPC handlers
 * @param {string} projectDirectory - Current project directory (reference)
 */
export const setupIpcHandlers = () => {
  let projectDirectory = null;
  let availableLogFiles = [];

  const buildProjectResponse = (projectResult, isWatching) => ({
    success: true,
    message: projectResult.message,
    projectDir: projectResult.projectPath,
    logFilePath: projectResult.logPath,
    logFileExists: projectResult.logFileExists,
    hasRailsGem: projectResult.hasRailsGem,
    availableLogFiles: projectResult.availableLogFiles || [],
    isWatching: isWatching
  });

  const activateProjectSelection = async (projectResult) => {
    cancelActiveLogSearch();
    cancelLogIndexing();

    const watchingStatus = getWatchingStatus();
    const isSameSource = projectDirectory === projectResult.projectPath &&
      watchingStatus.logFilePath === projectResult.logPath;
    const indexedViewState = isSameSource
      ? { success: false }
      : await getIndexedLogViewState(projectResult.logPath).catch((error) => {
        log.warn('Failed to read indexed log view state:', error);
        return { success: false };
      });

    const watchResult = (isSameSource && watchingStatus.isWatching)
      ? { success: true }
      : await startWatching(projectResult.logPath, indexedViewState.success
        ? {
            startOffset: indexedViewState.coveredBytes,
            loadExistingContent: indexedViewState.coveredBytes < indexedViewState.totalBytes,
            startOffsetAtLineBoundary: true
          }
        : undefined);

    if (!watchResult.success) {
      return {
        success: false,
        message: watchResult.message
      };
    }

    projectDirectory = projectResult.projectPath;
    availableLogFiles = projectResult.availableLogFiles || [];

    if (!isSameSource) {
      clearAllLogData();
      streamDataToRenderer();
    }

    const updatedWatchingStatus = getWatchingStatus();
    notifyProjectSelected(
      projectDirectory,
      projectResult.logPath,
      updatedWatchingStatus.isWatching,
      availableLogFiles
    );

    void startLogIndexing(projectResult.logPath);

    return buildProjectResponse(projectResult, updatedWatchingStatus.isWatching);
  };

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
        return await activateProjectSelection(projectResult);
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

  // Handler for selecting a recent project
  ipcMain.handle('select-recent-project', async (event, projectPath) => {
    try {
      // Prepare and validate the project
      const projectResult = await prepareProject(projectPath);

      if (projectResult.success) {
        return await activateProjectSelection(projectResult);
      } else {
        return projectResult;
      }
    } catch (error) {
      console.error('Error selecting recent project:', error);
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
      availableLogFiles: availableLogFiles,
      hasProject: !!projectDirectory
    };
  });

  ipcMain.handle('start-log-search', async (event, query) => {
    try {
      const watchingStatus = getWatchingStatus();
      if (!projectDirectory || !watchingStatus.logFilePath) {
        return {
          success: false,
          message: 'Select a Rails project before searching the log file.'
        };
      }

      return await searchLogFile(watchingStatus.logFilePath, query);
    } catch (error) {
      console.error('Error starting log search:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  ipcMain.handle('cancel-log-search', () => {
    try {
      return cancelActiveLogSearch();
    } catch (error) {
      console.error('Error cancelling log search:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  ipcMain.handle('get-log-index-status', () => {
    try {
      return getLogIndexStatus();
    } catch (error) {
      console.error('Error getting log index status:', error);
      return {
        logFilePath: '',
        status: 'error',
        error: error.message
      };
    }
  });

  ipcMain.handle('rebuild-log-index', async () => {
    try {
      const watchingStatus = getWatchingStatus();
      if (!projectDirectory || !watchingStatus.logFilePath) {
        return {
          success: false,
          message: 'Select a Rails project before rebuilding the log index.'
        };
      }

      const result = await startLogIndexing(watchingStatus.logFilePath, {
        forceRebuild: true
      });

      return {
        success: true,
        status: result.status || getLogIndexStatus()
      };
    } catch (error) {
      console.error('Error rebuilding log index:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  // Handler to refresh available log files for the current project
  ipcMain.handle('get-project-log-files', async () => {
    try {
      if (!projectDirectory) {
        return {
          success: false,
          message: 'No Rails project selected.',
          availableLogFiles: []
        };
      }

      const watchingStatus = getWatchingStatus();
      const projectResult = await prepareProject(projectDirectory, watchingStatus.logFilePath);

      if (!projectResult.success) {
        return {
          success: false,
          message: projectResult.message,
          availableLogFiles: availableLogFiles
        };
      }

      availableLogFiles = projectResult.availableLogFiles || [];

      return {
        success: true,
        availableLogFiles: availableLogFiles,
        logFilePath: projectResult.logPath,
        logFileExists: projectResult.logFileExists
      };
    } catch (error) {
      console.error('Error getting project log files:', error);
      return {
        success: false,
        message: `Error: ${error.message}`,
        availableLogFiles: availableLogFiles
      };
    }
  });

  // Handler for switching the active project log file
  ipcMain.handle('select-project-log-file', async (event, logFilePath) => {
    try {
      if (!projectDirectory) {
        return {
          success: false,
          message: 'Select a Rails project before choosing a log file.'
        };
      }

      const projectResult = await prepareProject(projectDirectory, logFilePath);
      if (!projectResult.success) {
        return projectResult;
      }

      return await activateProjectSelection(projectResult);
    } catch (error) {
      console.error('Error selecting project log file:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  // Handler for browsing any log file on disk for the current project
  ipcMain.handle('browse-project-log-file', async () => {
    try {
      if (!projectDirectory) {
        return {
          success: false,
          message: 'Select a Rails project before choosing a log file.'
        };
      }

      const watchingStatus = getWatchingStatus();
      const defaultPath = watchingStatus.logFilePath
        ? path.dirname(watchingStatus.logFilePath)
        : path.join(projectDirectory, 'log');

      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: 'Select Log File',
        defaultPath,
        filters: [
          { name: 'Log files', extensions: ['log'] },
          { name: 'All files', extensions: ['*'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          canceled: true,
          message: 'No log file selected.'
        };
      }

      const projectResult = await prepareProject(projectDirectory, result.filePaths[0]);
      if (!projectResult.success) {
        return projectResult;
      }

      return await activateProjectSelection(projectResult);
    } catch (error) {
      console.error('Error browsing project log file:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  // Handler for when renderer requests log data
  ipcMain.handle('get-log-data', () => {
    return getFormattedLogData();
  });

  ipcMain.handle('get-log-view-page', async (event, options = {}) => {
    try {
      const watchingStatus = getWatchingStatus();
      if (!projectDirectory || !watchingStatus.logFilePath) {
        return {
          success: false,
          message: 'Select a Rails project before loading log entries.'
        };
      }

      const result = await getIndexedLogViewPage(watchingStatus.logFilePath, options);
      if (!result.success) {
        return {
          success: true,
          mode: 'live'
        };
      }

      return {
        success: true,
        mode: 'indexed',
        ...result
      };
    } catch (error) {
      console.error('Error loading indexed log page:', error);
      return {
        success: false,
        message: `Error: ${error.message}`
      };
    }
  });

  ipcMain.handle('get-log-raw-line', async (event, rawLineId) => {
    try {
      if (!rawLineId) {
        return null;
      }

      const liveRawLine = getLiveRawLine(rawLineId);
      if (liveRawLine) {
        return liveRawLine;
      }

      const watchingStatus = getWatchingStatus();
      if (!projectDirectory || !watchingStatus.logFilePath) {
        return null;
      }

      return await getIndexedRawLine(watchingStatus.logFilePath, rawLineId);
    } catch (error) {
      console.error('Error opening raw log line evidence:', error);
      return null;
    }
  });

  ipcMain.handle('open-log-anchor', async (event, anchorId) => {
    try {
      if (!anchorId) {
        return null;
      }

      const liveAnchor = openLiveAnchor(anchorId);
      if (liveAnchor) {
        return liveAnchor;
      }

      const watchingStatus = getWatchingStatus();
      if (!projectDirectory || !watchingStatus.logFilePath) {
        return null;
      }

      return await openIndexedAnchor(watchingStatus.logFilePath, anchorId);
    } catch (error) {
      console.error('Error opening log anchor evidence:', error);
      return null;
    }
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

  // Recent Projects IPC Handlers

  // Handler to get recent projects
  ipcMain.handle('get-recent-projects', () => {
    try {
      return getRecentProjects();
    } catch (error) {
      console.error('Error getting recent projects:', error);
      return [];
    }
  });

  // Handler to add a project to recent projects
  ipcMain.handle('add-recent-project', (event, projectPath) => {
    try {
      return addRecentProject(projectPath);
    } catch (error) {
      console.error('Error adding recent project:', error);
      return getRecentProjects(); // Return current list on error
    }
  });

  // Handler to remove a project from recent projects
  ipcMain.handle('remove-recent-project', (event, projectPath) => {
    try {
      return removeRecentProject(projectPath);
    } catch (error) {
      console.error('Error removing recent project:', error);
      return getRecentProjects(); // Return current list on error
    }
  });

  // Handler to clear all recent projects
  ipcMain.handle('clear-recent-projects', () => {
    try {
      return clearRecentProjects();
    } catch (error) {
      console.error('Error clearing recent projects:', error);
      return [];
    }
  });

  log.info('IPC handlers set up successfully');
};
