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
      :searchTerm="searchTerm"
      :invertOrder="invertOrder"
      :activeCategories="activeCategories"
      @select-project="logStore.selectProject"
      @refresh="logStore.refreshLogs"
      @clear="logStore.clearLogs"
      @toggle-auto-scroll="logStore.toggleAutoScroll"
      @toggle-watching="logStore.toggleWatching"
      @update-search="updateSearch"
      @toggle-invert="toggleInvert"
      @toggle-category="toggleCategory"
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
          :searchTerm="searchTerm"
          :invertOrder="invertOrder"
          :activeCategories="activeCategories"
          @select-entry="logStore.selectEntry"
        />

        <EntryDetails
          :selectedUuid="logStore.selectedUuid"
          :selectedEntry="logStore.selectedEntry"
          :autoScroll="logStore.autoScroll"
        />
      </div>
    </div>

    <!-- Footer -->
    <Footer
      v-if="logStore.hasProject"
      :totalRequests="logStore.logData.totalEntries"
      :totalEntries="logStore.totalLogEntries"
    />
  </div>
</template>

<script>
import { useLogStore } from '../stores/logStore.js'
import WelcomeScreen from './WelcomeScreen.vue'
import Toolbar from './Toolbar.vue'
import EntryList from './EntryList.vue'
import EntryDetails from './EntryDetails.vue'
import Footer from './Footer.vue'

export default {
  name: 'LogViewer',
  components: {
    WelcomeScreen,
    Toolbar,
    EntryList,
    EntryDetails,
    Footer
  },
  data() {
    return {
      searchTerm: '',
      invertOrder: false,
      activeCategories: ['all']
    }
  },
  setup() {
    const logStore = useLogStore()

    return {
      logStore
    }
  },
  methods: {
    updateSearch(term) {
      this.searchTerm = term;
    },
    toggleInvert(invert) {
      this.invertOrder = invert;
    },
    toggleCategory(category) {
      if (category === 'all') {
        this.activeCategories = ['all'];
      } else {
        // Remove 'all' if it exists
        this.activeCategories = this.activeCategories.filter(c => c !== 'all');

        if (this.activeCategories.includes(category)) {
          // Remove category
          this.activeCategories = this.activeCategories.filter(c => c !== category);
          // If no categories left, select 'all'
          if (this.activeCategories.length === 0) {
            this.activeCategories = ['all'];
          }
        } else {
          // Add category
          this.activeCategories.push(category);
        }
      }
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
  @apply h-screen bg-slate-800 text-slate-300 font-mono overflow-hidden flex flex-col;
}

.main-container {
  @apply flex flex-1 min-h-0;
}

.console-interface {
  @apply flex-1 flex h-full;
}
</style>