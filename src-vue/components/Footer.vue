<template>
  <div class="footer">
    <div class="footer-stats">
      {{ totalRequests }} requests
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
    }
  },
  computed: {
    version() {
      return packageJson.version
    }
  }
}
</script>

<style scoped>
@reference "../style.css";

.footer {
  @apply bg-slate-900 border-t border-slate-600 px-4 py-2 flex justify-between items-center h-8 text-xs flex-shrink-0;
}

.footer-stats {
  @apply text-slate-300 font-mono font-medium;
}

.footer-version {
  @apply text-slate-400 font-mono text-xs;
}
</style>