<template>
  <div class="splash-screen">
    <div class="splash-content">
      <!-- Header -->
      <div class="splash-header">
        <div class="splash-icon">🚀</div>
        <h2>Welcome to Logspect</h2>
        <p>Select a Rails project directory to start monitoring logs</p>
      </div>

      <!-- Main Content - Two Column Layout -->
      <div class="main-layout">
        <!-- Left Column - Recent Projects -->
        <div class="left-column">
          <div v-if="recentProjects.length > 0" class="recent-projects">
            <h3>Recent Projects</h3>
            <div class="project-list">
              <div
                v-for="project in recentProjects"
                :key="project.path"
                class="project-item"
                @click="$emit('select-recent-project', project.path)"
              >
                <div class="project-info">
                  <div class="project-name">{{ project.name }}</div>
                  <div class="project-path">{{ project.path }}</div>
                </div>
                <div class="project-actions">
                  <button
                    class="remove-btn"
                    @click.stop="$emit('remove-recent-project', project.path)"
                    title="Remove from recent projects"
                  >
                    <X :size="14" />
                  </button>
                  <FolderOpen :size="16" />
                </div>
              </div>
            </div>
          </div>
          <div v-else class="no-recent-projects">
            <div class="empty-state">
              <FolderOpen :size="32" class="opacity-50" />
              <p>No recent projects</p>
            </div>
          </div>
        </div>

        <!-- Right Column - Features and Button -->
        <div class="right-column">
          <div class="splash-features">
            <div class="feature-item">
              <span class="feature-icon">📁</span>
              <span>Automatically detects Rails projects by checking for Gemfile</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">📊</span>
              <span>Real-time log monitoring with request grouping</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">🔍</span>
              <span>Smart HTTP method and path extraction</span>
            </div>
            <div class="feature-item">
              <span class="feature-icon">⚡</span>
              <span>Developer console-style interface</span>
            </div>
          </div>

          <button class="splash-btn" @click="$emit('select-project')">
            <FolderOpen :size="16" />
            Select Rails Project Directory
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { FolderOpen, X } from 'lucide-vue-next'

export default {
  name: 'SplashScreen',
  components: {
    FolderOpen,
    X
  },
  props: {
    recentProjects: {
      type: Array,
      default: () => []
    }
  },
  emits: ['select-project', 'select-recent-project', 'remove-recent-project']
}
</script>

<style scoped>
@reference "../style.css";

.splash-screen {
  @apply flex-1 flex items-center justify-center bg-slate-900 min-h-screen p-8;
}

.splash-content {
  @apply max-w-6xl w-full;
}

.splash-header {
  @apply text-center mb-12;
}

.splash-header h2 {
  @apply text-slate-200 text-3xl mb-4 font-semibold;
}

.splash-header p {
  @apply text-slate-400 text-base leading-relaxed;
}

.splash-icon {
  @apply text-7xl mb-6;
}

.main-layout {
  @apply grid grid-cols-1 lg:grid-cols-2 gap-12 items-start;
}

.left-column {
  @apply flex flex-col;
}

.right-column {
  @apply flex flex-col;
}

.recent-projects h3 {
  @apply text-slate-200 text-xl mb-6 font-medium;
}

.project-list {
  @apply space-y-3;
}

.project-item {
  @apply bg-slate-800 border border-slate-700 rounded-lg p-4 cursor-pointer transition-all duration-200 hover:bg-slate-700 hover:border-slate-600 flex items-center justify-between;
}

.project-info {
  @apply flex-1;
}

.project-name {
  @apply text-slate-200 font-medium text-base mb-1;
}

.project-path {
  @apply text-slate-400 text-sm font-mono truncate;
}

.project-actions {
  @apply text-slate-400 ml-4 flex items-center gap-2;
}

.remove-btn {
  @apply bg-transparent border-none text-slate-400 hover:text-red-400 p-1 rounded transition-colors cursor-pointer;
}

.remove-btn:hover {
  @apply bg-red-900/20;
}

.no-recent-projects {
  @apply flex items-center justify-center h-64;
}

.empty-state {
  @apply flex flex-col items-center text-slate-500;
}

.empty-state p {
  @apply mt-3 text-sm;
}

.splash-features {
  @apply bg-slate-800 border border-slate-700 rounded-lg p-6 mb-8;
}

.feature-item {
  @apply flex items-center gap-3 mb-4 last:mb-0 text-slate-300 text-sm;
}

.feature-icon {
  @apply text-lg w-6 text-center flex-shrink-0;
}

.splash-btn {
  @apply bg-sky-600 border border-sky-500 text-white px-8 py-4 rounded-lg cursor-pointer text-base font-medium transition-all duration-200 hover:bg-sky-700 hover:border-sky-600 hover:-translate-y-px flex items-center gap-2 justify-center;
}

/* Responsive adjustments */
@media (max-width: 1024px) {
  .main-layout {
    @apply grid-cols-1 gap-8;
  }

  .splash-content {
    @apply max-w-2xl;
  }
}
</style>