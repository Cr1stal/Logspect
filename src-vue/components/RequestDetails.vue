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
@reference "../style.css";

.details-panel {
  @apply flex-1 bg-slate-900 flex flex-col h-full font-mono text-slate-300;
}

.details-header {
  @apply bg-slate-800 px-4 py-3 border-b border-slate-700 flex justify-between items-center flex-shrink-0;
}

.details-title {
  @apply text-xs font-semibold text-slate-200;
}

.details-id {
  @apply font-mono text-blue-300 text-xs bg-slate-600 px-1.5 py-0.5 rounded;
}

.details-content {
  @apply flex-1 overflow-y-auto p-4 h-0;
}

.log-entry {
  @apply mb-3 p-3 bg-neutral-800 rounded border-l-4 border-sky-500 text-xs leading-normal;
}

.log-entry:last-child {
  @apply border-l-green-400 bg-green-900 opacity-20;
}

.log-content {
  @apply text-slate-300 whitespace-pre-wrap break-all mb-1.5;
}

.log-timestamp {
  @apply text-green-600 text-xs text-right;
}

.empty-state {
  @apply flex flex-col items-center justify-center h-full text-green-600 text-sm;
}

.empty-icon {
  @apply text-5xl mb-4 opacity-50;
}

/* Custom scrollbar for webkit browsers */
.details-content::-webkit-scrollbar {
  @apply w-2;
}

.details-content::-webkit-scrollbar-track {
  @apply bg-slate-900;
}

.details-content::-webkit-scrollbar-thumb {
  @apply bg-slate-600 rounded;
}

.details-content::-webkit-scrollbar-thumb:hover {
  @apply bg-slate-500;
}
</style>