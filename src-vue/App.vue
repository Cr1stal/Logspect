<template>
  <div id="app">
    <!-- Splash Screen -->
    <SplashScreen
      v-if="!logStore.hasProject"
      :recentProjects="recentProjects"
      @select-project="handleSelectProject"
      @select-recent-project="handleSelectRecentProject"
      @remove-recent-project="handleRemoveRecentProject"
    />

    <!-- Log Viewer -->
    <LogViewer v-else />
  </div>
</template>

<script>
import { useLogStore } from './stores/logStore.js'
import LogViewer from './components/LogViewer.vue'
import SplashScreen from './components/SplashScreen.vue'

export default {
  name: 'App',
  components: {
    LogViewer,
    SplashScreen
  },
  data() {
    return {
      recentProjects: []
    }
  },
  setup() {
    const logStore = useLogStore()
    return {
      logStore
    }
  },
  async mounted() {
    // Load project info and set up listeners
    await this.logStore.loadProjectInfo()
    this.logStore.setupLogListener()

    // Load recent projects
    await this.loadRecentProjects()
  },
  methods: {
    async handleSelectProject() {
      const selectedPath = await this.logStore.selectProject()
      if (selectedPath) {
        await this.addToRecentProjects(selectedPath)
      }
    },
    async handleSelectRecentProject(projectPath) {
      const success = await this.logStore.selectRecentProject(projectPath)
      if (success) {
        await this.addToRecentProjects(projectPath)
      }
    },
    async handleRemoveRecentProject(projectPath) {
      await this.removeRecentProject(projectPath)
    },
    async loadRecentProjects() {
      try {
        if (window.electronAPI) {
          this.recentProjects = await window.electronAPI.getRecentProjects()
        }
      } catch (error) {
        console.error('Error loading recent projects:', error)
        this.recentProjects = []
      }
    },
    async addToRecentProjects(projectPath) {
      try {
        if (window.electronAPI) {
          this.recentProjects = await window.electronAPI.addRecentProject(projectPath)
        }
      } catch (error) {
        console.error('Error adding recent project:', error)
      }
    },
    async removeRecentProject(projectPath) {
      try {
        if (window.electronAPI) {
          this.recentProjects = await window.electronAPI.removeRecentProject(projectPath)
        }
      } catch (error) {
        console.error('Error removing recent project:', error)
      }
    }
  }
}
</script>

<style scoped>
#app {
  height: 100vh;
}
</style>