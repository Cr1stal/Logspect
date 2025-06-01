<template>
  <div class="details-panel">
    <div class="details-header">
      <div class="details-title">{{ requestTitle }}</div>
      <div class="details-id">{{ selectedRequestId || 'Select a request' }}</div>
    </div>

    <div class="details-content" ref="detailsContent">
      <div v-if="!selectedRequestId" class="empty-state">
        <div class="empty-icon">📋</div>
        <div>Select a request from the left panel to view its logs</div>
      </div>

      <div v-else-if="selectedRequest">
        <div
          v-for="(entry, index) in sortedEntries"
          :key="index"
          class="log-entry"
        >
          <div class="log-content">{{ entry.content }}</div>
          <div class="log-timestamp">{{ formatDateTime(entry.timestamp) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'RequestDetails',
  props: {
    selectedRequestId: {
      type: String,
      default: null
    },
    selectedRequest: {
      type: Object,
      default: null
    },
    autoScroll: {
      type: Boolean,
      default: true
    }
  },
  computed: {
    requestTitle() {
      if (!this.selectedRequest) return 'Request Details';
      return this.selectedRequest.title || `${this.selectedRequest.method} ${this.selectedRequest.path}`;
    },
    sortedEntries() {
      if (!this.selectedRequest || !this.selectedRequest.entries) return [];
      // Return entries sorted in ascending order (oldest first)
      return [...this.selectedRequest.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
  },
  watch: {
    selectedRequest: {
      handler() {
        // if (this.autoScroll) {
        //   this.$nextTick(() => {
        //     this.scrollToBottom();
        //   });
        // }
      }
    }
  },
  methods: {
    formatDateTime(timestamp) {
      return new Date(timestamp).toLocaleString();
    },
    scrollToBottom() {
      if (this.$refs.detailsContent) {
        this.$refs.detailsContent.scrollTop = this.$refs.detailsContent.scrollHeight;
      }
    }
  }
}
</script>

<style scoped>
.details-panel {
  flex: 1;
  background: #1e1e1e;
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', monospace;
  color: #d4d4d4;
}

.details-header {
  background: #2d2d30;
  padding: 12px 16px;
  border-bottom: 1px solid #3e3e42;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.details-title {
  font-size: 13px;
  font-weight: 600;
  color: #cccccc;
}

.details-id {
  font-family: 'SF Mono', monospace;
  color: #9cdcfe;
  font-size: 11px;
  background: #3c3c3c;
  padding: 2px 6px;
  border-radius: 3px;
}

.details-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  height: 0;
}

.log-entry {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #262626;
  border-radius: 4px;
  border-left: 3px solid #007acc;
  font-size: 12px;
  line-height: 1.4;
}

.log-entry:last-child {
  border-left-color: #4ade80;
  background: #1a2e1a;
}

.log-content {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
  margin-bottom: 6px;
}

.log-timestamp {
  color: #6a9955;
  font-size: 10px;
  text-align: right;
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
.details-content::-webkit-scrollbar {
  width: 8px;
}

.details-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.details-content::-webkit-scrollbar-thumb {
  background: #3c3c3c;
  border-radius: 4px;
}

.details-content::-webkit-scrollbar-thumb:hover {
  background: #4a4a4a;
}
</style>