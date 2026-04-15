import { defineStore } from 'pinia'

const SEARCH_DEBOUNCE_MS = 250

const createEmptySearchState = () => ({
  searchId: null,
  query: '',
  backend: null,
  status: 'idle',
  progressPercent: 0,
  bytesProcessed: 0,
  totalBytes: 0,
  matchedLines: 0,
  shownGroups: 0,
  scannedLines: 0,
  truncated: false,
  error: null,
  results: {
    totalEntries: 0,
    entries: []
  }
})

const createEmptyIndexState = () => ({
  logFilePath: '',
  dbPath: '',
  status: 'idle',
  progressPercent: 0,
  bytesIndexed: 0,
  totalBytes: 0,
  indexedLines: 0,
  backend: 'sqlite',
  error: null
})

export const useLogStore = defineStore('log', {
  state: () => ({
    // Project state
    hasProject: false,
    projectDirectory: '',
    selectedLogFilePath: '',
    availableLogFiles: [],
    isWatching: false,

    // Log data state
    logData: {
      totalEntries: 0,
      entries: []
    },

    // UI state
    selectedUuid: null,
    autoScroll: true,
    isRefreshing: false,

    // Search state
    searchTerm: '',
    searchDebounceTimer: null,
    diskSearch: createEmptySearchState(),
    logIndex: createEmptyIndexState()
  }),

  getters: {
    projectName: (state) => {
      if (!state.projectDirectory) return ''
      return state.projectDirectory.split('/').pop() || 'Unknown Project'
    },

    totalLogEntries: (state) => {
      return state.logData.entries.reduce((sum, entry) => sum + entry.entriesCount, 0)
    },

    isDiskSearchVisible(state) {
      return Boolean(state.searchTerm.trim()) || state.diskSearch.status !== 'idle'
    },

    isDiskSearchRunning: (state) => {
      return state.diskSearch.status === 'pending' || state.diskSearch.status === 'running'
    },

    isLogIndexRunning: (state) => {
      return state.logIndex.status === 'indexing'
    },

    displayedLogData(state) {
      return this.isDiskSearchVisible ? state.diskSearch.results : state.logData
    },

    displayedTotalLogEntries() {
      return this.displayedLogData.entries.reduce((sum, entry) => sum + entry.entriesCount, 0)
    },

    selectedEntry(state) {
      if (!state.selectedUuid) return null

      const entry = this.displayedLogData.entries.find(candidate => candidate.uuid === state.selectedUuid)
      if (!entry) return null

      const sortedEntries = entry.searchMeta?.isDiskSearchResult
        ? [...entry.entries].sort((left, right) => (left.lineNumber || 0) - (right.lineNumber || 0))
        : [...entry.entries].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))

      return {
        ...entry,
        entries: sortedEntries
      }
    },

    // Statistics by type
    typeBreakdown: (state) => {
      const breakdown = {
        web: 0,
        app: 0,
        worker: 0,
        unknown: 0
      }

      state.logData.entries.forEach(entry => {
        if (breakdown.hasOwnProperty(entry.type)) {
          breakdown[entry.type] += 1
        } else {
          breakdown.unknown += 1
        }
      })

      return breakdown
    },

    // Success rate statistics
    successStats: (state) => {
      let total = 0
      let successful = 0
      let failed = 0
      let pending = 0

      state.logData.entries.forEach(entry => {
        total += 1
        if (entry.success === true) {
          successful += 1
        } else if (entry.success === false) {
          failed += 1
        } else {
          pending += 1
        }
      })

      return {
        total,
        successful,
        failed,
        pending,
        successRate: total > 0 ? (successful / total) * 100 : 0
      }
    }
  },

  actions: {
    clearPendingSearchTimer() {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer)
        this.searchDebounceTimer = null
      }
    },

    resetDiskSearchState({ preserveSearchTerm = true } = {}) {
      const nextSearchTerm = preserveSearchTerm ? this.searchTerm : ''

      this.clearPendingSearchTimer()
      this.diskSearch = createEmptySearchState()
      this.diskSearch.query = nextSearchTerm.trim()

      if (!preserveSearchTerm) {
        this.searchTerm = ''
      }
    },

    resetViewerState() {
      this.logData = {
        totalEntries: 0,
        entries: []
      }
      this.selectedUuid = null
      this.resetDiskSearchState({ preserveSearchTerm: false })
      this.logIndex = createEmptyIndexState()
    },

    applyProjectSelection(result) {
      this.hasProject = true
      this.projectDirectory = result.projectDir || ''
      this.selectedLogFilePath = result.logFilePath || ''
      this.availableLogFiles = result.availableLogFiles || []
      this.isWatching = result.isWatching ?? true
      this.resetViewerState()
      void this.refreshLogIndexStatus()
    },

    // Project actions
    async loadProjectInfo() {
      if (!window.electronAPI) {
        console.warn('Not running in Electron environment')
        return
      }

      try {
        const projectInfo = await window.electronAPI.getProjectInfo()
        this.hasProject = projectInfo.hasProject
        this.projectDirectory = projectInfo.projectDirectory || ''
        this.selectedLogFilePath = projectInfo.logFilePath || ''
        this.availableLogFiles = projectInfo.availableLogFiles || []
        this.isWatching = projectInfo.isWatching

        if (this.hasProject) {
          await this.refreshLogs()
          await this.refreshLogIndexStatus()
        }
      } catch (error) {
        console.error('Error loading project info:', error)
      }
    },

    async selectProject() {
      try {
        const result = await window.electronAPI.selectDirectory()
        if (result.success) {
          this.applyProjectSelection(result)
          await this.refreshLogs()
          return result.projectDir
        }

        console.error('Failed to select project:', result.message)
        return null
      } catch (error) {
        console.error('Error selecting project:', error)
        return null
      }
    },

    async selectRecentProject(projectPath) {
      try {
        const result = await window.electronAPI.selectRecentProject(projectPath)
        if (result.success) {
          this.applyProjectSelection(result)
          await this.refreshLogs()
          return true
        }

        console.error('Failed to select recent project:', result.message)
        return false
      } catch (error) {
        console.error('Error selecting recent project:', error)
        return false
      }
    },

    async refreshAvailableLogFiles() {
      if (!window.electronAPI || !this.hasProject) {
        return
      }

      try {
        const result = await window.electronAPI.getProjectLogFiles()
        if (result.success) {
          this.availableLogFiles = result.availableLogFiles || []
          this.selectedLogFilePath = result.logFilePath || this.selectedLogFilePath
        } else {
          console.error('Failed to refresh project log files:', result.message)
        }
      } catch (error) {
        console.error('Error refreshing project log files:', error)
      }
    },

    async selectProjectLogFile(logFilePath) {
      if (!logFilePath || logFilePath === this.selectedLogFilePath) {
        return true
      }

      try {
        const result = await window.electronAPI.selectProjectLogFile(logFilePath)
        if (result.success) {
          this.applyProjectSelection(result)
          await this.refreshLogs()
          return true
        }

        console.error('Failed to select project log file:', result.message)
        return false
      } catch (error) {
        console.error('Error selecting project log file:', error)
        return false
      }
    },

    async browseProjectLogFile() {
      try {
        const result = await window.electronAPI.browseProjectLogFile()
        if (result.success) {
          this.applyProjectSelection(result)
          await this.refreshLogs()
          return true
        }

        if (!result.canceled) {
          console.error('Failed to browse project log file:', result.message)
        }

        return false
      } catch (error) {
        console.error('Error browsing project log file:', error)
        return false
      }
    },

    // Log data actions
    updateLogData(data) {
      this.logData = data
    },

    async refreshLogs() {
      this.isRefreshing = true
      try {
        const data = await window.electronAPI.getLogData()
        this.updateLogData(data)
      } catch (error) {
        console.error('Error refreshing logs:', error)
      } finally {
        setTimeout(() => {
          this.isRefreshing = false
        }, 1000)
      }
    },

    async refreshLogIndexStatus() {
      if (!window.electronAPI || !this.selectedLogFilePath) {
        this.logIndex = createEmptyIndexState()
        return
      }

      try {
        const status = await window.electronAPI.getLogIndexStatus()
        this.handleIncomingIndexStatus(status)
      } catch (error) {
        console.error('Error refreshing log index status:', error)
      }
    },

    async clearLogs() {
      if (confirm('Clear all log entries? This will remove all captured log data.')) {
        try {
          const result = await window.electronAPI.clearLogs()

          if (result.success) {
            console.log('Logs cleared successfully from main process')
            this.selectedUuid = null
          } else {
            console.error('Failed to clear logs:', result.message)
            alert('Failed to clear logs: ' + result.message)
          }
        } catch (error) {
          console.error('Error clearing logs:', error)
          alert('Error clearing logs: ' + error.message)
        }
      }
    },

    // UI actions
    selectEntry(uuid) {
      this.selectedUuid = uuid
    },

    toggleAutoScroll() {
      this.autoScroll = !this.autoScroll
    },

    async toggleWatching() {
      try {
        if (this.isWatching) {
          await window.electronAPI.stopWatching()
          this.isWatching = false
        } else {
          await window.electronAPI.startWatching()
          this.isWatching = true
        }
      } catch (error) {
        console.error('Error toggling watching:', error)
      }
    },

    handleIncomingSearchStatus(payload) {
      const activeQuery = this.diskSearch.query || this.searchTerm.trim()
      if (!activeQuery || payload.query !== activeQuery) {
        return
      }

      if (this.diskSearch.searchId && payload.searchId !== this.diskSearch.searchId && payload.status !== 'running') {
        return
      }

      this.diskSearch = {
        ...this.diskSearch,
        searchId: payload.searchId,
        query: payload.query,
        backend: payload.backend || this.diskSearch.backend,
        status: payload.status,
        progressPercent: payload.progressPercent ?? this.diskSearch.progressPercent,
        bytesProcessed: payload.bytesProcessed ?? this.diskSearch.bytesProcessed,
        totalBytes: payload.totalBytes ?? this.diskSearch.totalBytes,
        matchedLines: payload.matchedLines ?? this.diskSearch.matchedLines,
        shownGroups: payload.shownGroups ?? this.diskSearch.shownGroups,
        scannedLines: payload.scannedLines ?? this.diskSearch.scannedLines,
        truncated: payload.truncated ?? this.diskSearch.truncated,
        error: payload.error || null
      }
    },

    handleIncomingSearchResults(payload) {
      const activeQuery = this.diskSearch.query || this.searchTerm.trim()
      if (!activeQuery || payload.query !== activeQuery) {
        return
      }

      if (this.diskSearch.searchId && payload.searchId !== this.diskSearch.searchId) {
        return
      }

      this.diskSearch = {
        ...this.diskSearch,
        searchId: payload.searchId,
        query: payload.query,
        backend: payload.backend || this.diskSearch.backend,
        results: {
          totalEntries: payload.totalEntries || 0,
          entries: payload.entries || []
        },
        matchedLines: payload.summary?.matchedLines ?? this.diskSearch.matchedLines,
        shownGroups: payload.summary?.shownGroups ?? this.diskSearch.shownGroups,
        scannedLines: payload.summary?.scannedLines ?? this.diskSearch.scannedLines,
        truncated: payload.summary?.truncated ?? this.diskSearch.truncated
      }

      if (this.selectedUuid && !this.diskSearch.results.entries.some(entry => entry.uuid === this.selectedUuid)) {
        this.selectedUuid = null
      }
    },

    async startDiskSearch(query) {
      if (!window.electronAPI || !this.hasProject) {
        return
      }

      const trimmedQuery = query.trim()
      if (!trimmedQuery || trimmedQuery !== this.searchTerm.trim()) {
        return
      }

      try {
        this.diskSearch = {
          ...createEmptySearchState(),
          query: trimmedQuery,
          backend: null,
          status: 'running'
        }

        const result = await window.electronAPI.startLogSearch(trimmedQuery)
        if (trimmedQuery !== this.searchTerm.trim()) {
          return
        }

        if (result.success) {
          this.diskSearch = {
            ...this.diskSearch,
            searchId: result.searchId,
            query: result.query,
            backend: result.backend || this.diskSearch.backend,
            status: 'running',
            totalBytes: result.totalBytes || 0,
            error: null
          }
        } else {
          this.diskSearch = {
            ...this.diskSearch,
            status: 'error',
            error: result.message || 'Failed to search the log file.'
          }
        }
      } catch (error) {
        console.error('Error starting disk search:', error)
        if (trimmedQuery === this.searchTerm.trim()) {
          this.diskSearch = {
            ...this.diskSearch,
            status: 'error',
            error: error.message
          }
        }
      }
    },

    updateSearchTerm(term) {
      this.searchTerm = term
      this.clearPendingSearchTimer()

      const trimmedTerm = term.trim()
      if (!trimmedTerm) {
        void this.clearSearch()
        return
      }

      this.selectedUuid = null
      this.diskSearch = {
        ...createEmptySearchState(),
        query: trimmedTerm,
        status: 'pending'
      }

      this.searchDebounceTimer = setTimeout(() => {
        void this.startDiskSearch(trimmedTerm)
      }, SEARCH_DEBOUNCE_MS)
    },

    async stopSearch() {
      this.clearPendingSearchTimer()

      try {
        if (window.electronAPI) {
          await window.electronAPI.cancelLogSearch()
        }
      } catch (error) {
        console.error('Error stopping disk search:', error)
      } finally {
        if (this.isDiskSearchRunning) {
          this.diskSearch = {
            ...this.diskSearch,
            status: 'cancelled'
          }
        }
      }
    },

    async clearSearch() {
      this.clearPendingSearchTimer()

      try {
        if (window.electronAPI) {
          await window.electronAPI.cancelLogSearch()
        }
      } catch (error) {
        console.error('Error clearing disk search:', error)
      } finally {
        this.selectedUuid = null
        this.searchTerm = ''
        this.resetDiskSearchState({ preserveSearchTerm: false })
      }
    },

    handleIncomingIndexStatus(payload) {
      if (!payload) {
        return
      }

      if (payload.logFilePath && this.selectedLogFilePath && payload.logFilePath !== this.selectedLogFilePath) {
        return
      }

      this.logIndex = {
        ...createEmptyIndexState(),
        ...payload
      }
    },

    // Setup electron listeners
    setupLogListener() {
      if (window.electronAPI) {
        window.electronAPI.onLogDataUpdate((data) => {
          this.updateLogData(data)
        })

        window.electronAPI.onLogSearchStatus((payload) => {
          this.handleIncomingSearchStatus(payload)
        })

        window.electronAPI.onLogSearchResults((payload) => {
          this.handleIncomingSearchResults(payload)
        })

        window.electronAPI.onLogIndexStatus((payload) => {
          this.handleIncomingIndexStatus(payload)
        })
      }
    }
  }
})
