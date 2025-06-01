<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="toolbar-title">🚀 Logspect - Developer Console</div>
      <div class="project-info">
        <span v-if="!hasProject" class="project-status">No project selected</span>
        <template v-else>
          <span class="project-status connected">📁 {{ projectName }}</span>
          <span class="project-path" :title="projectDirectory">{{ projectDirectory }}</span>
        </template>
      </div>
      <div v-if="hasProject" class="toolbar-stats">
        <span>Requests: <span>{{ totalRequests }}</span></span>
        <span>Entries: <span>{{ totalEntries }}</span></span>
      </div>
    </div>
    <div class="toolbar-right">
      <button class="toolbar-btn" @click="$emit('select-project')">
        {{ hasProject ? '📁 Change Project' : '📁 Select Project' }}
      </button>
      <button v-if="hasProject" class="toolbar-btn" @click="$emit('refresh')" :disabled="isRefreshing">
        <span :class="{ 'spinning': isRefreshing }">⟲</span> Refresh
      </button>
      <button v-if="hasProject" class="toolbar-btn" @click="$emit('clear')">🗑 Clear</button>
      <button v-if="hasProject" :class="['toolbar-btn', { 'active': autoScroll }]" @click="$emit('toggle-auto-scroll')">
        {{ autoScroll ? '📜 Auto Scroll' : '⏸️ Manual' }}
      </button>
      <div v-if="hasProject && isWatching" class="status-indicator">
        <div class="status-dot"></div>
        <span>Live</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Toolbar',
  props: {
    hasProject: {
      type: Boolean,
      default: false
    },
    projectDirectory: {
      type: String,
      default: ''
    },
    isWatching: {
      type: Boolean,
      default: false
    },
    totalRequests: {
      type: Number,
      default: 0
    },
    totalEntries: {
      type: Number,
      default: 0
    },
    autoScroll: {
      type: Boolean,
      default: true
    },
    isRefreshing: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    projectName() {
      if (!this.projectDirectory) return '';
      return this.projectDirectory.split('/').pop() || 'Unknown Project';
    }
  },
  emits: ['select-project', 'refresh', 'clear', 'toggle-auto-scroll']
}
</script>

<style scoped>
@reference "../style.css";
@config "../../tailwind.config.js";

.toolbar {
  @apply bg-slate-800 border-b border-slate-700 px-4 py-2 flex justify-between items-center h-10 text-xs;
}

.toolbar-left {
  @apply flex items-center gap-4;
}

.toolbar-title {
  @apply font-semibold text-slate-200;
}

.project-info {
  @apply flex items-center gap-2;
}

.project-status {
  @apply text-green-600 text-xs px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded;
}

.project-status.connected {
  @apply text-green-400 border-green-400;
}

.project-path {
  @apply text-blue-300 text-xs max-w-48 whitespace-nowrap overflow-hidden text-ellipsis;
}

.toolbar-stats {
  @apply flex gap-4 text-blue-300 text-xs;
}

.toolbar-right {
  @apply flex gap-2 items-center;
}

.toolbar-btn {
  @apply bg-slate-600 border border-slate-500 text-slate-200 px-2 py-1 rounded cursor-pointer text-xs transition-all duration-200 hover:bg-slate-500 hover:border-slate-400 disabled:opacity-60 disabled:cursor-not-allowed;
}

.toolbar-btn.active {
  @apply bg-sky-600 border-sky-500 text-white;
}

.spinning {
  @apply animate-spin;
}

.status-indicator {
  @apply flex items-center gap-1.5 text-green-400 text-xs;
}

.status-dot {
  @apply w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse-dot;
}
</style>