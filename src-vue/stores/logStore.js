import { defineStore } from 'pinia'

export const useLogStore = defineStore('log', {
  state: () => ({
    // Project state
    hasProject: false,
    projectDirectory: '',
    isWatching: false,

    // Log data state
    logData: {
      totalEntries: 0,
      entries: []
    },

    // UI state
    selectedUuid: null,
    autoScroll: true,
    isRefreshing: false,

    // Search state
    searchTerm: '',
    filteredEntries: []
  }),

  getters: {
    projectName: (state) => {
      if (!state.projectDirectory) return '';
      return state.projectDirectory.split('/').pop() || 'Unknown Project';
    },

    totalLogEntries: (state) => {
      return state.logData.entries.reduce((sum, entry) => sum + entry.entriesCount, 0);
    },

    selectedEntry: (state) => {
      if (!state.selectedUuid) return null;
      const entry = state.logData.entries.find(entry => entry.uuid === state.selectedUuid);
      if (!entry) return null;

      // Return a copy of the entry with entries sorted in ascending order (oldest first)
      return {
        ...entry,
        entries: [...entry.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      };
    },

    // Statistics by type
    typeBreakdown: (state) => {
      const breakdown = {
        web: 0,
        app: 0,
        worker: 0,
        unknown: 0
      };

      state.logData.entries.forEach(entry => {
        if (breakdown.hasOwnProperty(entry.type)) {
          breakdown[entry.type]++;
        } else {
          breakdown.unknown++;
        }
      });

      return breakdown;
    },

    // Success rate statistics
    successStats: (state) => {
      let total = 0;
      let successful = 0;
      let failed = 0;
      let pending = 0;

      state.logData.entries.forEach(entry => {
        total++;
        if (entry.success === true) {
          successful++;
        } else if (entry.success === false) {
          failed++;
        } else {
          pending++;
        }
      });

      return {
        total,
        successful,
        failed,
        pending,
        successRate: total > 0 ? (successful / total) * 100 : 0
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
          return result.projectDir; // Return the selected path
        } else {
          console.error('Failed to select project:', result.message);
          return null;
        }
      } catch (error) {
        console.error('Error selecting project:', error);
        return null;
      }
    },

    async selectRecentProject(projectPath) {
      try {
        const result = await window.electronAPI.selectRecentProject(projectPath);
        if (result.success) {
          this.hasProject = true;
          this.projectDirectory = result.projectDir;
          this.isWatching = true;
          await this.refreshLogs();
          return true;
        } else {
          console.error('Failed to select recent project:', result.message);
          return false;
        }
      } catch (error) {
        console.error('Error selecting recent project:', error);
        return false;
      }
    },

    // Log data actions
    updateLogData(data) {
      this.logData = data;

      // Update filtered entries if there's a search term
      if (this.searchTerm.trim()) {
        this.updateFilteredEntries();
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
      if (confirm('Clear all log entries? This will remove all captured log data.')) {
        try {
          const result = await window.electronAPI.clearLogs();

          if (result.success) {
            console.log('Logs cleared successfully from main process');
            this.selectedUuid = null;
            this.searchTerm = '';
            this.filteredEntries = [];
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
    selectEntry(uuid) {
      this.selectedUuid = uuid;
    },

    toggleAutoScroll() {
      this.autoScroll = !this.autoScroll;
    },

    async toggleWatching() {
      try {
        if (this.isWatching) {
          // Stop watching
          await window.electronAPI.stopWatching();
          this.isWatching = false;
        } else {
          // Start watching
          await window.electronAPI.startWatching();
          this.isWatching = true;
        }
      } catch (error) {
        console.error('Error toggling watching:', error);
      }
    },

    // Search actions
    setSearchTerm(term) {
      this.searchTerm = term;
      this.updateFilteredEntries();
    },

    updateFilteredEntries() {
      if (!this.searchTerm.trim()) {
        // If no search term, return all entries sorted by last seen
        this.filteredEntries = [...this.logData.entries].sort((a, b) =>
          new Date(b.lastSeen) - new Date(a.lastSeen)
        );
        return;
      }

      // Simple search fallback
      const searchLower = this.searchTerm.toLowerCase();
      this.filteredEntries = this.logData.entries.filter(entry => {
        return entry.uuid.toLowerCase().includes(searchLower) ||
               entry.type.toLowerCase().includes(searchLower) ||
               entry.subType.toLowerCase().includes(searchLower) ||
               entry.title.toLowerCase().includes(searchLower) ||
               (entry.metadata && Object.values(entry.metadata).some(value =>
                 String(value).toLowerCase().includes(searchLower)
               ));
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