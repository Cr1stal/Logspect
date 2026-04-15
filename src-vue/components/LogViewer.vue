<template>
  <div class="log-viewer">
    <!-- Toolbar -->
    <Toolbar
      ref="toolbar"
      :hasProject="logStore.hasProject"
      :projectDirectory="logStore.projectDirectory"
      :selectedLogFilePath="logStore.selectedLogFilePath"
      :availableLogFiles="logStore.availableLogFiles"
      :isWatching="logStore.isWatching"
      :totalRequests="logStore.logData.totalEntries"
      :totalEntries="logStore.totalLogEntries"
      :autoScroll="logStore.autoScroll"
      :isRefreshing="logStore.isRefreshing"
      :searchTerm="searchTerm"
      :invertOrder="invertOrder"
      :activeCategories="activeCategories"
      @select-project="logStore.selectProject"
      @select-log-file="logStore.selectProjectLogFile"
      @browse-log-file="logStore.browseProjectLogFile"
      @refresh-log-files="logStore.refreshAvailableLogFiles"
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
      <!-- Console Interface -->
      <div class="console-interface">
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
      :totalRequests="logStore.logData.totalEntries"
      :totalEntries="logStore.totalLogEntries"
    />
  </div>
</template>

<script>
import { useLogStore } from '../stores/logStore.js'
import Toolbar from './Toolbar.vue'
import EntryList from './EntryList.vue'
import EntryDetails from './EntryDetails.vue'
import Footer from './Footer.vue'

export default {
  name: 'LogViewer',
  components: {
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
    },
    handleKeydown(event) {
      // Handle Cmd+F (Mac) or Ctrl+F (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        if (this.$refs.toolbar && this.logStore.hasProject) {
          this.$refs.toolbar.focusSearchInput();
        }
      }
    }
  },
  mounted() {
    // Add keyboard event listener
    document.addEventListener('keydown', this.handleKeydown)
  },
  beforeUnmount() {
    // Clean up keyboard event listener
    document.removeEventListener('keydown', this.handleKeydown)
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
