// This file needs to be in CommonJS format

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getLogData: () => ipcRenderer.invoke('get-log-data'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  onLogDataUpdate: (callback) => {
    ipcRenderer.on('log-data-update', (event, data) => callback(data));
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log-data-update');
  },
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectRecentProject: (projectPath) => ipcRenderer.invoke('select-recent-project', projectPath),
  selectProjectLogFile: (logFilePath) => ipcRenderer.invoke('select-project-log-file', logFilePath),
  browseProjectLogFile: () => ipcRenderer.invoke('browse-project-log-file'),
  getProjectInfo: () => ipcRenderer.invoke('get-project-info'),
  getProjectLogFiles: () => ipcRenderer.invoke('get-project-log-files'),
  getLogIndexStatus: () => ipcRenderer.invoke('get-log-index-status'),
  startLogSearch: (query) => ipcRenderer.invoke('start-log-search', query),
  cancelLogSearch: () => ipcRenderer.invoke('cancel-log-search'),
  onProjectSelected: (callback) => {
    ipcRenderer.on('project-selected', (event, data) => callback(data));
  },
  onLogSearchStatus: (callback) => {
    ipcRenderer.on('log-search-status', (event, data) => callback(data));
  },
  onLogSearchResults: (callback) => {
    ipcRenderer.on('log-search-results', (event, data) => callback(data));
  },
  onLogIndexStatus: (callback) => {
    ipcRenderer.on('log-index-status', (event, data) => callback(data));
  },
  // Recent Projects API
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  addRecentProject: (projectPath) => ipcRenderer.invoke('add-recent-project', projectPath),
  removeRecentProject: (projectPath) => ipcRenderer.invoke('remove-recent-project', projectPath),
  clearRecentProjects: () => ipcRenderer.invoke('clear-recent-projects')
});
