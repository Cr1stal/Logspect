import { defineStore } from 'pinia'

export const useLogStore = defineStore('log', {
  state: () => ({
    // Project state
    hasProject: false,
    projectDirectory: '',
    isWatching: false,

    // Log data state
    logData: {
      totalRequests: 0,
      requests: []
    },

    // UI state
    selectedRequestId: null,
    autoScroll: true,
    isRefreshing: false,

    // Search state
    searchTerm: '',
    filteredRequests: []
  }),

  getters: {
    projectName: (state) => {
      if (!state.projectDirectory) return '';
      return state.projectDirectory.split('/').pop() || 'Unknown Project';
    },

    totalEntries: (state) => {
      return state.logData.requests.reduce((sum, req) => sum + req.entriesCount, 0);
    },

    selectedRequest: (state) => {
      if (!state.selectedRequestId) return null;
      const request = state.logData.requests.find(req => req.requestId === state.selectedRequestId);
      if (!request) return null;

      // Return a copy of the request with entries sorted in ascending order (oldest first)
      return {
        ...request,
        entries: [...request.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      };
    }
  },

  actions: {
    // Project actions
    async loadProjectInfo() {
      if (!window.electronAPI) {
        console.warn('Not running in Electron environment');
        return;
      }

      try {
        const projectInfo = await window.electronAPI.getProjectInfo();
        this.hasProject = projectInfo.hasProject;
        this.projectDirectory = projectInfo.projectDirectory || '';
        this.isWatching = projectInfo.isWatching;

        if (this.hasProject) {
          await this.refreshLogs();
        }
      } catch (error) {
        console.error('Error loading project info:', error);
      }
    },

    async selectProject() {
      try {
        const result = await window.electronAPI.selectDirectory();
        if (result.success) {
          this.hasProject = true;
          this.projectDirectory = result.projectDir;
          this.isWatching = true;
          await this.refreshLogs();
        } else {
          console.error('Failed to select project:', result.message);
        }
      } catch (error) {
        console.error('Error selecting project:', error);
      }
    },

    // Log data actions
    updateLogData(data) {
      this.logData = data;

      // Update filtered requests if there's a search term
      if (this.searchTerm.trim()) {
        this.updateFilteredRequests();
      }
    },

    async refreshLogs() {
      this.isRefreshing = true;
      try {
        const data = await window.electronAPI.getLogData();
        this.updateLogData(data);
      } catch (error) {
        console.error('Error refreshing logs:', error);
      } finally {
        setTimeout(() => {
          this.isRefreshing = false;
        }, 1000);
      }
    },

    async clearLogs() {
      if (confirm('Clear all request logs? This will remove all captured log data.')) {
        try {
          const result = await window.electronAPI.clearLogs();

          if (result.success) {
            console.log('Logs cleared successfully from main process');
            this.selectedRequestId = null;
            this.searchTerm = '';
            this.filteredRequests = [];
          } else {
            console.error('Failed to clear logs:', result.message);
            alert('Failed to clear logs: ' + result.message);
          }
        } catch (error) {
          console.error('Error clearing logs:', error);
          alert('Error clearing logs: ' + error.message);
        }
      }
    },

    // UI actions
    selectRequest(requestId) {
      this.selectedRequestId = requestId;
    },

    toggleAutoScroll() {
      this.autoScroll = !this.autoScroll;
    },

    // Search actions
    setSearchTerm(term) {
      this.searchTerm = term;
      this.updateFilteredRequests();
    },

    updateFilteredRequests() {
      if (!this.searchTerm.trim()) {
        // If no search term, return all requests sorted by last seen
        this.filteredRequests = [...this.logData.requests].sort((a, b) =>
          new Date(b.lastSeen) - new Date(a.lastSeen)
        );
        return;
      }

      // Simple search fallback
      const searchLower = this.searchTerm.toLowerCase();
      this.filteredRequests = this.logData.requests.filter(request => {
        return request.requestId.toLowerCase().includes(searchLower) ||
               request.method.toLowerCase().includes(searchLower) ||
               request.path.toLowerCase().includes(searchLower) ||
               request.title.toLowerCase().includes(searchLower);
      }).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    },

    // Setup electron listeners
    setupLogListener() {
      if (window.electronAPI) {
        window.electronAPI.onLogDataUpdate((data) => {
          this.updateLogData(data);
        });
      }
    }
  }
})