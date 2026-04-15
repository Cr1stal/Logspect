# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Development Setup:**

- `pnpm install` - Install dependencies
- `pnpm start` - Start Electron Forge with the integrated Vite renderer (recommended)
- `overmind start` - Run the same integrated dev flow via `Procfile.dev`
- `pnpm dev` - Start the renderer Vite server only

**Building:**

- `pnpm build` - Build the renderer bundle only
- `pnpm dist` - Create Electron Forge distributables
- `pnpm dist:mac` - Build macOS `.dmg` and `.zip` artifacts
- `pnpm release` - Publish the macOS release through Electron Forge

**Tests are configured with Vitest** - use `pnpm test` or `pnpm test:run`.

## Architecture Overview

**Logspect** is an Electron-based Rails log viewer with a modular architecture:

### Core Architecture

- **Electron Main Process** (`src/`) - Handles file watching, log parsing, and data storage
- **Vue.js Frontend** (`src-vue/`) - Modern UI built with Vue 3, Vite, and Tailwind CSS
- **IPC Communication** - Secure communication between main and renderer processes via preload script

### Key Modules (src/modules/)

- `app.js` - Main Electron app and window management
- `logWatcher.js` - File watching and incremental log reading (watches Rails log/development.log)
- `logParser.js` - Parses Rails logs, extracts UUIDs, JIDs, HTTP requests, and system logs
- `logStorage.js` - In-memory storage with Map-based grouping by UUID/JID
- `projectManager.js` - Rails project validation and directory selection
- `ipcHandlers.js` - IPC communication handlers
- `devtools.js` - Development environment setup

### Log Processing Pipeline

1. **File Watching** - Real-time monitoring of Rails development.log
2. **Parsing** - Extracts three log types:
   - Web requests (with UUID) - grouped by request ID
   - Background jobs (with JID) - grouped by Sidekiq job ID
   - System logs - grouped by time-based UUID (5-second windows)
3. **Storage** - Groups related log entries by identifier
4. **Frontend** - Vue components display grouped logs with filtering and search

### Frontend Structure (src-vue/)

- `stores/logStore.js` - Pinia store managing project state, log data, and search
- `components/` - Vue components for log viewing, entry details, and toolbar
- `App.vue` - Main application component with welcome screen and log viewer

### Build Configuration

- **Electron Forge** packages and publishes the app
- **Forge's Vite plugin** bundles the Electron main, preload, and renderer processes
- Development uses the integrated Forge + Vite workflow
- Production artifacts are emitted under `out/`

### Key Data Structures

- Log entries grouped by UUID/JID with metadata (type, success status, timing)
- Real-time streaming from main process to renderer
- Efficient incremental file reading (only reads new content)
