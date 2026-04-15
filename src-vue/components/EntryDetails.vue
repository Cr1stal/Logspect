<template>
  <div class="details-panel">
    <div class="details-header">
      <div class="details-header-copy">
        <div class="details-title">{{ entryTitle }}</div>
        <div class="details-id">{{ selectedUuid || 'Select an entry' }}</div>
      </div>

      <div v-if="selectedEntry" class="details-view-switcher">
        <button
          v-for="view in detailViews"
          :key="view.value"
          type="button"
          :class="['details-view-btn', { 'active': activeView === view.value }]"
          @click="activeView = view.value"
        >
          {{ view.label }}
        </button>
      </div>
    </div>

    <div class="details-content" ref="detailsContent">
      <div v-if="!selectedUuid" class="empty-state">
        <div class="empty-icon">
          <ClipboardList :size="48" class="opacity-50" />
        </div>
        <div>Select an entry from the left panel to view its logs</div>
      </div>

      <div v-else-if="selectedEntry">
        <div v-if="activeView !== 'raw'" class="timeline-view">
          <div
            v-for="item in timelineItems"
            :key="item.key"
          >
            <div v-if="item.kind === 'gap'" class="timeline-gap">
              <div class="timeline-gap-count">
                {{ item.hiddenCount }} more {{ item.hiddenCount === 1 ? 'line' : 'lines' }}
              </div>
              <div class="timeline-gap-rule" />
            </div>

            <div
              v-else
              :class="timelineEntryClasses(item.entry)"
            >
              <div class="timeline-gutter">
                <div class="timeline-line-number">{{ entryLineLabel(item.entry, item.index) }}</div>
                <div class="timeline-marker" />
              </div>

              <div class="timeline-main">
                <div class="timeline-meta">
                  <span class="timeline-entry-kind">{{ entryKindLabel(item.entry) }}</span>
                  <span v-if="item.entry.isMatch" class="timeline-match-badge">Match</span>
                  <span v-if="item.entry.lineNumber" class="timeline-entry-position">
                    Line {{ item.entry.lineNumber }}
                  </span>
                  <span v-else class="timeline-entry-position">
                    {{ formatTime(item.entry.timestamp) }}
                  </span>
                  <button
                    type="button"
                    class="timeline-copy-btn"
                    :title="copyLabel(item.entry, item.index)"
                    @click="copyToClipboard(item.entry.content, entryKey(item.entry, item.index))"
                  >
                    <Copy :size="12" />
                    {{ copyLabel(item.entry, item.index) }}
                  </button>
                </div>

                <div class="timeline-content">{{ item.entry.content }}</div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="raw-view">
          <div
            v-for="(entry, index) in sortedEntries"
            :key="entryKey(entry, index)"
            class="raw-entry"
          >
            <div class="raw-entry-header">
              <span class="raw-entry-line">{{ entryMeta(entry, index) }}</span>
              <button
                type="button"
                class="raw-copy-btn"
                :title="copyLabel(entry, index)"
                @click="copyToClipboard(entry.content, entryKey(entry, index))"
              >
                <Copy :size="12" />
                {{ copyLabel(entry, index) }}
              </button>
            </div>
            <pre class="raw-content">{{ entry.content }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ClipboardList, Copy } from 'lucide-vue-next'

export default {
  name: 'EntryDetails',
  components: {
    ClipboardList,
    Copy
  },
  data() {
    return {
      activeView: 'readable',
      copiedEntryKey: null
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
    hasSearchContext() {
      return this.sortedEntries.some(entry => entry.isMatch)
    },
    detailViews() {
      const views = [
        { label: 'Readable', value: 'readable' }
      ]

      if (this.hasSearchContext) {
        views.push({ label: 'Search Context', value: 'search' })
      }

      views.push({ label: 'Raw', value: 'raw' })

      return views
    },
    sortedEntries() {
      if (!this.selectedEntry || !this.selectedEntry.entries) return [];
      const hasLineNumbers = this.selectedEntry.entries.length > 0 &&
        this.selectedEntry.entries.every(entry => typeof entry.lineNumber === 'number')

      if ((this.selectedEntry.searchMeta?.isDiskSearchResult || this.selectedEntry.indexMeta?.isIndexedViewResult) && hasLineNumbers) {
        return [...this.selectedEntry.entries].sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0));
      }

      // Return entries sorted in ascending order (oldest first)
      return [...this.selectedEntry.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    },
    timelineItems() {
      if (this.activeView !== 'search' || !this.hasSearchContext) {
        return this.sortedEntries.map((entry, index) => ({
          kind: 'entry',
          key: this.entryKey(entry, index),
          entry,
          index
        }))
      }

      const includedIndexes = new Set()

      this.sortedEntries.forEach((entry, index) => {
        if (!entry.isMatch) {
          return
        }

        includedIndexes.add(index)
        if (index > 0) {
          includedIndexes.add(index - 1)
        }
        if (index < this.sortedEntries.length - 1) {
          includedIndexes.add(index + 1)
        }
      })

      const sortedIndexes = Array.from(includedIndexes).sort((left, right) => left - right)
      const items = []
      let previousIndex = null

      sortedIndexes.forEach((index) => {
        if (previousIndex !== null && index > previousIndex + 1) {
          items.push({
            kind: 'gap',
            key: `gap-${previousIndex}-${index}`,
            hiddenCount: index - previousIndex - 1
          })
        }

        items.push({
          kind: 'entry',
          key: this.entryKey(this.sortedEntries[index], index),
          entry: this.sortedEntries[index],
          index
        })

        previousIndex = index
      })

      return items
    }
  },
  watch: {
    selectedEntry: {
      handler() {
        this.copiedEntryKey = null
        if (!this.detailViews.some(view => view.value === this.activeView)) {
          this.activeView = 'readable'
        }
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
    formatTime(timestamp) {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    },
    scrollToTop() {
      if (this.$refs.detailsContent) {
        this.$refs.detailsContent.scrollTop = 0;
      }
    },
    entryKey(entry, index) {
      return `${entry.lineNumber || entry.timestamp || 'entry'}-${index}`;
    },
    entryMeta(entry, index) {
      if (entry.lineNumber) {
        return `Line ${entry.lineNumber}`;
      }

      return `Row ${index + 1} • ${this.formatDateTime(entry.timestamp)}`;
    },
    entryLineLabel(entry, index) {
      return entry.lineNumber || index + 1;
    },
    timelineEntryClasses(entry) {
      return [
        'timeline-entry',
        `timeline-entry--${this.entryTone(entry)}`,
        {
          'timeline-entry--matched': entry.isMatch,
          'timeline-entry--context': this.activeView === 'search' && !entry.isMatch
        }
      ]
    },
    entryTone(entry) {
      const content = entry.content.toLowerCase();

      if (content.includes('fatal') || content.includes('error')) {
        return 'error';
      }

      if (content.includes('warn')) {
        return 'warn';
      }

      if (content.startsWith('started ') || content.includes('info: start')) {
        return 'start';
      }

      if (content.startsWith('completed ') || content.includes('info: done')) {
        return 'complete';
      }

      if (/\b(select|insert|update|delete)\b/i.test(entry.content)) {
        return 'sql';
      }

      if (content.includes('debug')) {
        return 'debug';
      }

      return 'default';
    },
    entryKindLabel(entry) {
      const tone = this.entryTone(entry);

      switch (tone) {
        case 'error':
          return 'Issue';
        case 'warn':
          return 'Warning';
        case 'start':
          return 'Start';
        case 'complete':
          return 'Completion';
        case 'sql':
          return 'SQL';
        case 'debug':
          return 'Debug';
        default:
          return 'Log line';
      }
    },
    copyLabel(entry, index) {
      return this.copiedEntryKey === this.entryKey(entry, index) ? 'Copied' : 'Copy';
    },
    async copyToClipboard(text, entryKey) {
      await navigator.clipboard.writeText(text);
      this.copiedEntryKey = entryKey;
      setTimeout(() => {
        this.clearCopyText();
      }, 2000);
    },
    clearCopyText() {
      this.copiedEntryKey = null;
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
  @apply bg-slate-800 px-4 py-3 border-b border-slate-700 flex justify-between items-center gap-4 flex-shrink-0;
}

.details-header-copy {
  @apply min-w-0 flex-1;
}

.details-title {
  @apply text-xs font-semibold text-slate-100;
}

.details-id {
  @apply inline-flex max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-blue-300 text-xs bg-slate-600 px-1.5 py-0.5 rounded mt-1;
}

.details-view-switcher {
  @apply flex items-center gap-1 flex-shrink-0;
}

.details-view-btn {
  @apply bg-slate-700 border border-slate-600 text-slate-300 px-2.5 py-1 rounded text-xs transition-colors hover:bg-slate-600;
}

.details-view-btn.active {
  @apply bg-sky-600 border-sky-500 text-white;
}

.details-content {
  @apply flex-1 overflow-y-auto px-4 py-3 h-0;
}

.timeline-view {
  @apply flex flex-col gap-3;
}

.timeline-entry {
  @apply grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 items-start rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3;
}

.timeline-gap {
  @apply grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 items-center px-3;
}

.timeline-gap-count {
  @apply text-[10px] text-slate-500 text-center;
}

.timeline-gap-rule {
  @apply h-px bg-slate-800;
}

.timeline-gutter {
  @apply flex flex-col items-center gap-2 pt-0.5;
}

.timeline-line-number {
  @apply text-[10px] text-slate-500 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 min-w-12 text-center;
}

.timeline-marker {
  @apply h-full w-px min-h-8 bg-slate-700;
}

.timeline-main {
  @apply min-w-0;
}

.timeline-meta {
  @apply flex flex-wrap items-center gap-2 mb-2;
}

.timeline-entry-kind {
  @apply text-[10px] uppercase tracking-wide text-slate-200 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5;
}

.timeline-entry-position {
  @apply text-[10px] text-slate-400;
}

.timeline-copy-btn {
  @apply ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors;
}

.timeline-match-badge {
  @apply text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-amber-400/40 bg-amber-300/10 text-amber-200;
}

.timeline-content {
  @apply text-xs leading-6 text-slate-100 whitespace-pre-wrap break-normal overflow-x-auto;
}

.timeline-entry--default {
  @apply border-slate-800;
}

.timeline-entry--default .timeline-marker {
  @apply bg-slate-700;
}

.timeline-entry--start {
  @apply border-emerald-900/70 bg-emerald-950/20;
}

.timeline-entry--start .timeline-marker,
.timeline-entry--start .timeline-entry-kind {
  @apply bg-emerald-500/80 border-emerald-400/80 text-emerald-50;
}

.timeline-entry--complete {
  @apply border-sky-900/70 bg-sky-950/20;
}

.timeline-entry--complete .timeline-marker,
.timeline-entry--complete .timeline-entry-kind {
  @apply bg-sky-500/80 border-sky-400/80 text-sky-50;
}

.timeline-entry--warn {
  @apply border-amber-900/70 bg-amber-950/20;
}

.timeline-entry--warn .timeline-marker,
.timeline-entry--warn .timeline-entry-kind {
  @apply bg-amber-500/80 border-amber-400/80 text-amber-950;
}

.timeline-entry--error {
  @apply border-rose-900/70 bg-rose-950/20;
}

.timeline-entry--error .timeline-marker,
.timeline-entry--error .timeline-entry-kind {
  @apply bg-rose-500/80 border-rose-400/80 text-rose-50;
}

.timeline-entry--debug {
  @apply border-violet-900/70 bg-violet-950/20;
}

.timeline-entry--debug .timeline-marker,
.timeline-entry--debug .timeline-entry-kind {
  @apply bg-violet-500/80 border-violet-400/80 text-violet-50;
}

.timeline-entry--sql {
  @apply border-cyan-900/70 bg-cyan-950/20;
}

.timeline-entry--sql .timeline-marker,
.timeline-entry--sql .timeline-entry-kind {
  @apply bg-cyan-500/80 border-cyan-400/80 text-cyan-950;
}

.timeline-entry--matched {
  @apply ring-1 ring-amber-400/40;
}

.timeline-entry--matched .timeline-line-number {
  @apply text-amber-200 border-amber-500/40 bg-amber-950/40;
}

.timeline-entry--context {
  @apply opacity-75;
}

.raw-view {
  @apply flex flex-col gap-3;
}

.raw-entry {
  @apply rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3;
}

.raw-entry-header {
  @apply flex items-center justify-between gap-2 mb-2;
}

.raw-entry-line {
  @apply text-[10px] text-slate-400;
}

.raw-copy-btn {
  @apply inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors;
}

.raw-content {
  @apply text-xs leading-6 text-slate-100 whitespace-pre-wrap break-normal overflow-x-auto;
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
