<template>
  <div class="search-status">
    <div class="search-status-row">
      <div class="search-status-copy">
        <div class="search-status-title">
          {{ titleText }}
        </div>
        <div class="search-status-meta">
          {{ metaText }}
        </div>
      </div>

      <button
        class="search-status-action"
        @click="$emit(isRunning ? 'stop-search' : 'clear-search')"
      >
        {{ isRunning ? 'Stop' : 'Clear' }}
      </button>
    </div>

    <div class="search-progress-track">
      <div
        class="search-progress-fill"
        :style="{ width: `${Math.max(progressPercent || 0, isRunning ? 2 : 0)}%` }"
      />
    </div>
  </div>
</template>

<script>
export default {
  name: 'SearchStatus',
  props: {
    query: {
      type: String,
      default: ''
    },
    backend: {
      type: String,
      default: null
    },
    status: {
      type: String,
      default: 'idle'
    },
    progressPercent: {
      type: Number,
      default: 0
    },
    bytesProcessed: {
      type: Number,
      default: 0
    },
    totalBytes: {
      type: Number,
      default: 0
    },
    matchedLines: {
      type: Number,
      default: 0
    },
    shownGroups: {
      type: Number,
      default: 0
    },
    truncated: {
      type: Boolean,
      default: false
    },
    error: {
      type: String,
      default: null
    }
  },
  computed: {
    isRunning() {
      return this.status === 'pending' || this.status === 'running'
    },
    titleText() {
      if (this.status === 'error') {
        return `Search failed for "${this.query}"`
      }

      if (this.status === 'cancelled') {
        return `Search stopped for "${this.query}"`
      }

      if (this.isRunning) {
        return `Searching whole file for "${this.query}"`
      }

      return `Search complete for "${this.query}"`
    },
    metaText() {
      if (this.status === 'error') {
        return this.error || 'Unexpected search error.'
      }

      const parts = []

      if (this.backend === 'sqlite') {
        parts.push('SQLite index')
      } else if (this.backend === 'scan') {
        parts.push('Stream scan')
      }

      if (this.totalBytes > 0) {
        parts.push(`${this.formatBytes(this.bytesProcessed)} / ${this.formatBytes(this.totalBytes)}`)
      }

      parts.push(`${this.progressPercent || 0}%`)
      parts.push(`${this.matchedLines} matching lines`)
      parts.push(`${this.shownGroups} result groups`)

      if (this.truncated) {
        parts.push('showing the first result groups only')
      }

      return parts.join(' • ')
    }
  },
  methods: {
    formatBytes(value) {
      if (!value) {
        return '0 B'
      }

      const units = ['B', 'KB', 'MB', 'GB']
      let currentValue = value
      let unitIndex = 0

      while (currentValue >= 1024 && unitIndex < units.length - 1) {
        currentValue /= 1024
        unitIndex += 1
      }

      return `${currentValue.toFixed(currentValue >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
    }
  },
  emits: ['stop-search', 'clear-search']
}
</script>

<style scoped>
@reference "../style.css";

.search-status {
  @apply bg-slate-900 border-b border-slate-700 px-4 py-2 flex flex-col gap-2;
}

.search-status-row {
  @apply flex items-center justify-between gap-4;
}

.search-status-copy {
  @apply min-w-0 flex-1;
}

.search-status-title {
  @apply text-xs font-semibold text-slate-100 truncate;
}

.search-status-meta {
  @apply text-xs text-slate-400 truncate;
}

.search-status-action {
  @apply text-xs px-2 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-800 transition-colors;
}

.search-progress-track {
  @apply h-1.5 w-full rounded-full bg-slate-800 overflow-hidden;
}

.search-progress-fill {
  @apply h-full bg-sky-500 transition-[width] duration-200 ease-out;
}
</style>
