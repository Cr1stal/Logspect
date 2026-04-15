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
      :totalRequests="logStore.viewerLogData.totalEntries"
      :totalEntries="logStore.totalLogEntries"
      :autoScroll="logStore.autoScroll"
      :isRefreshing="logStore.isRefreshing"
      :searchTerm="logStore.searchDraft"
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
      @submit-search="logStore.submitSearch"
      @toggle-invert="toggleInvert"
      @toggle-category="toggleCategory"
    />

    <SearchStatus
      v-if="logStore.isDiskSearchVisible"
      :query="logStore.diskSearch.query || logStore.searchTerm.trim()"
      :backend="logStore.diskSearch.backend"
      :status="logStore.diskSearch.status"
      :progressPercent="logStore.diskSearch.progressPercent"
      :bytesProcessed="logStore.diskSearch.bytesProcessed"
      :totalBytes="logStore.diskSearch.totalBytes"
      :matchedLines="logStore.diskSearch.matchedLines"
      :shownGroups="logStore.diskSearch.shownGroups"
      :truncated="logStore.diskSearch.truncated"
      :error="logStore.diskSearch.error"
      @stop-search="logStore.stopSearch"
      @clear-search="logStore.clearSearch"
    />

    <!-- Main Container -->
    <div class="main-container">
      <!-- Console Interface -->
      <div class="console-interface">
        <EntryList
          :entries="logStore.displayedLogData.entries"
          :totalEntries="logStore.displayedLogData.totalEntries"
          :selectedUuid="logStore.selectedUuid"
          :searchTerm="logStore.searchTerm"
          :invertOrder="invertOrder"
          :activeCategories="activeCategories"
          :searchMode="logStore.isDiskSearchVisible ? 'disk' : 'local'"
          :emptyMessage="entryListEmptyMessage"
          :listLabel="logStore.isDiskSearchVisible ? 'Matches' : 'Entries'"
          :canLoadMore="logStore.canLoadMoreEntries"
          :isLoadingMore="logStore.isLoadingMoreEntries"
          @select-entry="logStore.selectEntry"
          @load-more="logStore.loadMoreEntries"
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
      :totalRequests="logStore.viewerLogData.totalEntries"
      :totalEntries="logStore.totalLogEntries"
      :indexStatus="logStore.logIndex"
    />
  </div>
</template>

<script>
import { useLogStore } from '../stores/logStore.js'
import Toolbar from './Toolbar.vue'
import EntryList from './EntryList.vue'
import EntryDetails from './EntryDetails.vue'
import Footer from './Footer.vue'
import SearchStatus from './SearchStatus.vue'

export default {
  name: 'LogViewer',
  components: {
    Toolbar,
    EntryList,
    EntryDetails,
    Footer,
    SearchStatus
  },
  setup() {
    const logStore = useLogStore()

    return {
      logStore
    }
  },
  data() {
    return {
      invertOrder: false,
      activeCategories: ['all']
    }
  },
  computed: {
    entryListEmptyMessage() {
      if (!this.logStore.isDiskSearchVisible) {
        return 'No log entries detected yet'
      }

      if (this.logStore.isDiskSearchRunning) {
        return 'Searching the whole file...'
      }

      if (this.logStore.diskSearch.status === 'error') {
        return this.logStore.diskSearch.error || 'Search failed.'
      }

      return `No matches found for "${this.logStore.searchTerm.trim()}"`
    }
  },
  methods: {
    updateSearch(term) {
      void this.logStore.updateSearchDraft(term)
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
