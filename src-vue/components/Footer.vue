<template>
  <div class="footer">
    <div class="footer-stats">
      {{ totalRequests }} requests
    </div>
    <div class="footer-index" v-if="indexText">
      {{ indexText }}
    </div>
    <div class="footer-version">
      Logspect v{{ version }}
    </div>
  </div>
</template>

<script>
import packageJson from '../../package.json'

export default {
  name: 'Footer',
  props: {
    totalRequests: {
      type: Number,
      default: 0
    },
    totalEntries: {
      type: Number,
      default: 0
    },
    indexStatus: {
      type: Object,
      default: () => ({})
    }
  },
  computed: {
    version() {
      return packageJson.version
    },
    indexText() {
      if (!this.indexStatus || !this.indexStatus.status || this.indexStatus.status === 'idle') {
        return ''
      }

      if (this.indexStatus.status === 'unsupported') {
        return 'Index unavailable'
      }

      if (this.indexStatus.status === 'error') {
        return 'Index failed'
      }

      if (this.indexStatus.status === 'indexing') {
        return `Indexing ${this.indexStatus.progressPercent || 0}%`
      }

      if (this.indexStatus.status === 'ready') {
        return 'SQLite index ready'
      }

      if (this.indexStatus.status === 'cancelled') {
        return 'Index cancelled'
      }

      return ''
    }
  }
}
</script>

<style scoped>
@reference "../style.css";

.footer {
  @apply bg-slate-900 border-t border-slate-600 px-4 py-2 grid grid-cols-[1fr_auto_1fr] items-center h-8 text-xs flex-shrink-0 gap-4;
}

.footer-stats {
  @apply text-slate-300 font-mono font-medium;
}

.footer-index {
  @apply text-slate-400 font-mono text-center truncate;
}

.footer-version {
  @apply text-slate-400 font-mono text-xs justify-self-end;
}
</style>
