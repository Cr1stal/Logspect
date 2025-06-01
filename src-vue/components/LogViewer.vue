<template>
  <div class="log-viewer">
    <!-- Welcome Screen -->
    <div v-if="!hasProject" class="welcome-screen">
      <div class="welcome-content">
        <div class="welcome-icon">🚀</div>
        <h2>Welcome to LogMan</h2>
        <p>Select a Rails project directory to start monitoring logs</p>
        <div class="welcome-features">
          <div class="feature-item">
            <span class="feature-icon">📁</span>
            <span>Automatically detects Rails projects by checking for Gemfile</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">📊</span>
            <span>Real-time log monitoring with request grouping</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">🔍</span>
            <span>Smart HTTP method and path extraction</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">⚡</span>
            <span>Developer console-style interface</span>
          </div>
        </div>
        <button class="welcome-btn" @click="selectProject">
          📁 Select Rails Project Directory
        </button>
      </div>
    </div>

    <!-- Console Interface -->
    <div v-else class="console-interface">
      <div class="requests-panel">
        <div class="panel-header">
          Requests ({{ filteredRequests.length }})
        </div>

        <div class="filter-section">
          <input
            type="text"
            class="filter-input"
            placeholder="Filter by method, path, or request ID..."
            v-model="searchTerm"
          >
        </div>

        <div class="requests-list">
          <div v-if="logData.totalRequests === 0" class="empty-state">
            <div class="empty-icon">📄</div>
            <div>No requests detected yet</div>
          </div>

          <div
            v-for="request in filteredRequests"
            :key="request.requestId"
            :class="['request-item', { 'selected': selectedRequestId === request.requestId }]"
            @click="selectRequest(request.requestId)"
          >
            <div :class="['request-status', getRequestStatus(request)]"></div>
            <div class="request-details">
              <div class="request-title">
                <span :class="['request-method', `method-${request.method}`]">{{ request.method }}</span>
                <span class="request-path">{{ request.path }}</span>
              </div>
              <div class="request-id">{{ request.requestId }}</div>
              <div class="request-meta">
                <span class="entry-count">{{ request.entriesCount }} entries</span>
                <span>{{ formatTime(request.lastSeen) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="details-panel">
        <div class="details-header">
          <div class="details-title">Request Details</div>
          <div class="details-id">{{ selectedRequestId || 'Select a request' }}</div>
        </div>

        <div class="details-content">
          <div v-if="!selectedRequestId" class="empty-state">
            <div class="empty-icon">📋</div>
            <div>Select a request from the left panel to view its logs</div>
          </div>

          <div v-else-if="selectedRequest">
            <div
              v-for="(entry, index) in selectedRequest.entries"
              :key="index"
              class="log-entry"
            >
              <div class="log-content">{{ entry.content }}</div>
              <div class="log-timestamp">{{ formatDateTime(entry.timestamp) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LogViewer',
  data() {
    return {
      searchTerm: '',
      selectedRequestId: null,
      logData: {
        totalRequests: 0,
        requests: []
      },
      projectDirectory: '',
      hasProject: false,
      isWatching: false
    }
  },
  computed: {
    filteredRequests() {
      const searchLower = this.searchTerm.toLowerCase();
      return this.logData.requests.filter(request => {
        return request.requestId.toLowerCase().includes(searchLower) ||
               request.method.toLowerCase().includes(searchLower) ||
               request.path.toLowerCase().includes(searchLower) ||
               request.title.toLowerCase().includes(searchLower);
      });
    },
    selectedRequest() {
      if (!this.selectedRequestId) return null;
      const request = this.logData.requests.find(req => req.requestId === this.selectedRequestId);
      if (!request) return null;

      // Return a copy of the request with entries sorted in ascending order (oldest first)
      return {
        ...request,
        entries: [...request.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      };
    }
  },
  async mounted() {
    if (window.electronAPI) {
      await this.loadProjectInfo();
      this.setupLogListener();
    } else {
      console.warn('Not running in Electron environment');
    }
  },
  methods: {
    async loadProjectInfo() {
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
    setupLogListener() {
      window.electronAPI.onLogDataUpdate((data) => {
        this.logData = data;
      });
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
    async refreshLogs() {
      try {
        const data = await window.electronAPI.getLogData();
        this.logData = data;
      } catch (error) {
        console.error('Error refreshing logs:', error);
      }
    },
    selectRequest(requestId) {
      this.selectedRequestId = requestId;
    },
    getRequestStatus(request) {
      const timeDiff = new Date() - new Date(request.lastSeen);
      return timeDiff < 30000 ? 'active' : 'completed';
    },
    formatTime(timestamp) {
      return new Date(timestamp).toLocaleTimeString();
    },
    formatDateTime(timestamp) {
      return new Date(timestamp).toLocaleString();
    }
  }
}
</script>

<style scoped>
.log-viewer {
  height: 100vh;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', monospace;
}

.welcome-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e1e;
  height: 100%;
}

.welcome-content {
  text-align: center;
  max-width: 500px;
  padding: 40px;
}

.welcome-content h2 {
  color: #cccccc;
  font-size: 24px;
  margin-bottom: 12px;
  font-weight: 600;
}

.welcome-content p {
  color: #9ca3af;
  font-size: 14px;
  margin-bottom: 32px;
  line-height: 1.5;
}

.welcome-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.welcome-features {
  text-align: left;
  margin-bottom: 32px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  color: #d4d4d4;
  font-size: 13px;
}

.feature-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.welcome-btn {
  background: #0e639c;
  border: 1px solid #007acc;
  color: white;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.welcome-btn:hover {
  background: #094771;
  border-color: #005a9e;
  transform: translateY(-1px);
}

.console-interface {
  display: flex;
  height: 100%;
}

.requests-panel {
  width: 350px;
  background: #252526;
  border-right: 1px solid #3e3e42;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  background: #2d2d30;
  padding: 8px 12px;
  border-bottom: 1px solid #3e3e42;
  font-size: 12px;
  font-weight: 600;
  color: #cccccc;
  flex-shrink: 0;
}

.filter-section {
  padding: 8px 12px;
  border-bottom: 1px solid #3e3e42;
  background: #2d2d30;
  flex-shrink: 0;
}

.filter-input {
  width: 100%;
  background: #3c3c3c;
  border: 1px solid #464647;
  color: #d4d4d4;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-family: inherit;
}

.filter-input:focus {
  outline: none;
  border-color: #007acc;
  box-shadow: 0 0 0 1px #007acc;
}

.filter-input::placeholder {
  color: #6a9955;
}

.requests-list {
  flex: 1;
  overflow-y: auto;
  height: 0;
}

.request-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #2d2d30;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 12px;
}

.request-item:hover {
  background: #2a2d2e;
}

.request-item.selected {
  background: #094771;
  border-left: 3px solid #007acc;
}

.request-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
  flex-shrink: 0;
}

.request-status.active {
  background: #4ade80;
}

.request-status.completed {
  background: #6b7280;
}

.request-details {
  flex: 1;
  min-width: 0;
}

.request-title {
  color: #cccccc;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.request-method {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  margin-right: 6px;
  min-width: 40px;
  text-align: center;
}

.method-GET {
  background: #4ade80;
  color: #000;
}

.method-POST {
  background: #fbbf24;
  color: #000;
}

.method-PUT {
  background: #3b82f6;
  color: #fff;
}

.method-DELETE {
  background: #ef4444;
  color: #fff;
}

.method-PATCH {
  background: #8b5cf6;
  color: #fff;
}

.method-RAILS {
  background: #dc2626;
  color: #fff;
}

.method-API {
  background: #059669;
  color: #fff;
}

.method-WEB {
  background: #6b7280;
  color: #fff;
}

.method-LOG {
  background: #374151;
  color: #fff;
}

.method-UNKNOWN {
  background: #1f2937;
  color: #9ca3af;
}

.request-path {
  color: #9cdcfe;
  font-size: 11px;
  font-weight: normal;
}

.request-id {
  color: #6a9955;
  font-weight: 400;
  font-size: 10px;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.7;
}

.request-meta {
  display: flex;
  justify-content: space-between;
  color: #6a9955;
  font-size: 11px;
}

.entry-count {
  color: #ce9178;
  font-weight: 500;
}

.details-panel {
  flex: 1;
  background: #1e1e1e;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.details-header {
  background: #2d2d30;
  padding: 12px 16px;
  border-bottom: 1px solid #3e3e42;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.details-title {
  font-size: 13px;
  font-weight: 600;
  color: #cccccc;
}

.details-id {
  font-family: 'SF Mono', monospace;
  color: #9cdcfe;
  font-size: 11px;
  background: #3c3c3c;
  padding: 2px 6px;
  border-radius: 3px;
}

.details-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  height: 0;
}

.log-entry {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #262626;
  border-radius: 4px;
  border-left: 3px solid #007acc;
  font-size: 12px;
  line-height: 1.4;
}

.log-entry:last-child {
  border-left-color: #4ade80;
  background: #1a2e1a;
}

.log-content {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
  margin-bottom: 6px;
}

.log-timestamp {
  color: #6a9955;
  font-size: 10px;
  text-align: right;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6a9955;
  font-size: 14px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* Custom scrollbar for webkit browsers */
.requests-list::-webkit-scrollbar,
.details-content::-webkit-scrollbar {
  width: 8px;
}

.requests-list::-webkit-scrollbar-track,
.details-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.requests-list::-webkit-scrollbar-thumb,
.details-content::-webkit-scrollbar-thumb {
  background: #3c3c3c;
  border-radius: 4px;
}

.requests-list::-webkit-scrollbar-thumb:hover,
.details-content::-webkit-scrollbar-thumb:hover {
  background: #4a4a4a;
}
</style>