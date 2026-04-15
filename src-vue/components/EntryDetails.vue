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
              v-else-if="item.kind === 'stack-block'"
              :class="['timeline-entry', 'timeline-entry--stack-block', { 'timeline-entry--expanded': isStackBlockExpanded(item) }]"
            >
              <div class="timeline-gutter">
                <div class="timeline-line-number">{{ item.entries.length }} lines</div>
                <div class="timeline-marker" />
              </div>

              <div class="timeline-main">
                <div class="timeline-meta">
                  <span class="timeline-entry-kind">Stack Trace</span>
                  <span class="timeline-entry-position">{{ lineRangeLabel(item) }}</span>
                  <button
                    type="button"
                    class="timeline-toggle-btn"
                    @click="toggleStackBlock(item)"
                  >
                    {{ isStackBlockExpanded(item) ? 'Hide stack trace' : 'Show stack trace' }}
                  </button>
                  <button
                    type="button"
                    class="timeline-copy-btn"
                    :title="copyLabelForKey(item.key)"
                    @click="copyToClipboard(stackBlockText(item), item.key)"
                  >
                    <Copy :size="12" />
                    {{ copyLabelForKey(item.key) }}
                  </button>
                </div>

                <div v-if="isStackBlockExpanded(item)" class="stack-block-content">
                  <div
                    v-for="stackEntry in item.entries"
                    :key="stackEntry.key"
                    class="stack-block-line"
                  >
                    <span class="stack-block-line-number">
                      {{ entryLineLabel(stackEntry.entry, stackEntry.index) }}
                    </span>
                    <pre class="timeline-content-text">{{ stackEntry.entry.content }}</pre>
                  </div>
                </div>
                <div v-else class="stack-block-preview">
                  {{ stackBlockPreview(item) }}
                </div>
              </div>
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

                <div class="timeline-content">
                  <pre
                    v-if="isPayloadCollapsed(item.entry, item.index)"
                    class="timeline-content-text timeline-content-text--collapsed"
                  >{{ payloadPreview(item.entry) }}</pre>
                  <pre
                    v-else
                    class="timeline-content-text"
                  >{{ item.entry.content }}</pre>

                  <button
                    v-if="isPayloadExpandable(item.entry)"
                    type="button"
                    class="timeline-toggle-btn"
                    @click="togglePayload(item.entry, item.index)"
                  >
                    {{ isPayloadCollapsed(item.entry, item.index) ? 'Show payload' : 'Hide payload' }}
                  </button>
                </div>
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
import {
  entryKindLabelForContent,
  entryToneForContent,
  isPayloadLikeContent
} from './entryDetailsPresentation.js'

const STACK_TRACE_COLLAPSE_MIN_LINES = 4
const PAYLOAD_COLLAPSE_MIN_LENGTH = 220
const PAYLOAD_PREVIEW_LENGTH = 180

export default {
  name: 'EntryDetails',
  components: {
    ClipboardList,
    Copy
  },
  data() {
    return {
      activeView: 'readable',
      copiedEntryKey: null,
      expandedPayloadEntries: {},
      expandedStackBlocks: {}
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
      const baseItems = this.activeView !== 'search' || !this.hasSearchContext
        ? this.sortedEntries.map((entry, index) => ({
            kind: 'entry',
            key: this.entryKey(entry, index),
            entry,
            index
          }))
        : this.buildSearchContextItems()

      if (this.activeView !== 'readable') {
        return baseItems
      }

      return this.collapseStackTraceRuns(baseItems)
    }
  },
  watch: {
    selectedEntry: {
      handler() {
        this.copiedEntryKey = null
        this.expandedPayloadEntries = {}
        this.expandedStackBlocks = {}
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
    buildSearchContextItems() {
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
    },
    collapseStackTraceRuns(items) {
      const collapsedItems = []

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]

        if (item.kind !== 'entry' || !this.isStackTraceEntry(item.entry)) {
          collapsedItems.push(item)
          continue
        }

        const run = [item]
        let runIndex = index + 1

        while (runIndex < items.length) {
          const candidate = items[runIndex]
          if (candidate.kind !== 'entry' || !this.isStackTraceEntry(candidate.entry)) {
            break
          }

          run.push(candidate)
          runIndex += 1
        }

        if (run.length < STACK_TRACE_COLLAPSE_MIN_LINES || run.some(candidate => candidate.entry.isMatch)) {
          collapsedItems.push(...run)
          index = runIndex - 1
          continue
        }

        collapsedItems.push({
          kind: 'stack-block',
          key: `stack-${run[0].key}-${run[run.length - 1].key}`,
          entries: run,
          startLineLabel: this.entryLineLabel(run[0].entry, run[0].index),
          endLineLabel: this.entryLineLabel(run[run.length - 1].entry, run[run.length - 1].index)
        })
        index = runIndex - 1
      }

      return collapsedItems
    },
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
    lineRangeLabel(item) {
      return item.startLineLabel === item.endLineLabel
        ? `Line ${item.startLineLabel}`
        : `Lines ${item.startLineLabel}-${item.endLineLabel}`
    },
    isStackTraceEntry(entry) {
      const content = entry.content.trim()

      return Boolean(
        content.match(/^from\s+/) ||
        content.match(/^(\/|[A-Z]:\\|app\/|lib\/|config\/|test\/|spec\/).+:\d+(?::in\b.*)?$/) ||
        content.match(/^[\w./:-]+:\d+(?::in\b.*)?$/) ||
        content.match(/^↳\s+/)
      )
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
    isPayloadLikeEntry(entry) {
      return isPayloadLikeContent(entry.content)
    },
    isPayloadCollapsed(entry, index) {
      return (
        this.activeView === 'readable' &&
        !entry.isMatch &&
        entry.content.length >= PAYLOAD_COLLAPSE_MIN_LENGTH &&
        this.isPayloadLikeEntry(entry) &&
        !this.expandedPayloadEntries[this.entryKey(entry, index)]
      )
    },
    isPayloadExpandable(entry) {
      return (
        this.activeView === 'readable' &&
        !entry.isMatch &&
        entry.content.length >= PAYLOAD_COLLAPSE_MIN_LENGTH &&
        this.isPayloadLikeEntry(entry)
      )
    },
    togglePayload(entry, index) {
      const key = this.entryKey(entry, index)
      this.expandedPayloadEntries = {
        ...this.expandedPayloadEntries,
        [key]: !this.expandedPayloadEntries[key]
      }
    },
    payloadPreview(entry) {
      const preview = entry.content.slice(0, PAYLOAD_PREVIEW_LENGTH).trimEnd()
      return preview.length < entry.content.length ? `${preview}…` : preview
    },
    isStackBlockExpanded(item) {
      return Boolean(this.expandedStackBlocks[item.key])
    },
    toggleStackBlock(item) {
      this.expandedStackBlocks = {
        ...this.expandedStackBlocks,
        [item.key]: !this.expandedStackBlocks[item.key]
      }
    },
    stackBlockPreview(item) {
      const firstLine = item.entries[0]?.entry?.content || ''
      if (!firstLine) {
        return `${item.entries.length} stack frames hidden`
      }

      return firstLine.length > PAYLOAD_PREVIEW_LENGTH
        ? `${firstLine.slice(0, PAYLOAD_PREVIEW_LENGTH).trimEnd()}…`
        : firstLine
    },
    stackBlockText(item) {
      return item.entries.map(candidate => candidate.entry.content).join('\n')
    },
    entryTone(entry) {
      return entryToneForContent(entry.content)
    },
    entryKindLabel(entry) {
      return entryKindLabelForContent(entry.content)
    },
    copyLabel(entry, index) {
      return this.copiedEntryKey === this.entryKey(entry, index) ? 'Copied' : 'Copy';
    },
    copyLabelForKey(key) {
      return this.copiedEntryKey === key ? 'Copied' : 'Copy';
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
  @apply inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors;
}

.timeline-toggle-btn {
  @apply ml-auto text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors;
}

.timeline-match-badge {
  @apply text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-amber-400/40 bg-amber-300/10 text-amber-200;
}

.timeline-content {
  @apply flex flex-col items-start gap-2;
}

.timeline-content-text {
  @apply w-full text-xs leading-6 text-slate-100 whitespace-pre-wrap break-normal overflow-x-auto;
}

.timeline-content-text--collapsed {
  @apply text-slate-300;
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

.timeline-entry--stack-block {
  @apply border-slate-700/80 bg-slate-950/80;
}

.timeline-entry--stack-block .timeline-marker,
.timeline-entry--stack-block .timeline-entry-kind {
  @apply bg-slate-600 border-slate-500 text-slate-100;
}

.timeline-entry--expanded {
  @apply border-slate-600;
}

.stack-block-preview {
  @apply text-xs leading-6 text-slate-300;
}

.stack-block-content {
  @apply flex flex-col gap-2;
}

.stack-block-line {
  @apply grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 items-start rounded border border-slate-800 bg-slate-900/50 px-2 py-2;
}

.stack-block-line-number {
  @apply text-[10px] text-slate-500 text-center pt-1;
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
