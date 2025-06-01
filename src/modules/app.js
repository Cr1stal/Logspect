import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { isDev, VITE_DEV_SERVER_URL } from './devtools.js';
import { setupIpcHandlers, setMainWindow, streamDataToRenderer } from './ipcHandlers.js';
import { setLogDataCallback } from './logWatcher.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow = null;

/**
 * Creates the main application window
 * @returns {Promise<BrowserWindow>}
 */
export const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload.js')
    }
  });

  mainWindow = win;
  setMainWindow(win);

  // Set up callback for when new log data is available
  setLogDataCallback(() => {
    streamDataToRenderer();
  });

  // Load app from Vite dev server in development, or from built files in production
  if (isDev) {
    try {
      console.log('Development mode: Loading from Vite dev server...');
      await win.loadURL(VITE_DEV_SERVER_URL);

      // Open DevTools in development
      win.webContents.openDevTools();
    } catch (error) {
      console.error('Failed to load from Vite dev server. Make sure to run "pnpm dev" first.');
      console.error('Error:', error.message);

      // Fallback to the original HTML file if Vite server is not running
      console.log('Falling back to static HTML file...');
      win.loadFile('public/index.html');
    }
  } else {
    // Production mode: load from built files
    const indexPath = path.join(__dirname, '../../dist/index.html');
    if (fs.existsSync(indexPath)) {
      win.loadFile(indexPath);
    } else {
      // Fallback to public/index.html if dist doesn't exist
      win.loadFile('public/index.html');
    }
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
  // Set up IPC handlers before creating window
  setupIpcHandlers();

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
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