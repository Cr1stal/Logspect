<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="toolbar-title">🚀 LogMan - Developer Console</div>
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
.toolbar {
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
  padding: 8px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 40px;
  font-size: 13px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-title {
  font-weight: 600;
  color: #cccccc;
}

.project-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-status {
  color: #6a9955;
  font-size: 12px;
  padding: 2px 6px;
  background: #2d2d30;
  border: 1px solid #3e3e42;
  border-radius: 3px;
}

.project-status.connected {
  color: #4ade80;
  border-color: #4ade80;
}

.project-path {
  color: #9cdcfe;
  font-size: 11px;
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolbar-stats {
  display: flex;
  gap: 16px;
  color: #9cdcfe;
  font-size: 12px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar-btn {
  background: #3c3c3c;
  border: 1px solid #464647;
  color: #cccccc;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: #404040;
  border-color: #5a5a5a;
}

.toolbar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.toolbar-btn.active {
  background: #0e639c;
  border-color: #007acc;
  color: white;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4ade80;
  font-size: 11px;
}

.status-dot {
  width: 6px;
  height: 6px;
  background: #4ade80;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}
</style>