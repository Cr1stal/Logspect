<template>
  <div class="log-viewer">
    <!-- Toolbar -->
    <Toolbar
      :hasProject="logStore.hasProject"
      :projectDirectory="logStore.projectDirectory"
      :isWatching="logStore.isWatching"
      :totalRequests="logStore.logData.totalEntries"
      :totalEntries="logStore.totalLogEntries"
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
        <EntryList
          :entries="logStore.logData.entries"
          :totalEntries="logStore.logData.totalEntries"
          :selectedUuid="logStore.selectedUuid"
          @select-entry="logStore.selectEntry"
        />

        <EntryDetails
          :selectedUuid="logStore.selectedUuid"
          :selectedEntry="logStore.selectedEntry"
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
import EntryList from './EntryList.vue'
import EntryDetails from './EntryDetails.vue'

export default {
  name: 'LogViewer',
  components: {
    WelcomeScreen,
    Toolbar,
    EntryList,
    EntryDetails
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
  @apply h-screen bg-slate-800 text-slate-300 font-mono overflow-hidden;
}

.main-container {
  @apply flex;
  height: calc(100vh - 40px);
}

.console-interface {
  @apply flex-1 flex h-full;
}
</style>