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
.requests-panel {
  width: 350px;
  background: #252526;
  border-right: 1px solid #3e3e42;
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', monospace;
  color: #d4d4d4;
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
.requests-list::-webkit-scrollbar {
  width: 8px;
}

.requests-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.requests-list::-webkit-scrollbar-thumb {
  background: #3c3c3c;
  border-radius: 4px;
}

.requests-list::-webkit-scrollbar-thumb:hover {
  background: #4a4a4a;
}
</style>