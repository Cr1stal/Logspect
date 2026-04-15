<template>
  <div class="entries-panel">
    <div class="panel-header">
      {{ listLabel }} ({{ displayedEntries.length }})
    </div>

    <div class="entries-list">
      <div v-if="displayedEntries.length === 0" class="empty-state">
        <div class="empty-icon">
          <FileText :size="48" class="opacity-50" />
        </div>
        <div>{{ emptyMessage }}</div>
      </div>

      <div
        v-for="entry in displayedEntries"
        :key="entry.uuid"
        :class="['entry-item', { 'selected': selectedUuid === entry.uuid }]"
        @click="$emit('select-entry', entry.uuid)"
      >
        <div class="entry-details">
          <div class="entry-title">
            <span :class="['entry-subtype', `subtype-${entry.subType}`]">{{ entry.subType }}</span>
          </div>
          <div class="entry-title-text">{{ entry.title }}</div>
          <div class="entry-uuid">{{ entry.uuid }}</div>
          <div class="entry-meta">
            <span class="entry-count">{{ formatEntryCount(entry) }}</span>
            <span>{{ formatEntryPosition(entry) }}</span>
          </div>
          <div v-if="Object.keys(entry.metadata || {}).length > 0" class="entry-metadata">
            <span v-if="entry.metadata.responseTime" class="metadata-item">
              {{ entry.metadata.responseTime }}ms
            </span>
            <span v-if="entry.metadata.statusCode" class="metadata-item">
              {{ entry.metadata.statusCode }}
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
import { FileText } from 'lucide-vue-next'

export default {
  name: 'EntryList',
  components: {
    FileText
  },
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
    },
    searchTerm: {
      type: String,
      default: ''
    },
    invertOrder: {
      type: Boolean,
      default: false
    },
    activeCategories: {
      type: Array,
      default: () => ['all']
    },
    searchMode: {
      type: String,
      default: 'local'
    },
    emptyMessage: {
      type: String,
      default: 'No log entries detected yet'
    },
    listLabel: {
      type: String,
      default: 'Entries'
    }
  },
  data() {
    return {
      miniSearch: null,
      searchResults: []
    }
  },
  computed: {
    displayedEntries() {
      let filteredEntries = this.entries;

      // Apply category filter
      if (!this.activeCategories.includes('all')) {
        filteredEntries = filteredEntries.filter(entry =>
          this.activeCategories.includes(entry.type)
        );
      }

      // Apply search filter
      const searchTerm = this.searchTerm.trim();
      if (this.searchMode === 'local' && searchTerm) {
        if (this.miniSearch && this.searchResults.length > 0) {
          // Use MiniSearch results
          const searchResultUuids = new Set(this.searchResults.map(result => result.id));
          filteredEntries = filteredEntries.filter(entry => searchResultUuids.has(entry.uuid));
        } else {
          // Fallback simple search
          filteredEntries = filteredEntries.filter(entry =>
            entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            entry.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
            entry.subType.toLowerCase().includes(searchTerm.toLowerCase()) ||
            entry.uuid.toLowerCase().includes(searchTerm.toLowerCase())
          );
        }
      }

      // Apply sorting
      const sorted = [...filteredEntries].sort((a, b) => {
        if (a.searchMeta?.isDiskSearchResult || b.searchMeta?.isDiskSearchResult) {
          const lineA = a.searchMeta?.firstLineNumber || 0
          const lineB = b.searchMeta?.firstLineNumber || 0
          return this.invertOrder ? lineB - lineA : lineA - lineB
        }

        const dateA = new Date(a.firstSeen);
        const dateB = new Date(b.firstSeen);
        return this.invertOrder ? dateB - dateA : dateA - dateB;
      });

      return sorted;
    }
  },
  watch: {
    entries: {
      handler() {
        if (this.searchMode === 'local') {
          this.rebuildSearchIndex()
        } else {
          this.searchResults = []
        }
      },
      deep: true
    },
    searchTerm: {
      handler() {
        if (this.searchMode === 'local') {
          this.performSearch()
        } else {
          this.searchResults = []
        }
      }
    },
    searchMode(nextMode) {
      if (nextMode === 'local') {
        this.initializeSearch()
      } else {
        this.searchResults = []
      }
    }
  },
  mounted() {
    if (this.searchMode === 'local') {
      this.initializeSearch();
    }
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
      if (this.searchMode !== 'local' || !this.miniSearch || !this.entries.length) return;

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
        if (this.searchTerm.trim()) {
          this.performSearch();
        }
      } catch (error) {
        console.error('Error rebuilding search index:', error);
      }
    },
    performSearch() {
      if (this.searchMode !== 'local' || !this.miniSearch || !this.searchTerm.trim()) {
        this.searchResults = [];
        return;
      }

      try {
        this.searchResults = this.miniSearch.search(this.searchTerm.trim(), {
          // Override default options for specific searches if needed
          fuzzy: this.searchTerm.length > 3 ? 0.2 : false, // Only use fuzzy for longer terms
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
    },
    formatEntryCount(entry) {
      const label = entry.searchMeta?.isDiskSearchResult ? 'matches' : 'entries'
      return `${entry.entriesCount} ${label}`
    },
    formatEntryPosition(entry) {
      if (entry.searchMeta?.isDiskSearchResult) {
        const { firstLineNumber, lastLineNumber } = entry.searchMeta
        return firstLineNumber === lastLineNumber
          ? `Line ${firstLineNumber}`
          : `Lines ${firstLineNumber}-${lastLineNumber}`
      }

      return this.formatTime(entry.lastSeen)
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

.entries-list {
  @apply flex-1 overflow-y-auto h-0;
}

.entry-item {
  @apply flex items-center px-4 py-3 border-b border-slate-700 cursor-pointer transition-colors text-xs hover:bg-slate-700/60;
}

.entry-item.selected {
  @apply bg-sky-800 border-l-4 border-sky-500;
}

.entry-details {
  @apply flex-1 min-w-0 space-y-1;
}

.entry-title {
  @apply text-slate-200 font-semibold text-xs mb-2 whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1;
}

.entry-subtype {
  @apply inline-block px-2 py-1 rounded text-xs font-medium;
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

.entry-title-text {
  @apply text-blue-300 text-xs font-normal mb-1 truncate;
}

.entry-uuid {
  @apply text-green-600 font-normal text-xs mb-1 whitespace-nowrap overflow-hidden text-ellipsis opacity-70;
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
  @apply mb-4 flex justify-center;
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
