import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let lastSize = 0;
const logFilePath = `/Users/bilal/SparkLoop/SparkLoop/log/development.log`;
let mainWindow = null; // Store reference to main window

// Efficient storage for grouped log entries by request ID
const logEntriesByRequestId = new Map();

// Regex to extract request ID from log lines like [aa32797f-b087-4d45-9d99-28198952a784]
const requestIdRegex = /^\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/;

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

const watchFile = async () => {
  // Initialize by reading current file size
  try {
    const stats = await fs.promises.stat(logFilePath);
    lastSize = stats.size;
    console.log(`Started watching log file: ${logFilePath}`);
    console.log(`Initial file size: ${lastSize} bytes`);
  } catch (err) {
    console.error('Log file not found, will wait for it to be created:', logFilePath);
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
};

const createWindow = () => {
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
  win.loadFile('public/index.html')

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

app.whenReady().then(() => {
  createWindow()
  watchFile()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})