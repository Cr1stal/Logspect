<template>
  <div class="splash-screen">
    <div class="splash-content">
      <div class="splash-icon">🚀</div>
      <h2>Welcome to Logspect</h2>
      <p>Select a Rails project directory to start monitoring logs</p>

      <!-- Recent Projects Section -->
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
              <div class="project-last-used">Last used: {{ formatDate(project.lastUsed) }}</div>
            </div>
            <div class="project-action">
              <FolderOpen :size="16" />
            </div>
          </div>
        </div>
      </div>

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
</template>

<script>
import { FolderOpen } from 'lucide-vue-next'

export default {
  name: 'SplashScreen',
  components: {
    FolderOpen
  },
  props: {
    recentProjects: {
      type: Array,
      default: () => []
    }
  },
  methods: {
    formatDate(dateString) {
      const date = new Date(dateString);
      const now = new Date();
      const diffInHours = (now - date) / (1000 * 60 * 60);

      if (diffInHours < 1) {
        return 'Just now';
      } else if (diffInHours < 24) {
        return `${Math.floor(diffInHours)} hours ago`;
      } else {
        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays === 1) {
          return 'Yesterday';
        } else if (diffInDays < 7) {
          return `${diffInDays} days ago`;
        } else {
          return date.toLocaleDateString();
        }
      }
    }
  },
  emits: ['select-project', 'select-recent-project']
}
</script>

<style scoped>
@reference "../style.css";

.splash-screen {
  @apply flex-1 flex items-center justify-center bg-slate-900 min-h-screen;
}

.splash-content {
  @apply text-center max-w-2xl p-10;
}

.splash-content h2 {
  @apply text-slate-200 text-3xl mb-4 font-semibold;
}

.splash-content p {
  @apply text-slate-400 text-base mb-8 leading-relaxed;
}

.splash-icon {
  @apply text-7xl mb-6;
}

.recent-projects {
  @apply mb-8 text-left;
}

.recent-projects h3 {
  @apply text-slate-200 text-lg mb-4 font-medium text-center;
}

.project-list {
  @apply space-y-2 mb-6;
}

.project-item {
  @apply bg-slate-800 border border-slate-700 rounded-lg p-4 cursor-pointer transition-all duration-200 hover:bg-slate-700 hover:border-slate-600 flex items-center justify-between;
}

.project-info {
  @apply flex-1;
}

.project-name {
  @apply text-slate-200 font-medium text-sm mb-1;
}

.project-path {
  @apply text-slate-400 text-xs mb-1 font-mono truncate;
}

.project-last-used {
  @apply text-slate-500 text-xs;
}

.project-action {
  @apply text-slate-400 ml-4;
}

.splash-features {
  @apply text-left mb-8 bg-slate-800 border border-slate-700 rounded-lg p-6;
}

.feature-item {
  @apply flex items-center gap-3 mb-3 last:mb-0 text-slate-300 text-sm;
}

.feature-icon {
  @apply text-lg w-6 text-center flex-shrink-0;
}

.splash-btn {
  @apply bg-sky-600 border border-sky-500 text-white px-8 py-4 rounded-lg cursor-pointer text-sm font-medium transition-all duration-200 hover:bg-sky-700 hover:border-sky-600 hover:-translate-y-px flex items-center gap-2 mx-auto;
}
</style>