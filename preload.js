// This file needs to be in CommonJS format

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getLogData: () => ipcRenderer.invoke('get-log-data'),
  onLogDataUpdate: (callback) => {
    ipcRenderer.on('log-data-update', (event, data) => callback(data));
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log-data-update');
  },
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getProjectInfo: () => ipcRenderer.invoke('get-project-info'),
  onProjectSelected: (callback) => {
    ipcRenderer.on('project-selected', (event, data) => callback(data));
  }
});