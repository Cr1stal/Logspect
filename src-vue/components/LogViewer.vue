<template>
  <div class="log-viewer">
    <!-- Toolbar -->
    <Toolbar
      :hasProject="logStore.hasProject"
      :projectDirectory="logStore.projectDirectory"
      :isWatching="logStore.isWatching"
      :totalRequests="logStore.logData.totalRequests"
      :totalEntries="logStore.totalEntries"
      :autoScroll="logStore.autoScroll"
      :isRefreshing="logStore.isRefreshing"
      @select-project="logStore.selectProject"
      @refresh="logStore.refreshLogs"
      @clear="logStore.clearLogs"
      @toggle-auto-scroll="logStore.toggleAutoScroll"
    />

    <!-- Main Container -->
    <div class="main-container">
      <!-- Welcome Screen -->
      <WelcomeScreen
        v-if="!logStore.hasProject"
        @select-project="logStore.selectProject"
      />

      <!-- Console Interface -->
      <div v-else class="console-interface">
        <RequestList
          :requests="logStore.logData.requests"
          :totalRequests="logStore.logData.totalRequests"
          :selectedRequestId="logStore.selectedRequestId"
          @select-request="logStore.selectRequest"
        />

        <RequestDetails
          :selectedRequestId="logStore.selectedRequestId"
          :selectedRequest="logStore.selectedRequest"
          :autoScroll="logStore.autoScroll"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { useLogStore } from '../stores/logStore.js'
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
  setup() {
    const logStore = useLogStore()

    return {
      logStore
    }
  },
  async mounted() {
    // Load project info and set up listeners
    await this.logStore.loadProjectInfo()
    this.logStore.setupLogListener()
  }
}
</script>

<style scoped>
@reference "../style.css";

.log-viewer {
  @apply h-screen bg-slate-900 text-slate-300 font-mono overflow-hidden;
}

.main-container {
  @apply flex;
  height: calc(100vh - 40px);
}

.console-interface {
  @apply flex-1 flex h-full;
}
</style>