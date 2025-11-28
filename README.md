# Logspect - Ruby on Rails Log Viewer

A powerful Electron-based log viewer application for Ruby on Rails projects. It aims to become the dev tool for log related debugging and unlock productivity.

## Features

- Modern Vue.js frontend with Vite for fast development
- Beautiful, responsive UI for log viewing and management
- Real-time log filtering and searching by request ID
- Rails log parsing and grouping by request
- Multiple HTTP method support (GET, POST, PUT, DELETE, PATCH)
- Cross-platform Electron application

## How to use

- Download the latest release from the [releases page](https://github.com/logspect/logspect/releases)
- Add `config.log_tags = [ :request_id ]` to your Rails application's `config/application.rb` file
- Restart your Rails application
- Open Logspect and select your Rails application directory
- Start your Rails application
- Open Logspect and start viewing logs

## Development

### Prerequisites

- Node.js (v16 or higher)
- pnpm package manager
- overmind (brew install overmind)

### Getting Started

#### Option 1: Integrated Development (Recommended)

Run both Vite dev server and Electron together:

```bash
pnpm install
overmind start
```

This will:

1. Start the Vite development server at `http://localhost:5173`
2. Wait for Vite to be ready, then launch Electron
3. Enable hot module replacement for fast development
4. Automatically open DevTools in Electron

#### Option 2: Manual Development

If you prefer to run them separately:

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the Vue.js development server:

   ```bash
   pnpm dev
   ```

3. In another terminal, start Electron in development mode:

   ```bash
   pnpm start
   ```

### Building

- Build the Vue.js frontend for production:

  ```bash
  pnpm build
  ```

- Create Electron distribution (includes building Vue app):

  ```bash
  pnpm dist
  ```

### Available Scripts

- `pnpm dev` - Start Vite development server only
- `pnpm start` - Start Electron in development mode
- `pnpm build` - Build Vue.js app for production
- `pnpm start` - Start Electron with built files
- `pnpm dist` - Build and package Electron app

## Project Structure

- `src/` - Electron main process files
  - `main.js` - Main Electron process with Rails log parsing
- `src-vue/` - Vue.js frontend source code
  - `components/` - Vue components
  - `assets/` - Static assets
  - `App.vue` - Main Vue application
  - `main.js` - Vue application entry point
  - `index.html` - Development HTML template
- `public/` - Public assets and fallback HTML files
- `dist/` - Built frontend files (generated)
- `vite.config.js` - Vite configuration
- `preload.js` - Electron preload script for secure IPC

## How It Works

1. **Development Mode**: Electron loads the Vue app from the Vite dev server (`http://localhost:5173`) with hot reload
2. **Production Mode**: Electron loads the built Vue app from the `dist` folder
3. **Rails Integration**: Select a Rails project directory to monitor `log/development.log`
4. **Real-time Updates**: Log entries are parsed and grouped by request ID, then streamed to the Vue frontend

## Tech Stack

- **Frontend**: Vue.js 3, Vite
- **Desktop**: Electron
- **Package Manager**: pnpm
- **Build Tool**: electron-builder
- **Development**: concurrently, wait-on, cross-env

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
