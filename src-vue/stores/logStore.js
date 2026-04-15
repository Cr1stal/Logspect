import { defineStore } from 'pinia'

const INDEXED_LOG_PAGE_SIZE = 20

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

const createEmptyIndexedViewerState = () => ({
  active: false,
  loading: false,
  hasMore: false,
  nextCursor: null,
  entries: [],
  coveredBytes: 0,
  totalBytes: 0
})

const getEntryLineMeta = (entry) => {
  if (entry.searchMeta?.isDiskSearchResult) {
    return {
      firstLineNumber: entry.searchMeta.firstLineNumber,
      lastLineNumber: entry.searchMeta.lastLineNumber
    }
  }

  if (entry.indexMeta?.isIndexedViewResult) {
    return {
      firstLineNumber: entry.indexMeta.firstLineNumber,
      lastLineNumber: entry.indexMeta.lastLineNumber
    }
  }

  return null
}

const hasLineNumber = (entry) => typeof entry?.lineNumber === 'number'

const mergeEntryItems = (leftEntry = {}, rightEntry = {}) => {
  const preferredEntry = hasLineNumber(rightEntry) && !hasLineNumber(leftEntry)
    ? rightEntry
    : leftEntry
  const fallbackEntry = preferredEntry === leftEntry ? rightEntry : leftEntry

  return {
    ...fallbackEntry,
    ...preferredEntry,
    lineNumber: preferredEntry.lineNumber ?? fallbackEntry.lineNumber,
    timestamp: preferredEntry.timestamp ?? fallbackEntry.timestamp,
    content: preferredEntry.content ?? fallbackEntry.content,
    isMatch: Boolean(leftEntry.isMatch || rightEntry.isMatch)
  }
}

const findContainedSequenceStart = (containerEntries = [], candidateEntries = []) => {
  if (candidateEntries.length === 0 || candidateEntries.length > containerEntries.length) {
    return -1
  }

  for (let startIndex = 0; startIndex <= containerEntries.length - candidateEntries.length; startIndex += 1) {
    const containsSequence = candidateEntries.every((candidateEntry, candidateIndex) => (
      containerEntries[startIndex + candidateIndex]?.content === candidateEntry?.content
    ))

    if (containsSequence) {
      return startIndex
    }
  }

  return -1
}

const mergeContainedEntries = (containerEntries = [], candidateEntries = [], startIndex = 0) => (
  containerEntries.map((entry, index) => {
    const candidateEntry = candidateEntries[index - startIndex]
    return candidateEntry ? mergeEntryItems(entry, candidateEntry) : { ...entry }
  })
)

const mergeEntryCollections = (leftEntries = [], rightEntries = []) => {
  if (leftEntries.length === 0) {
    return rightEntries.map(entry => ({ ...entry }))
  }

  if (rightEntries.length === 0) {
    return leftEntries.map(entry => ({ ...entry }))
  }

  if (leftEntries.every(hasLineNumber) && rightEntries.every(hasLineNumber)) {
    const entriesByLineNumber = new Map()

    leftEntries.forEach((entry) => {
      entriesByLineNumber.set(entry.lineNumber, { ...entry })
    })

    rightEntries.forEach((entry) => {
      const existingEntry = entriesByLineNumber.get(entry.lineNumber)
      entriesByLineNumber.set(
        entry.lineNumber,
        existingEntry ? mergeEntryItems(existingEntry, entry) : { ...entry }
      )
    })

    return Array.from(entriesByLineNumber.values())
      .sort((left, right) => left.lineNumber - right.lineNumber)
  }

  const rightInsideLeftAt = findContainedSequenceStart(leftEntries, rightEntries)
  if (rightInsideLeftAt >= 0) {
    return mergeContainedEntries(leftEntries, rightEntries, rightInsideLeftAt)
  }

  const leftInsideRightAt = findContainedSequenceStart(rightEntries, leftEntries)
  if (leftInsideRightAt >= 0) {
    return mergeContainedEntries(rightEntries, leftEntries, leftInsideRightAt)
  }

  return [
    ...leftEntries.map(entry => ({ ...entry })),
    ...rightEntries.map(entry => ({ ...entry }))
  ]
}

const mergeLogGroups = (baseEntry, incomingEntry) => {
  const mergedEntries = mergeEntryCollections(baseEntry.entries, incomingEntry.entries)

  return {
    ...baseEntry,
    ...incomingEntry,
    metadata: {
      ...(baseEntry.metadata || {}),
      ...(incomingEntry.metadata || {})
    },
    success: incomingEntry.success ?? baseEntry.success ?? null,
    title: incomingEntry.title || baseEntry.title,
    entries: mergedEntries,
    entriesCount: mergedEntries.length,
    firstSeen: baseEntry.firstSeen || incomingEntry.firstSeen,
    lastSeen: incomingEntry.lastSeen || baseEntry.lastSeen,
    searchMeta: incomingEntry.searchMeta || baseEntry.searchMeta,
    indexMeta: incomingEntry.indexMeta || baseEntry.indexMeta
  }
}

const mergeViewerEntries = (indexedEntries, liveEntries) => {
  const mergedEntriesByUuid = new Map()

  indexedEntries.forEach((entry) => {
    mergedEntriesByUuid.set(entry.uuid, {
      ...entry,
      metadata: { ...(entry.metadata || {}) },
      entries: [...(entry.entries || [])]
    })
  })

  liveEntries.forEach((entry) => {
    const existingEntry = mergedEntriesByUuid.get(entry.uuid)
    if (!existingEntry) {
      mergedEntriesByUuid.set(entry.uuid, {
        ...entry,
        metadata: { ...(entry.metadata || {}) },
        entries: [...(entry.entries || [])]
      })
      return
    }

    mergedEntriesByUuid.set(entry.uuid, mergeLogGroups(existingEntry, {
      ...entry,
      metadata: { ...(entry.metadata || {}) },
      entries: [...(entry.entries || [])]
    }))
  })

  return Array.from(mergedEntriesByUuid.values())
}

const sortEntryItems = (entry) => {
  const entries = [...(entry.entries || [])]
  const hasLineNumbers = entries.length > 0 && entries.every(candidate => typeof candidate.lineNumber === 'number')

  if (getEntryLineMeta(entry) && hasLineNumbers) {
    return entries.sort((left, right) => (left.lineNumber || 0) - (right.lineNumber || 0))
  }

  return entries.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
}

const buildMatchedContentCounts = (searchEntry) => {
  const counts = new Map()
  const matchedLineNumbers = new Set(searchEntry?.searchMeta?.matchedLineNumbers || [])

  ;(searchEntry?.entries || []).forEach((entry) => {
    const isMatch = entry.isMatch || (
      typeof entry.lineNumber === 'number' && matchedLineNumbers.has(entry.lineNumber)
    )

    if (!isMatch) {
      return
    }

    counts.set(entry.content, (counts.get(entry.content) || 0) + 1)
  })

  return counts
}

const applySearchMatchMetadata = (entries = [], searchEntry = null) => {
  if (!searchEntry?.searchMeta?.matchedLineCount) {
    return entries.map((entry) => ({
      ...entry,
      isMatch: Boolean(entry.isMatch)
    }))
  }

  const matchedLineNumbers = new Set(searchEntry.searchMeta.matchedLineNumbers || [])
  const matchedContentCounts = buildMatchedContentCounts(searchEntry)

  return entries.map((entry) => {
    let isMatch = Boolean(entry.isMatch)

    if (!isMatch && typeof entry.lineNumber === 'number' && matchedLineNumbers.has(entry.lineNumber)) {
      isMatch = true
    } else if (!isMatch) {
      const remainingMatches = matchedContentCounts.get(entry.content) || 0
      if (remainingMatches > 0) {
        isMatch = true
        matchedContentCounts.set(entry.content, remainingMatches - 1)
      }
    }

    return {
      ...entry,
      isMatch
    }
  })
}

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
    searchDraft: '',
    searchTerm: '',
    diskSearch: createEmptySearchState(),
    logIndex: createEmptyIndexState(),
    indexedViewer: createEmptyIndexedViewerState(),
    pendingRebuildSearchQuery: null
  }),

  getters: {
    projectName: (state) => {
      if (!state.projectDirectory) return ''
      return state.projectDirectory.split('/').pop() || 'Unknown Project'
    },

    totalLogEntries() {
      return this.viewerLogData.entries.reduce((sum, entry) => sum + entry.entriesCount, 0)
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

    viewerLogData(state) {
      if (!state.indexedViewer.active) {
        return state.logData
      }

      const entries = mergeViewerEntries(state.indexedViewer.entries, state.logData.entries)
      return {
        totalEntries: entries.length,
        entries
      }
    },

    canLoadMoreEntries: (state) => state.indexedViewer.active && state.indexedViewer.hasMore,

    isLoadingMoreEntries: (state) => state.indexedViewer.loading,

    displayedLogData(state) {
      return this.isDiskSearchVisible ? state.diskSearch.results : this.viewerLogData
    },

    displayedTotalLogEntries() {
      return this.displayedLogData.entries.reduce((sum, entry) => sum + entry.entriesCount, 0)
    },

    selectedEntry(state) {
      if (!state.selectedUuid) return null

      const displayedEntry = this.displayedLogData.entries.find(candidate => candidate.uuid === state.selectedUuid)
      if (!displayedEntry) return null

      const liveEntry = displayedEntry.searchMeta?.isDiskSearchResult
        ? this.viewerLogData.entries.find(candidate => candidate.uuid === state.selectedUuid)
        : null

      const resolvedEntry = liveEntry && liveEntry.entriesCount > displayedEntry.entriesCount
        ? {
            ...displayedEntry,
            ...liveEntry,
            searchMeta: displayedEntry.searchMeta
          }
        : displayedEntry

      const sortedEntries = sortEntryItems(resolvedEntry)

      return {
        ...resolvedEntry,
        entries: applySearchMatchMetadata(sortedEntries, displayedEntry)
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
    resetDiskSearchState() {
      this.diskSearch = createEmptySearchState()
    },

    resetIndexedViewerState() {
      this.indexedViewer = createEmptyIndexedViewerState()
    },

    resetViewerState() {
      this.logData = {
        totalEntries: 0,
        entries: []
      }
      this.selectedUuid = null
      this.searchDraft = ''
      this.searchTerm = ''
      this.resetDiskSearchState()
      this.logIndex = createEmptyIndexState()
      this.resetIndexedViewerState()
      this.pendingRebuildSearchQuery = null
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
          await this.loadInitialEntries()
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
          await this.loadInitialEntries()
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
          await this.loadInitialEntries()
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
          await this.loadInitialEntries()
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
          await this.loadInitialEntries()
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

    async loadInitialEntries() {
      if (!window.electronAPI || !this.hasProject) {
        return
      }

      this.resetIndexedViewerState()

      try {
        const result = await window.electronAPI.getLogViewPage({
          limit: INDEXED_LOG_PAGE_SIZE
        })

        if (result.success && result.mode === 'indexed') {
          this.indexedViewer = {
            active: true,
            loading: false,
            hasMore: result.page?.hasMore ?? false,
            nextCursor: result.page?.nextCursor ?? null,
            entries: result.page?.entries || [],
            coveredBytes: result.coveredBytes || 0,
            totalBytes: result.totalBytes || 0
          }
          return
        }
      } catch (error) {
        console.error('Error loading indexed log page:', error)
      }

      await this.refreshLogs()
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

    async loadMoreEntries() {
      if (!window.electronAPI || !this.indexedViewer.active || !this.indexedViewer.hasMore || this.indexedViewer.loading) {
        return
      }

      this.indexedViewer = {
        ...this.indexedViewer,
        loading: true
      }

      try {
        const result = await window.electronAPI.getLogViewPage({
          limit: INDEXED_LOG_PAGE_SIZE,
          beforeLineNumber: this.indexedViewer.nextCursor
        })

        if (!result.success || result.mode !== 'indexed') {
          this.indexedViewer = {
            ...this.indexedViewer,
            loading: false
          }
          return
        }

        const appendedEntries = [
          ...this.indexedViewer.entries,
          ...(result.page?.entries || [])
        ]
        const uniqueEntries = Array.from(
          new Map(appendedEntries.map(entry => [entry.uuid, entry])).values()
        )

        this.indexedViewer = {
          active: true,
          loading: false,
          hasMore: result.page?.hasMore ?? false,
          nextCursor: result.page?.nextCursor ?? null,
          entries: uniqueEntries,
          coveredBytes: result.coveredBytes || this.indexedViewer.coveredBytes,
          totalBytes: result.totalBytes || this.indexedViewer.totalBytes
        }
      } catch (error) {
        console.error('Error loading additional indexed entries:', error)
        this.indexedViewer = {
          ...this.indexedViewer,
          loading: false
        }
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

    async rebuildLogIndex() {
      if (!window.electronAPI || !this.hasProject || !this.selectedLogFilePath || this.isLogIndexRunning) {
        return false
      }

      const rebuildSearchQuery = this.searchDraft.trim()

      try {
        if (this.isDiskSearchRunning) {
          await window.electronAPI.cancelLogSearch()
        }
      } catch (error) {
        console.error('Error stopping disk search before index rebuild:', error)
      }

      this.pendingRebuildSearchQuery = rebuildSearchQuery
      this.selectedUuid = null
      this.searchTerm = ''
      this.resetDiskSearchState()
      this.resetIndexedViewerState()

      try {
        const result = await window.electronAPI.rebuildLogIndex()
        if (!result.success) {
          this.pendingRebuildSearchQuery = null
          console.error('Failed to rebuild log index:', result.message)
          return false
        }

        return true
      } catch (error) {
        this.pendingRebuildSearchQuery = null
        console.error('Error rebuilding log index:', error)
        return false
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

    async updateSearchDraft(term) {
      this.searchDraft = term

      const trimmedDraft = term.trim()
      if (!trimmedDraft) {
        await this.clearSearch()
        return
      }

      if (this.searchTerm && trimmedDraft !== this.searchTerm.trim()) {
        try {
          if (window.electronAPI && this.isDiskSearchRunning) {
            await window.electronAPI.cancelLogSearch()
          }
        } catch (error) {
          console.error('Error cancelling stale disk search:', error)
        } finally {
          this.selectedUuid = null
          this.searchTerm = ''
          this.resetDiskSearchState()
        }
      }
    },

    async submitSearch() {
      if (!window.electronAPI || !this.hasProject) {
        return
      }

      const trimmedQuery = this.searchDraft.trim()
      if (!trimmedQuery) {
        await this.clearSearch()
        return
      }

      try {
        if (this.isDiskSearchRunning) {
          await window.electronAPI.cancelLogSearch()
        }
      } catch (error) {
        console.error('Error stopping previous disk search:', error)
      }

      this.selectedUuid = null
      this.searchTerm = trimmedQuery
      this.diskSearch = {
        ...createEmptySearchState(),
        query: trimmedQuery,
        status: 'pending'
      }

      await this.startDiskSearch(trimmedQuery)
    },

    async stopSearch() {
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
      try {
        if (window.electronAPI) {
          await window.electronAPI.cancelLogSearch()
        }
      } catch (error) {
        console.error('Error clearing disk search:', error)
      } finally {
        this.selectedUuid = null
        this.searchDraft = ''
        this.searchTerm = ''
        this.resetDiskSearchState()
      }
    },

    handleIncomingIndexStatus(payload) {
      if (!payload) {
        return
      }

      if (payload.logFilePath && this.selectedLogFilePath && payload.logFilePath !== this.selectedLogFilePath) {
        return
      }

      const previousStatus = this.logIndex.status

      this.logIndex = {
        ...createEmptyIndexState(),
        ...payload
      }

      if (this.pendingRebuildSearchQuery === null) {
        return
      }

      if (payload.status === 'ready' && previousStatus === 'indexing') {
        const rebuildSearchQuery = this.pendingRebuildSearchQuery
        this.pendingRebuildSearchQuery = null

        void this.loadInitialEntries().then(() => {
          if (!rebuildSearchQuery || rebuildSearchQuery !== this.searchDraft.trim()) {
            return
          }

          void this.submitSearch()
        })
        return
      }

      if (payload.status === 'error' || payload.status === 'unsupported' || payload.status === 'cancelled') {
        this.pendingRebuildSearchQuery = null
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
