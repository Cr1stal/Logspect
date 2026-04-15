import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLogStore } from '../logStore.js'

const createDiskSearchEntry = ({
  uuid = 'group-1',
  entriesCount = 1,
  entries = [],
  searchMeta = {}
} = {}) => ({
  uuid,
  type: 'app',
  subType: 'sys',
  success: null,
  metadata: {},
  title: 'Search Match',
  entriesCount,
  firstSeen: '1970-01-01T00:00:00.000Z',
  lastSeen: '1970-01-01T00:00:00.000Z',
  entries,
  searchMeta: {
    isDiskSearchResult: true,
    firstLineNumber: 2,
    lastLineNumber: 2,
    matchedLineCount: 1,
    matchedLineNumbers: [2],
    hasHiddenMatches: false,
    ...searchMeta
  }
})

const createLiveEntry = ({
  uuid = 'group-1',
  entriesCount = 1,
  entries = []
} = {}) => ({
  uuid,
  type: 'app',
  subType: 'sys',
  success: null,
  metadata: {},
  title: 'System Log',
  entriesCount,
  firstSeen: '2024-01-01T00:00:00.000Z',
  lastSeen: '2024-01-01T00:00:03.000Z',
  entries
})

const createIndexedViewerEntry = ({
  uuid = 'group-1',
  entriesCount = 1,
  entries = [],
  indexMeta = {}
} = {}) => ({
  uuid,
  type: 'app',
  subType: 'sys',
  success: null,
  metadata: {},
  title: 'Indexed Log',
  entriesCount,
  firstSeen: '1970-01-01T00:00:00.000Z',
  lastSeen: '1970-01-01T00:00:00.000Z',
  entries,
  indexMeta: {
    isIndexedViewResult: true,
    firstLineNumber: 1,
    lastLineNumber: entriesCount,
    ...indexMeta
  }
})

describe('logStore selectedEntry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    globalThis.window = {
      electronAPI: {
        cancelLogSearch: vi.fn().mockResolvedValue({ success: true }),
        rebuildLogIndex: vi.fn().mockResolvedValue({ success: true })
      }
    }
  })

  it('shows the fuller live entry body when filtered search results contain fewer lines', () => {
    const store = useLogStore()

    store.searchTerm = 'callback'
    store.selectedUuid = 'group-1'
    store.logData = {
      totalEntries: 1,
      entries: [
        createLiveEntry({
          entriesCount: 3,
          entries: [
            { content: 'request booted', timestamp: '2024-01-01T00:00:00.000Z' },
            { content: 'rendering response', timestamp: '2024-01-01T00:00:01.000Z' },
            { content: 'callback timeout', timestamp: '2024-01-01T00:00:02.000Z' }
          ]
        })
      ]
    }
    store.diskSearch = {
      ...store.diskSearch,
      status: 'completed',
      query: 'callback',
      results: {
        totalEntries: 1,
        entries: [
          createDiskSearchEntry({
            entriesCount: 1,
            searchMeta: {
              firstLineNumber: 3,
              lastLineNumber: 3,
              matchedLineNumbers: [3]
            },
            entries: [
              { content: 'callback timeout', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 3, isMatch: true }
            ]
          })
        ]
      }
    }

    expect(store.selectedEntry.entriesCount).toBe(3)
    expect(store.selectedEntry.entries.map(entry => entry.content)).toEqual([
      'request booted',
      'rendering response',
      'callback timeout'
    ])
    expect(store.selectedEntry.entries.map(entry => entry.isMatch)).toEqual([
      false,
      false,
      true
    ])
  })

  it('keeps the disk search body when it is fuller than the currently loaded live entry', () => {
    const store = useLogStore()

    store.searchTerm = 'callback'
    store.selectedUuid = 'group-1'
    store.logData = {
      totalEntries: 1,
      entries: [
        createLiveEntry({
          entriesCount: 2,
          entries: [
            { content: 'callback timeout', timestamp: '2024-01-01T00:00:01.000Z' },
            { content: 'request completed', timestamp: '2024-01-01T00:00:02.000Z' }
          ]
        })
      ]
    }
    store.diskSearch = {
      ...store.diskSearch,
      status: 'completed',
      query: 'callback',
      results: {
        totalEntries: 1,
        entries: [
          createDiskSearchEntry({
            entriesCount: 4,
            searchMeta: {
              firstLineNumber: 3,
              lastLineNumber: 3,
              matchedLineNumbers: [3]
            },
            entries: [
              { content: 'request booted', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 1 },
              { content: 'rendering response', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 2 },
              { content: 'callback timeout', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 3, isMatch: true },
              { content: 'request completed', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 4 }
            ]
          })
        ]
      }
    }

    expect(store.selectedEntry.entriesCount).toBe(4)
    expect(store.selectedEntry.entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3, 4])
    expect(store.selectedEntry.entries.map(entry => entry.isMatch)).toEqual([false, false, true, false])
  })

  it('merges indexed viewer groups with new live entries for the same uuid', () => {
    const store = useLogStore()

    store.indexedViewer = {
      active: true,
      loading: false,
      hasMore: false,
      nextCursor: null,
      coveredBytes: 100,
      totalBytes: 100,
      entries: [
        createIndexedViewerEntry({
          uuid: 'group-1',
          entriesCount: 2,
          entries: [
            { content: 'request booted', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 1 },
            { content: 'rendering response', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 2 }
          ]
        })
      ]
    }
    store.logData = {
      totalEntries: 2,
      entries: [
        createLiveEntry({
          uuid: 'group-1',
          entriesCount: 1,
          entries: [
            { content: 'request completed', timestamp: '2024-01-01T00:00:03.000Z' }
          ]
        }),
        createLiveEntry({
          uuid: 'group-2',
          entriesCount: 1,
          entries: [
            { content: 'brand new live group', timestamp: '2024-01-01T00:00:04.000Z' }
          ]
        })
      ]
    }

    expect(store.viewerLogData.totalEntries).toBe(2)
    expect(store.viewerLogData.entries.find(entry => entry.uuid === 'group-1').entriesCount).toBe(3)
    expect(store.viewerLogData.entries.find(entry => entry.uuid === 'group-1').indexMeta).toMatchObject({
      isIndexedViewResult: true
    })
  })

  it('deduplicates overlapping indexed and live bodies for the same group', () => {
    const store = useLogStore()

    store.indexedViewer = {
      active: true,
      loading: false,
      hasMore: false,
      nextCursor: null,
      coveredBytes: 100,
      totalBytes: 100,
      entries: [
        createIndexedViewerEntry({
          uuid: 'group-1',
          entriesCount: 2,
          entries: [
            { content: 'request booted', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 1 },
            { content: 'rendering response', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 2 }
          ]
        })
      ]
    }
    store.logData = {
      totalEntries: 1,
      entries: [
        createLiveEntry({
          uuid: 'group-1',
          entriesCount: 3,
          entries: [
            { content: 'request booted', timestamp: '2024-01-01T00:00:00.000Z' },
            { content: 'rendering response', timestamp: '2024-01-01T00:00:01.000Z' },
            { content: 'request completed', timestamp: '2024-01-01T00:00:02.000Z' }
          ]
        })
      ]
    }

    expect(store.viewerLogData.entries.find(entry => entry.uuid === 'group-1').entriesCount).toBe(3)
    expect(store.viewerLogData.entries.find(entry => entry.uuid === 'group-1').entries.map(entry => entry.content)).toEqual([
      'request booted',
      'rendering response',
      'request completed'
    ])
  })

  it('keeps search result bodies from duplicating when viewer data overlaps the same group', () => {
    const store = useLogStore()

    store.searchTerm = 'callback'
    store.selectedUuid = 'group-1'
    store.indexedViewer = {
      active: true,
      loading: false,
      hasMore: false,
      nextCursor: null,
      coveredBytes: 100,
      totalBytes: 100,
      entries: [
        createIndexedViewerEntry({
          uuid: 'group-1',
          entriesCount: 2,
          entries: [
            { content: 'request booted', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 1 },
            { content: 'callback timeout', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 2 }
          ]
        })
      ]
    }
    store.logData = {
      totalEntries: 1,
      entries: [
        createLiveEntry({
          uuid: 'group-1',
          entriesCount: 3,
          entries: [
            { content: 'request booted', timestamp: '2024-01-01T00:00:00.000Z' },
            { content: 'callback timeout', timestamp: '2024-01-01T00:00:01.000Z' },
            { content: 'request completed', timestamp: '2024-01-01T00:00:02.000Z' }
          ]
        })
      ]
    }
    store.diskSearch = {
      ...store.diskSearch,
      status: 'completed',
      query: 'callback',
      results: {
        totalEntries: 1,
        entries: [
          createDiskSearchEntry({
            entriesCount: 3,
            searchMeta: {
              firstLineNumber: 2,
              lastLineNumber: 2,
              matchedLineNumbers: [2]
            },
            entries: [
              { content: 'request booted', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 1 },
              { content: 'callback timeout', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 2, isMatch: true },
              { content: 'request completed', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 3 }
            ]
          })
        ]
      }
    }

    expect(store.selectedEntry.entriesCount).toBe(3)
    expect(store.selectedEntry.entries.map(entry => entry.content)).toEqual([
      'request booted',
      'callback timeout',
      'request completed'
    ])
  })

  it('cancels the active disk search when the draft query changes', async () => {
    const store = useLogStore()

    store.searchDraft = 'callback'
    store.searchTerm = 'callback'
    store.diskSearch = {
      ...store.diskSearch,
      query: 'callback',
      status: 'running'
    }

    await store.updateSearchDraft('callback timeout')

    expect(window.electronAPI.cancelLogSearch).toHaveBeenCalledTimes(1)
    expect(store.searchDraft).toBe('callback timeout')
    expect(store.searchTerm).toBe('')
    expect(store.diskSearch.status).toBe('idle')
  })

  it('rebuilds the index and reruns the current draft search when indexing finishes', async () => {
    const store = useLogStore()

    store.hasProject = true
    store.selectedLogFilePath = '/tmp/test.log'
    store.searchDraft = 'callback timeout'
    store.searchTerm = 'callback timeout'
    store.diskSearch = {
      ...store.diskSearch,
      query: 'callback timeout',
      status: 'completed'
    }

    store.loadInitialEntries = vi.fn().mockResolvedValue(undefined)
    store.submitSearch = vi.fn().mockResolvedValue(undefined)

    const rebuildStarted = await store.rebuildLogIndex()
    expect(rebuildStarted).toBe(true)
    expect(window.electronAPI.rebuildLogIndex).toHaveBeenCalledTimes(1)
    expect(store.searchTerm).toBe('')
    expect(store.diskSearch.status).toBe('idle')

    store.handleIncomingIndexStatus({
      logFilePath: '/tmp/test.log',
      status: 'indexing'
    })
    store.handleIncomingIndexStatus({
      logFilePath: '/tmp/test.log',
      status: 'ready'
    })

    await Promise.resolve()

    expect(store.loadInitialEntries).toHaveBeenCalledTimes(1)
    expect(store.submitSearch).toHaveBeenCalledTimes(1)
    expect(store.pendingRebuildSearchQuery).toBe(null)
  })
})
