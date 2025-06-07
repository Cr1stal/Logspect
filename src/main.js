/**
 * Logspect - Rails Log Monitor
 * Main Electron process entry point
 *
 * This file now uses a modular architecture for better maintainability:
 * - modules/app.js - Main Electron app and window management
 * - modules/projectManager.js - Project validation and directory selection
 * - modules/logWatcher.js - File watching and log reading
 * - modules/logParser.js - Log parsing, regex, and content extraction
 * - modules/logStorage.js - Data storage and management
 * - modules/ipcHandlers.js - IPC communication handlers
 * - modules/devtools.js - Development tools setup
 */

import { initializeApp } from './modules/app.js';
// import { installVueDevTools } from './modules/devtools.js';

// Install Vue DevTools in development mode
// installVueDevTools();

// Initialize the Electron application
initializeApp();