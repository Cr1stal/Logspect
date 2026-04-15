<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="toolbar-title">{{ projectName }} - Logspect</div>
    </div>

    <div class="toolbar-center">
      <div v-if="hasProject" class="log-file-container">
        <FileText :size="14" class="log-file-icon" />
        <select
          class="log-file-select"
          :value="selectedLogFilePath"
          @focus="$emit('refresh-log-files')"
          @change="$emit('select-log-file', $event.target.value)"
        >
          <option
            v-for="logFile in logFileOptions"
            :key="logFile.path"
            :value="logFile.path"
          >
            {{ logFileLabel(logFile) }}
          </option>
        </select>
        <button
          class="log-file-browse-btn"
          title="Browse any .log file"
          @click="$emit('browse-log-file')"
        >
          <FolderOpen :size="14" />
        </button>
      </div>

      <!-- Pause/Unpause Button -->
      <button
        v-if="hasProject"
        :class="['pause-btn', { 'paused': !isWatching }]"
        @click="$emit('toggle-watching')"
        :title="isWatching ? 'Pause log watching' : 'Resume log watching'"
      >
        <Pause v-if="isWatching" :size="16" />
        <Play v-else :size="16" />
      </button>

      <!-- Clear Button -->
      <button
        v-if="hasProject"
        class="clear-btn"
        @click="$emit('clear')"
        title="Clear all logs"
      >
        <Trash2 :size="16" />
      </button>

      <!-- Search/Filter Input -->
      <div v-if="hasProject" class="search-container">
        <div class="search-input-wrapper">
          <Search :size="14" class="search-icon" />
          <input
            ref="searchInput"
            type="text"
            class="search-input"
            placeholder="Search whole file"
            :value="searchTerm"
            @input="$emit('update-search', $event.target.value)"
            @keydown.enter.prevent="$emit('submit-search')"
          >
        </div>
        <button
          class="search-submit-btn"
          :disabled="!searchTerm.trim()"
          @click="$emit('submit-search')"
        >
          Search
        </button>
      </div>

      <!-- Invert Toggle -->
      <div v-if="hasProject" class="invert-container">
        <label class="invert-checkbox">
          <input
            type="checkbox"
            :checked="invertOrder"
            @change="$emit('toggle-invert', $event.target.checked)"
          >
          <span class="checkmark">
            <Check v-if="invertOrder" :size="12" />
          </span>
          <span class="label-text">Invert</span>
        </label>
      </div>

      <!-- Category Filters -->
      <div v-if="hasProject" class="category-filters">
        <button
          v-for="category in categories"
          :key="category.value"
          :class="['category-btn', { 'active': activeCategories.includes(category.value) }]"
          @click="$emit('toggle-category', category.value)"
        >
          <component :is="category.icon" :size="14" />
          {{ category.label }}
        </button>
      </div>
    </div>

    <div class="toolbar-right">
      <button class="toolbar-btn" @click="$emit('select-project')">
        <FolderOpen :size="14" />
        Change project
      </button>
    </div>
  </div>
</template>

<script>
import {
  Pause,
  Play,
  Trash2,
  Search,
  Check,
  FolderOpen,
  FileText,
  Globe,
  Smartphone,
  Cog,
  MoreHorizontal
} from 'lucide-vue-next'

export default {
  name: 'Toolbar',
  components: {
    Pause,
    Play,
    Trash2,
    Search,
    Check,
    FolderOpen,
    FileText,
    Globe,
    Smartphone,
    Cog,
    MoreHorizontal
  },
  props: {
    hasProject: {
      type: Boolean,
      default: false
    },
    projectDirectory: {
      type: String,
      default: ''
    },
    selectedLogFilePath: {
      type: String,
      default: ''
    },
    availableLogFiles: {
      type: Array,
      default: () => []
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
    },
    searchTerm: {
      type: String,
      default: ''
    },
    invertOrder: {
      type: Boolean,
      default: false
    },
    activeCategories: {
      type: Array,
      default: () => ['all']
    }
  },
  data() {
    return {
      categories: [
        { label: 'All', value: 'all', icon: 'MoreHorizontal' },
        { label: 'Web', value: 'web', icon: 'Globe' },
        { label: 'App', value: 'app', icon: 'Smartphone' },
        { label: 'Worker', value: 'worker', icon: 'Cog' }
      ]
    }
  },
  computed: {
    projectName() {
      if (!this.projectDirectory) return 'Project Name';
      return this.projectDirectory.split('/').pop() || 'Project Name';
    },
    logFileOptions() {
      if (this.availableLogFiles.length === 0) {
        return this.selectedLogFilePath ? [{
          path: this.selectedLogFilePath,
          displayPath: this.selectedLogFilePath,
          relativePath: this.selectedLogFilePath.split('/').slice(-2).join('/'),
          exists: false
        }] : [];
      }

      const hasSelectedLogFile = this.availableLogFiles.some(file => file.path === this.selectedLogFilePath);
      if (hasSelectedLogFile || !this.selectedLogFilePath) {
        return this.availableLogFiles;
      }

      return [
        {
          path: this.selectedLogFilePath,
          displayPath: this.selectedLogFilePath,
          relativePath: this.selectedLogFilePath.split('/').slice(-2).join('/'),
          exists: false
        },
        ...this.availableLogFiles
      ];
    }
  },
  methods: {
    logFileLabel(logFile) {
      if (logFile.exists === false) {
        return `${logFile.displayPath || logFile.relativePath} (waiting)`;
      }

      return logFile.displayPath || logFile.relativePath;
    },
    focusSearchInput() {
      if (this.$refs.searchInput && this.hasProject) {
        this.$refs.searchInput.focus();
        this.$refs.searchInput.select();
      }
    }
  },
  emits: ['select-project', 'select-log-file', 'browse-log-file', 'refresh-log-files', 'refresh', 'clear', 'toggle-auto-scroll', 'toggle-watching', 'update-search', 'submit-search', 'toggle-invert', 'toggle-category']
}
</script>

<style scoped>
@reference "../style.css";

.toolbar {
  @apply bg-slate-800 border-b border-slate-700 px-4 py-2 flex justify-between items-center h-12 text-xs;
}

.toolbar-left {
  @apply flex items-center;
}

.toolbar-title {
  @apply font-semibold text-slate-200 text-sm;
}

.toolbar-center {
  @apply flex items-center gap-3;
}

.log-file-container {
  @apply flex items-center gap-2;
}

.log-file-icon {
  @apply text-slate-400;
}

.log-file-select {
  @apply max-w-52 bg-slate-600 border border-slate-500 text-slate-200 px-3 py-1.5 rounded cursor-pointer text-xs font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500;
}

.log-file-browse-btn {
  @apply w-8 h-8 bg-slate-600 border border-slate-500 text-slate-200 rounded cursor-pointer transition-all duration-200 hover:bg-slate-500 flex items-center justify-center;
}

.pause-btn {
  @apply w-8 h-8 bg-slate-600 border border-slate-500 text-slate-200 rounded cursor-pointer transition-all duration-200 hover:bg-slate-500 flex items-center justify-center;
}

.pause-btn.paused {
  @apply bg-red-600 border-red-500 hover:bg-red-500;
}

.clear-btn {
  @apply w-8 h-8 bg-slate-600 border border-slate-500 text-slate-200 rounded cursor-pointer transition-all duration-200 hover:bg-slate-500 flex items-center justify-center;
}

.search-container {
  @apply relative flex items-center gap-2;
}

.search-input-wrapper {
  @apply relative flex items-center;
}

.search-icon {
  @apply absolute left-3 text-slate-400 pointer-events-none;
}

.search-input {
  @apply w-48 bg-slate-600 border border-slate-500 text-slate-300 pl-9 pr-3 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400;
}

.search-submit-btn {
  @apply bg-slate-600 border border-slate-500 text-slate-200 px-3 py-1.5 rounded text-xs transition-all duration-200 hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-600;
}

.invert-container {
  @apply flex items-center;
}

.invert-checkbox {
  @apply flex items-center gap-2 cursor-pointer text-slate-300;
}

.invert-checkbox input[type="checkbox"] {
  @apply hidden;
}

.checkmark {
  @apply w-4 h-4 bg-slate-600 border border-slate-500 rounded flex items-center justify-center text-xs;
}

.invert-checkbox input[type="checkbox"]:checked + .checkmark {
  @apply bg-sky-600 border-sky-500 text-white;
}

.label-text {
  @apply text-xs font-mono;
}

.category-filters {
  @apply flex gap-1;
}

.category-btn {
  @apply px-3 py-1.5 bg-slate-600 border border-slate-500 text-slate-200 rounded cursor-pointer text-xs transition-all duration-200 hover:bg-slate-500 flex items-center gap-1.5;
}

.category-btn.active {
  @apply bg-sky-600 border-sky-500 text-white;
}

.toolbar-right {
  @apply flex gap-3 items-center;
}

.toolbar-btn {
  @apply bg-slate-600 border border-slate-500 text-slate-200 px-3 py-1.5 rounded cursor-pointer text-xs transition-all duration-200 hover:bg-slate-500 flex items-center gap-1.5;
}
</style>
