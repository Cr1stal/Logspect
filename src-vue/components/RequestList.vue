<template>
  <div class="requests-panel">
    <div class="panel-header">
      Requests ({{ displayedRequests.length }})
    </div>

    <div class="filter-section">
      <input
        type="text"
        class="filter-input"
        placeholder="Search requests... (supports fuzzy search)"
        :value="logStore.searchTerm"
        @input="updateSearch"
      >
    </div>

    <div class="requests-list">
      <div v-if="totalRequests === 0" class="empty-state">
        <div class="empty-icon">📄</div>
        <div>No requests detected yet</div>
      </div>

      <div
        v-for="request in displayedRequests"
        :key="request.requestId"
        :class="['request-item', { 'selected': selectedRequestId === request.requestId }]"
        @click="$emit('select-request', request.requestId)"
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
</template>

<script>
import MiniSearch from 'minisearch'
import { useLogStore } from '../stores/logStore.js'

export default {
  name: 'RequestList',
  props: {
    requests: {
      type: Array,
      default: () => []
    },
    totalRequests: {
      type: Number,
      default: 0
    },
    selectedRequestId: {
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
    displayedRequests() {
      const searchTerm = this.logStore.searchTerm.trim();

      if (!searchTerm) {
        // If no search term, return all requests sorted by last seen
        return [...this.requests].sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
      }

      if (!this.miniSearch || this.searchResults.length === 0) {
        // Use store's simple search fallback
        this.logStore.updateFilteredRequests();
        return this.logStore.filteredRequests;
      }

      // Return MiniSearch results with relevance scoring
      return this.searchResults.map(result => {
        const request = this.requests.find(req => req.requestId === result.id);
        return { ...request, searchScore: result.score };
      }).filter(Boolean);
    }
  },
  watch: {
    requests: {
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
        fields: ['requestId', 'method', 'path', 'title'], // fields to index for full-text search
        storeFields: ['requestId', 'method', 'path', 'title', 'lastSeen'], // fields to return with search results
        searchOptions: {
          boost: {
            method: 3,     // Boost method matches heavily
            path: 2,       // Boost path matches moderately
            title: 2,      // Boost title matches moderately
            requestId: 1   // Normal boost for request ID
          },
          fuzzy: 0.2,      // Enable fuzzy search with max edit distance of 20% of term length
          prefix: true,    // Enable prefix search (so 'get' matches 'get', 'GET', etc.)
          combineWith: 'AND' // Require all terms to match (can be changed to 'OR' for broader results)
        },
        // Custom tokenizer to handle HTTP methods and paths better
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
      if (!this.miniSearch || !this.requests.length) return;

      try {
        // Clear existing index
        this.miniSearch.removeAll();

        // Add all requests to the search index
        const searchDocuments = this.requests.map(request => ({
          id: request.requestId,
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          title: request.title,
          lastSeen: request.lastSeen
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
            method: 3,
            path: 2,
            title: 2,
            requestId: 1
          }
        });
      } catch (error) {
        console.error('Search error:', error);
        this.searchResults = [];
      }
    },
    getRequestStatus(request) {
      const timeDiff = new Date() - new Date(request.lastSeen);
      return timeDiff < 30000 ? 'active' : 'completed';
    },
    formatTime(timestamp) {
      return new Date(timestamp).toLocaleTimeString();
    }
  },
  emits: ['select-request']
}
</script>

<style scoped>
@reference "../style.css";

.requests-panel {
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

.requests-list {
  @apply flex-1 overflow-y-auto h-0;
}

.request-item {
  @apply flex items-center px-3 py-2 border-b border-slate-700 cursor-pointer transition-colors text-xs hover:bg-slate-700/60;
}

.request-item.selected {
  @apply bg-sky-800 border-l-4 border-sky-500;
}

.request-status {
  @apply w-2 h-2 rounded-full mr-2 flex-shrink-0;
}

.request-status.active {
  @apply bg-green-400;
}

.request-status.completed {
  @apply bg-slate-500;
}

.request-details {
  @apply flex-1 min-w-0;
}

.request-title {
  @apply text-slate-200 font-semibold text-xs mb-1 whitespace-nowrap overflow-hidden text-ellipsis;
}

.request-method {
  @apply inline-block px-1.5 py-0.5 rounded text-xs font-semibold mr-1.5 min-w-10 text-center;
}

.method-GET {
  @apply bg-green-400 text-black;
}

.method-POST {
  @apply bg-yellow-400 text-black;
}

.method-PUT {
  @apply bg-blue-500 text-white;
}

.method-DELETE {
  @apply bg-red-500 text-white;
}

.method-PATCH {
  @apply bg-purple-500 text-white;
}

.method-RAILS {
  @apply bg-red-600 text-white;
}

.method-API {
  @apply bg-emerald-600 text-white;
}

.method-WEB {
  @apply bg-slate-500 text-white;
}

.method-LOG {
  @apply bg-slate-700 text-white;
}

.method-UNKNOWN {
  @apply bg-slate-800 text-slate-400;
}

.request-path {
  @apply text-blue-300 text-xs font-normal;
}

.request-id {
  @apply text-green-600 font-normal text-xs mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis opacity-70;
}

.request-meta {
  @apply flex justify-between text-green-600 text-xs;
}

.entry-count {
  @apply text-orange-300 font-medium;
}

.empty-state {
  @apply flex flex-col items-center justify-center h-full text-green-600 text-sm;
}

.empty-icon {
  @apply text-5xl mb-4 opacity-50;
}

/* Custom scrollbar for webkit browsers */
.requests-list::-webkit-scrollbar {
  @apply w-2;
}

.requests-list::-webkit-scrollbar-track {
  @apply bg-slate-900;
}

.requests-list::-webkit-scrollbar-thumb {
  @apply bg-slate-600 rounded;
}

.requests-list::-webkit-scrollbar-thumb:hover {
  @apply bg-slate-500;
}
</style>