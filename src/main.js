import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

let lastSize = 0;
let logFilePath = null; // Will be set when user selects directory
let projectDirectory = null;
let isWatching = false;
let watcher = null;
let mainWindow = null; // Store reference to main window

// Efficient storage for grouped log entries by request ID
const logEntriesByRequestId = new Map();

// Regex to extract request ID from log lines like [aa32797f-b087-4d45-9d99-28198952a784]
const requestIdRegex = /^\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/;

// Function to validate if directory is a Rails project
const validateRailsProject = async (dirPath) => {
  try {
    const gemfilePath = path.join(dirPath, 'Gemfile');
    await fs.promises.access(gemfilePath, fs.constants.F_OK);

    // Additional check: read Gemfile content to ensure it's actually a Rails project
    const gemfileContent = await fs.promises.readFile(gemfilePath, 'utf8');
    const hasRailsGem = gemfileContent.includes('rails') || gemfileContent.includes('gem "rails"') || gemfileContent.includes("gem 'rails'");

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

// Function to check if log file exists
const checkLogFile = async (dirPath) => {
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

// Function to stop watching current file
const stopWatching = () => {
  if (isWatching && watcher) {
    fs.unwatchFile(logFilePath);
    isWatching = false;
    watcher = null;
    console.log('Stopped watching previous log file');
  }
};

// Function to start watching new log file
const startWatching = async (newLogPath) => {
  stopWatching();

  logFilePath = newLogPath;
  lastSize = 0;

  // Clear previous log data
  logEntriesByRequestId.clear();
  streamDataToRenderer();

  try {
    const stats = await fs.promises.stat(logFilePath);
    lastSize = stats.size;
    console.log(`Started watching log file: ${logFilePath}`);
    console.log(`Initial file size: ${lastSize} bytes`);
  } catch (err) {
    console.log('Log file not found, will wait for it to be created:', logFilePath);
    lastSize = 0;
  }

  fs.watchFile(logFilePath, {
    persistent: true,
    interval: 500
  }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      console.log('File change detected...');
      readLogFile();
    }
  });

  isWatching = true;

  // Notify renderer about the new project
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('project-selected', {
      projectDirectory: projectDirectory,
      logFilePath: logFilePath,
      isWatching: true
    });
  }
};

// IPC handler for directory selection
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

    // Validate Rails project
    const validation = await validateRailsProject(selectedDir);
    if (!validation.valid) {
      return {
        success: false,
        message: 'This directory does not contain a Gemfile. Please select a Rails project directory.'
      };
    }

    // Check log file
    const logCheck = await checkLogFile(selectedDir);

    projectDirectory = selectedDir;

    if (logCheck.exists) {
      await startWatching(logCheck.path);
      return {
        success: true,
        message: `Successfully connected to Rails project`,
        projectDir: selectedDir,
        logFilePath: logCheck.path,
        logFileExists: true,
        hasRailsGem: validation.hasRailsGem
      };
    } else {
      // Log file doesn't exist yet, but we can still watch for it
      await startWatching(logCheck.path);
      return {
        success: true,
        message: `Rails project selected. Waiting for log file to be created.`,
        projectDir: selectedDir,
        logFilePath: logCheck.path,
        logFileExists: false,
        hasRailsGem: validation.hasRailsGem
      };
    }
  } catch (error) {
    console.error('Error selecting directory:', error);
    return {
      success: false,
      message: `Error: ${error.message}`
    };
  }
});

// IPC handler to get current project info
ipcMain.handle('get-project-info', () => {
  return {
    projectDirectory: projectDirectory,
    logFilePath: logFilePath,
    isWatching: isWatching,
    hasProject: !!projectDirectory
  };
});

// Function to send data to renderer process
const streamDataToRenderer = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
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

    mainWindow.webContents.send('log-data-update', {
      totalRequests: logEntriesByRequestId.size,
      requests: logData
    });
  }
};

// Function to extract meaningful title from log content
const extractRequestTitle = (content) => {
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

const parseLogEntry = (logLine) => {
  const match = logLine.match(requestIdRegex);

  if (match) {
    const requestId = match[1];
    const content = logLine.trim();

    // Add to grouped storage
    if (!logEntriesByRequestId.has(requestId)) {
      // Extract title from the first log entry
      const titleInfo = extractRequestTitle(content);

      logEntriesByRequestId.set(requestId, {
        requestId: requestId,
        entries: [],
        firstSeen: new Date(),
        lastSeen: new Date(),
        method: titleInfo.method,
        path: titleInfo.path,
        title: titleInfo.title
      });
    }

    const requestGroup = logEntriesByRequestId.get(requestId);
    requestGroup.entries.push({
      content: content,
      timestamp: new Date()
    });
    requestGroup.lastSeen = new Date();

    // Stream updated data to renderer
    streamDataToRenderer();

    return {
      requestId: requestId,
      content: content,
      isNewRequest: requestGroup.entries.length === 1
    };
  }

  return {
    requestId: null,
    content: logLine.trim(),
    isNewRequest: false
  };
};

const displayLogsByRequestId = () => {
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

const readLogFile = async () => {
  if (!logFilePath) {
    console.log('No log file path set. Please select a Rails project directory first.');
    return;
  }

  try {
    const stats = await fs.promises.stat(logFilePath);
    const currentSize = stats.size;

    if (currentSize > lastSize) {
      // Only read the new content from where we left off
      const stream = fs.createReadStream(logFilePath, {
        start: lastSize,
        encoding: 'utf8'
      });

      let newContent = '';
      stream.on('data', (chunk) => {
        newContent += chunk;
      });

      stream.on('end', () => {
        if (newContent.trim()) {
          console.log('=== New log entries detected ===');

          // Split by lines and process each line
          const lines = newContent.split('\n').filter(line => line.trim());

          lines.forEach(line => {
            const parsed = parseLogEntry(line);

            if (parsed.requestId) {
              if (parsed.isNewRequest) {
                console.log(`🆕 New request started: ${parsed.requestId}`);
              } else {
                console.log(`📝 Additional entry for: ${parsed.requestId}`);
              }
              console.log(`   ${parsed.content}`);
            } else {
              console.log(`❓ Unmatched log: ${parsed.content}`);
            }
          });

          // Optionally display summary every 10 new entries
          if (lines.length >= 5) {
            displayLogsByRequestId();
          }

          console.log('=== End of new entries ===\n');
        }
        lastSize = currentSize;
      });

      stream.on('error', (err) => {
        console.error('Error reading log file:', err);
      });
    }
  } catch (err) {
    console.error('Error accessing log file:', err);
  }
};

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.js')
    }
  })

  mainWindow = win; // Store reference

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
    const indexPath = path.join(__dirname, '../dist/index.html');
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
}

// IPC handler for when renderer requests data
ipcMain.handle('get-log-data', () => {
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
});

// IPC handler to clear all log data
ipcMain.handle('clear-logs', () => {
  try {
    // Clear all stored log entries
    logEntriesByRequestId.clear();

    console.log('All log entries cleared from main process');

    // Notify renderer about the cleared data
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-data-update', {
        totalRequests: 0,
        requests: []
      });
    }

    return { success: true, message: 'All log data cleared successfully' };
  } catch (error) {
    console.error('Error clearing log data:', error);
    return { success: false, message: `Error clearing log data: ${error.message}` };
  }
});

// Install Vue DevTools in development
if (isDev) {
  import('electron-devtools-installer').then(({ default: installExtension, VUEJS3_DEVTOOLS }) => {
    app.whenReady().then(() => {
      installExtension(VUEJS3_DEVTOOLS)
        .then((name) => console.log(`Added Extension: ${name}`))
        .catch((err) => console.log('An error occurred installing Vue DevTools: ', err));
    });
  }).catch(err => {
    console.log('Could not load electron-devtools-installer:', err);
  });
}

app.whenReady().then(() => {
  createWindow()
  // Don't start watching automatically - wait for user to select directory

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})