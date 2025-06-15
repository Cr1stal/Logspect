<template>
  <div class="entries-panel">
    <div class="panel-header">
      Entries ({{ displayedEntries.length }})
    </div>

    <div class="filter-section">
      <input
        type="text"
        class="filter-input"
        placeholder="Search entries... (supports fuzzy search)"
        :value="logStore.searchTerm"
        @input="updateSearch"
      >
    </div>

    <div class="entries-list">
      <div v-if="totalEntries === 0" class="empty-state">
        <div class="empty-icon">📄</div>
        <div>No log entries detected yet</div>
      </div>

      <div
        v-for="entry in displayedEntries"
        :key="entry.uuid"
        :class="['entry-item', { 'selected': selectedUuid === entry.uuid }]"
        @click="$emit('select-entry', entry.uuid)"
      >
        <div class="entry-details">
          <div class="entry-title">
            <span :class="['entry-type', `type-${entry.type}`]">{{ entry.type.toUpperCase() }}</span>
            <span :class="['entry-subtype', `subtype-${entry.subType}`]">{{ entry.subType }}</span>
            <span v-if="entry.success !== null" :class="['success-indicator', entry.success ? 'success' : 'failed']">
              {{ entry.success ? '✓' : '✗' }}
            </span>
          </div>
          <div class="entry-title-text">{{ entry.title }}</div>
          <div class="entry-uuid">{{ entry.uuid }}</div>
          <div class="entry-meta">
            <span class="entry-count">{{ entry.entriesCount }} entries</span>
            <span>{{ formatTime(entry.lastSeen) }}</span>
          </div>
          <div v-if="Object.keys(entry.metadata || {}).length > 0" class="entry-metadata">
            <span v-if="entry.metadata.responseTime" class="metadata-item">
              {{ entry.metadata.responseTime }}ms
            </span>
            <span v-if="entry.metadata.statusCode" class="metadata-item">
              {{ entry.metadata.statusCode }}
            </span>
            <span v-if="entry.metadata.level" class="metadata-item">
              {{ entry.metadata.level }}
            </span>
            <span v-if="entry.metadata.duration" class="metadata-item">
              {{ entry.metadata.duration }}{{ entry.metadata.duration < 10 ? 's' : 'ms' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import MiniSearch from 'minisearch'
import { useLogStore } from '../stores/logStore.js'

export default {
  name: 'EntryList',
  props: {
    entries: {
      type: Array,
      default: () => []
    },
    totalEntries: {
      type: Number,
      default: 0
    },
    selectedUuid: {
      type: String,
      default: null
    }
  },
  setup() {
    const logStore = useLogStore()
    return { logStore }
  },
  data() {
    return {
      miniSearch: null,
      searchResults: []
    }
  },
  computed: {
    displayedEntries() {
      const searchTerm = this.logStore.searchTerm.trim();

      if (!searchTerm) {
        // If no search term, return all entries sorted by first seen
        return [...this.entries].sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen));
      }

      if (!this.miniSearch || this.searchResults.length === 0) {
        // Use store's simple search fallback
        this.logStore.updateFilteredEntries();
        return this.logStore.filteredEntries;
      }

      // Return MiniSearch results with relevance scoring
      return this.searchResults.map(result => {
        const entry = this.entries.find(entry => entry.uuid === result.id);
        return { ...entry, searchScore: result.score };
      }).filter(Boolean);
    }
  },
  watch: {
    entries: {
      handler: 'rebuildSearchIndex',
      deep: true
    }
  },
  mounted() {
    this.initializeSearch();
  },
  methods: {
    initializeSearch() {
      // Initialize MiniSearch with configuration optimized for log data
      this.miniSearch = new MiniSearch({
        fields: ['uuid', 'type', 'subType', 'title'], // fields to index for full-text search
        storeFields: ['uuid', 'type', 'subType', 'title', 'lastSeen'], // fields to return with search results
        searchOptions: {
          boost: {
            type: 3,       // Boost type matches heavily
            subType: 2,    // Boost subType matches moderately
            title: 2,      // Boost title matches moderately
            uuid: 1        // Normal boost for UUID
          },
          fuzzy: 0.2,      // Enable fuzzy search with max edit distance of 20% of term length
          prefix: true,    // Enable prefix search (so 'get' matches 'get', 'GET', etc.)
          combineWith: 'AND' // Require all terms to match (can be changed to 'OR' for broader results)
        },
        // Custom tokenizer to handle types and UUIDs better
        tokenize: (string) => {
          // Split on common delimiters and normalize
          return string.toLowerCase()
            .split(/[\s\-_\.\/\#\?&=]+/)
            .filter(token => token.length > 0);
        },
        // Custom term processing
        processTerm: (term) => {
          // Remove very short terms and normalize
          if (term.length < 2) return null;
          return term.toLowerCase();
        }
      });

      this.rebuildSearchIndex();
    },
    rebuildSearchIndex() {
      if (!this.miniSearch || !this.entries.length) return;

      try {
        // Clear existing index
        this.miniSearch.removeAll();

        // Add all entries to the search index
        const searchDocuments = this.entries.map(entry => ({
          id: entry.uuid,
          uuid: entry.uuid,
          type: entry.type,
          subType: entry.subType,
          title: entry.title,
          lastSeen: entry.lastSeen
        }));

        this.miniSearch.addAll(searchDocuments);

        // Re-run search if there's an active search term
        if (this.logStore.searchTerm.trim()) {
          this.performSearch();
        }
      } catch (error) {
        console.error('Error rebuilding search index:', error);
      }
    },
    updateSearch(event) {
      const searchTerm = event.target.value;
      this.logStore.setSearchTerm(searchTerm);

      // Debounce search to avoid excessive re-indexing
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.performSearch();
      }, 150);
    },
    performSearch() {
      if (!this.miniSearch || !this.logStore.searchTerm.trim()) {
        this.searchResults = [];
        return;
      }

      try {
        this.searchResults = this.miniSearch.search(this.logStore.searchTerm.trim(), {
          // Override default options for specific searches if needed
          fuzzy: this.logStore.searchTerm.length > 3 ? 0.2 : false, // Only use fuzzy for longer terms
          boost: {
            type: 3,
            subType: 2,
            title: 2,
            uuid: 1
          }
        });
      } catch (error) {
        console.error('Search error:', error);
        this.searchResults = [];
      }
    },
    getEntryStatus(entry) {
      const timeDiff = new Date() - new Date(entry.lastSeen);
      return timeDiff < 30000 ? 'active' : 'completed';
    },
    formatTime(timestamp) {
      return new Date(timestamp).toLocaleTimeString();
    }
  },
  emits: ['select-entry']
}
</script>

<style scoped>
@reference "../style.css";

.entries-panel {
  @apply w-80 bg-slate-800 border-r border-slate-700 flex flex-col h-full font-mono text-slate-300;
}

.panel-header {
  @apply bg-slate-700 px-3 py-2 border-b border-slate-600 text-xs font-semibold text-slate-200 flex-shrink-0;
}

.filter-section {
  @apply px-3 py-2 border-b border-slate-600 bg-slate-700 flex-shrink-0;
}

.filter-input {
  @apply w-full bg-slate-600 border border-slate-500 text-slate-300 px-2 py-1 rounded text-xs font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-green-600;
}

.entries-list {
  @apply flex-1 overflow-y-auto h-0;
}

.entry-item {
  @apply flex items-center px-3 py-2 border-b border-slate-700 cursor-pointer transition-colors text-xs hover:bg-slate-700/60;
}

.entry-item.selected {
  @apply bg-sky-800 border-l-4 border-sky-500;
}

.entry-details {
  @apply flex-1 min-w-0;
}

.entry-title {
  @apply text-slate-200 font-semibold text-xs mb-1 whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1;
}

.entry-type {
  @apply inline-block px-1.5 py-0.5 rounded text-xs font-semibold min-w-10 text-center;
}

.type-web {
  @apply bg-blue-600 text-white;
}

.type-app {
  @apply bg-purple-600 text-white;
}

.type-worker {
  @apply bg-orange-600 text-white;
}

.type-unknown {
  @apply bg-slate-600 text-slate-300;
}

.entry-subtype {
  @apply inline-block px-1 py-0.5 rounded text-xs font-medium;
}

.subtype-GET {
  @apply bg-green-400 text-black;
}

.subtype-POST {
  @apply bg-yellow-400 text-black;
}

.subtype-PUT {
  @apply bg-blue-500 text-white;
}

.subtype-DELETE {
  @apply bg-red-500 text-white;
}

.subtype-PATCH {
  @apply bg-purple-500 text-white;
}

.subtype-RAILS {
  @apply bg-red-600 text-white;
}

.subtype-API {
  @apply bg-emerald-600 text-white;
}

.subtype-WEB {
  @apply bg-slate-500 text-white;
}

.subtype-sys {
  @apply bg-indigo-600 text-white;
}

.subtype-job {
  @apply bg-amber-600 text-black;
}

.subtype-log {
  @apply bg-slate-700 text-white;
}

.subtype-unknown {
  @apply bg-slate-800 text-slate-400;
}

.success-indicator {
  @apply inline-block px-1 py-0.5 rounded text-xs font-bold;
}

.success-indicator.success {
  @apply bg-green-600 text-white;
}

.success-indicator.failed {
  @apply bg-red-600 text-white;
}

.entry-title-text {
  @apply text-blue-300 text-xs font-normal mb-0.5 truncate;
}

.entry-uuid {
  @apply text-green-600 font-normal text-xs mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis opacity-70;
}

.entry-meta {
  @apply flex justify-between text-green-600 text-xs;
}

.entry-count {
  @apply text-orange-300 font-medium;
}

.entry-metadata {
  @apply flex gap-1 mt-1 flex-wrap;
}

.metadata-item {
  @apply bg-slate-600 text-slate-200 px-1 py-0.5 rounded text-xs;
}

.empty-state {
  @apply flex flex-col items-center justify-center h-full text-green-600 text-sm;
}

.empty-icon {
  @apply text-5xl mb-4 opacity-50;
}

/* Custom scrollbar for webkit browsers */
.entries-list::-webkit-scrollbar {
  @apply w-2;
}

.entries-list::-webkit-scrollbar-track {
  @apply bg-slate-900;
}

.entries-list::-webkit-scrollbar-thumb {
  @apply bg-slate-600 rounded;
}

.entries-list::-webkit-scrollbar-thumb:hover {
  @apply bg-slate-500;
}
</style>