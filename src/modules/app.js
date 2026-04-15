/* global MAIN_WINDOW_VITE_DEV_SERVER_URL, MAIN_WINDOW_VITE_NAME */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import log from "electron-log";
import { isDev } from './devtools.js';
import { setupIpcHandlers, setMainWindow, streamDataToRenderer } from './ipcHandlers.js';
import { setLogIndexStorageDirectory } from './logIndex.js';
import { setLogDataCallback } from './logWatcher.js';
import { createMenu } from './menu.js';
import { setupAutoUpdater, checkForUpdatesOnStartup } from './autoUpdater.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

/**
 * Creates the main application window
 * @returns {Promise<BrowserWindow>}
 */
export const createWindow = async () => {
  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  mainWindow = win;
  setMainWindow(win);
  createMenu(win);

  // Set up callback for when new log data is available
  setLogDataCallback(() => {
    streamDataToRenderer();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    log.info('Development mode: Loading from Vite dev server...');
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);

    if (isDev) {
      win.webContents.openDevTools();
    }
  } else {
    const indexPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    await win.loadFile(indexPath);
  }

  // Send initial data when window is ready
  win.webContents.once('dom-ready', () => {
    streamDataToRenderer();
  });

  return win;
};

/**
 * Initializes the Electron application
 */
export const initializeApp = () => {
  log.initialize();

  // Set up IPC handlers before creating window
  setupIpcHandlers();

  app.whenReady().then(async () => {
    setLogIndexStorageDirectory(path.join(app.getPath('userData'), 'log-indexes'));
    await createWindow();

    // Set up auto-updater event handlers
    setupAutoUpdater(mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    // Check for updates after app is ready and window is created
    setTimeout(() => {
      checkForUpdatesOnStartup();
    }, 3000); // Wait 3 seconds after app start

  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
};

/**
 * Gets the main window instance
 * @returns {BrowserWindow|null}
 */
export const getMainWindow = () => {
  return mainWindow;
};
