<template>
  <div class="details-panel">
    <div class="details-header">
      <div class="details-title">{{ entryTitle }}</div>
      <div class="details-id">{{ selectedUuid || 'Select an entry' }}</div>
    </div>

    <div class="details-content" ref="detailsContent">
      <div v-if="!selectedUuid" class="empty-state">
        <div class="empty-icon">
          <ClipboardList :size="48" class="opacity-50" />
        </div>
        <div>Select an entry from the left panel to view its logs</div>
      </div>

      <div v-else-if="selectedEntry">
        <div
          v-for="(entry, index) in sortedEntries"
          :key="index"
          class="log-entry group"
          @click="copyToClipboard(entry.content)"
          @mouseleave="clearCopyText"
        >
          <div class="log-content">{{ entry.content }}</div>
          <div class="group-hover:opacity-100 opacity-0 text-xs text-green-300 log-timestamp">{{ copyText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ClipboardList } from 'lucide-vue-next'

export default {
  name: 'EntryDetails',
  components: {
    ClipboardList
  },
  data() {
    return {
      copyText: 'click to copy'
    }
  },
  props: {
    selectedUuid: {
      type: String,
      default: null
    },
    selectedEntry: {
      type: Object,
      default: null
    },
    autoScroll: {
      type: Boolean,
      default: true
    }
  },
  computed: {
    entryTitle() {
      if (!this.selectedEntry) return 'Entry Details';
      return this.selectedEntry.title || `${this.selectedEntry.type}/${this.selectedEntry.subType}`;
    },
    sortedEntries() {
      if (!this.selectedEntry || !this.selectedEntry.entries) return [];
      // Return entries sorted in ascending order (oldest first)
      return [...this.selectedEntry.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
  },
  watch: {
    selectedEntry: {
      handler() {
        if (this.autoScroll) {
          this.$nextTick(() => {
            this.scrollToTop();
          });
        }
      }
    }
  },
  methods: {
    formatDateTime(timestamp) {
      return new Date(timestamp).toLocaleString();
    },
    scrollToTop() {
      if (this.$refs.detailsContent) {
        this.$refs.detailsContent.scrollTop = 0;
      }
    },
    copyToClipboard(text) {
      navigator.clipboard.writeText(text);
      this.copyText = 'copied';
      setTimeout(() => {
        this.clearCopyText();
      }, 2000);
    },
    clearCopyText() {
      this.copyText = 'click to copy';
    }
  }
}
</script>

<style scoped>
@reference "../style.css";

.details-panel {
  @apply flex-1 bg-slate-900 flex flex-col h-full font-mono text-white;
}

.details-header {
  @apply bg-slate-800 px-4 py-3 border-b border-slate-700 flex justify-between items-center flex-shrink-0;
}

.details-title {
  @apply text-xs font-semibold text-slate-100;
}

.details-id {
  @apply font-mono text-blue-300 text-xs bg-slate-600 px-1.5 py-0.5 rounded;
}

.details-content {
  @apply flex-1 overflow-y-auto p-4 h-0;
}

.log-entry {
  @apply mb-2 px-2 py-1 text-xs leading-normal hover:bg-slate-700 rounded;
}

/* .log-entry:last-child {
  @apply border-l-green-400 bg-green-900 opacity-20;
} */

.log-content {
  @apply text-white whitespace-pre-wrap break-all mb-1.5;
}

.log-timestamp {
  @apply text-green-600 text-xs text-right;
}

.empty-state {
  @apply flex flex-col items-center justify-center h-full text-green-600 text-sm;
}

.empty-icon {
  @apply mb-4 flex justify-center;
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