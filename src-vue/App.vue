<template>
  <div id="app">
    <!-- Splash Screen -->
    <SplashScreen
      v-if="!logStore.hasProject"
      :recentProjects="recentProjects"
      @select-project="handleSelectProject"
      @select-recent-project="handleSelectRecentProject"
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
    this.loadRecentProjects()
  },
  methods: {
    async handleSelectProject() {
      const selectedPath = await this.logStore.selectProject()
      if (selectedPath) {
        this.addToRecentProjects(selectedPath)
      }
    },
    async handleSelectRecentProject(projectPath) {
      const success = await this.logStore.selectRecentProject(projectPath)
      if (success) {
        this.addToRecentProjects(projectPath)
      }
    },
    loadRecentProjects() {
      try {
        const stored = localStorage.getItem('logspect-recent-projects')
        if (stored) {
          this.recentProjects = JSON.parse(stored)
        }
      } catch (error) {
        console.error('Error loading recent projects:', error)
        this.recentProjects = []
      }
    },
    addToRecentProjects(projectPath) {
      const projectName = projectPath.split('/').pop() || 'Unknown Project'

      // Remove existing entry if it exists
      this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath)

      // Add to beginning of array
      this.recentProjects.unshift({
        name: projectName,
        path: projectPath,
        lastUsed: new Date().toISOString()
      })

      // Keep only last 3 projects
      this.recentProjects = this.recentProjects.slice(0, 3)

      // Save to localStorage
      try {
        localStorage.setItem('logspect-recent-projects', JSON.stringify(this.recentProjects))
      } catch (error) {
        console.error('Error saving recent projects:', error)
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