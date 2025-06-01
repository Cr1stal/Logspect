<template>
  <div class="log-viewer">
    <!-- Toolbar -->
    <Toolbar
      :hasProject="hasProject"
      :projectDirectory="projectDirectory"
      :isWatching="isWatching"
      :totalRequests="logData.totalRequests"
      :totalEntries="totalEntries"
      :autoScroll="autoScroll"
      :isRefreshing="isRefreshing"
      @select-project="selectProject"
      @refresh="refreshLogs"
      @clear="clearDisplay"
      @toggle-auto-scroll="toggleAutoScroll"
    />

    <!-- Main Container -->
    <div class="main-container">
      <!-- Welcome Screen -->
      <WelcomeScreen
        v-if="!hasProject"
        @select-project="selectProject"
      />

      <!-- Console Interface -->
      <div v-else class="console-interface">
        <RequestList
          :requests="logData.requests"
          :totalRequests="logData.totalRequests"
          :selectedRequestId="selectedRequestId"
          @select-request="selectRequest"
        />

        <RequestDetails
          :selectedRequestId="selectedRequestId"
          :selectedRequest="selectedRequest"
          :autoScroll="autoScroll"
        />
      </div>
    </div>
  </div>
</template>

<script>
import WelcomeScreen from './WelcomeScreen.vue'
import Toolbar from './Toolbar.vue'
import RequestList from './RequestList.vue'
import RequestDetails from './RequestDetails.vue'

export default {
  name: 'LogViewer',
  components: {
    WelcomeScreen,
    Toolbar,
    RequestList,
    RequestDetails
  },
  data() {
    return {
      selectedRequestId: null,
      logData: {
        totalRequests: 0,
        requests: []
      },
      projectDirectory: '',
      hasProject: false,
      isWatching: false,
      autoScroll: true,
      isRefreshing: false
    }
  },
  computed: {
    totalEntries() {
      return this.logData.requests.reduce((sum, req) => sum + req.entriesCount, 0);
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
      this.isRefreshing = true;
      try {
        const data = await window.electronAPI.getLogData();
        this.logData = data;
      } catch (error) {
        console.error('Error refreshing logs:', error);
      } finally {
        setTimeout(() => {
          this.isRefreshing = false;
        }, 1000);
      }
    },
    selectRequest(requestId) {
      this.selectedRequestId = requestId;
    },
    async clearDisplay() {
      if (confirm('Clear all request logs? This will remove all captured log data.')) {
        try {
          // Clear logs in the main process
          const result = await window.electronAPI.clearLogs();

          if (result.success) {
            console.log('Logs cleared successfully from main process');

            // The main process will send a log-data-update event with empty data
            // which will automatically update our logData through the listener

            // Reset UI state immediately
            this.selectedRequestId = null;
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
    toggleAutoScroll() {
      this.autoScroll = !this.autoScroll;
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
  overflow: hidden;
}

.main-container {
  display: flex;
  height: calc(100vh - 40px);
}

.console-interface {
  flex: 1;
  display: flex;
  height: 100%;
}
</style>