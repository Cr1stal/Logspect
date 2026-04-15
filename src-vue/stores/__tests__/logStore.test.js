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
        cancelLogSearch: vi.fn().mockResolvedValue({ success: true })
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
            entries: [
              { content: 'callback timeout', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 3 }
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
            entries: [
              { content: 'request booted', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 1 },
              { content: 'rendering response', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 2 },
              { content: 'callback timeout', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 3 },
              { content: 'request completed', timestamp: '1970-01-01T00:00:00.000Z', lineNumber: 4 }
            ]
          })
        ]
      }
    }

    expect(store.selectedEntry.entriesCount).toBe(4)
    expect(store.selectedEntry.entries.map(entry => entry.lineNumber)).toEqual([1, 2, 3, 4])
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
})
