import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPopStateFlag, useStore } from './index'

beforeEach(() => {
  useStore.getState().reset()
})

describe('setCurrentView', () => {
  afterEach(() => {
    setPopStateFlag(false)
    vi.restoreAllMocks()
  })

  it('pushes a history entry when the view changes', () => {
    const push = vi.spyOn(history, 'pushState')
    useStore.getState().setCurrentView('upload')
    expect(push).toHaveBeenCalledWith({ view: 'upload' }, '', '')
    expect(useStore.getState().currentView).toBe('upload')
  })

  it('does not push when the view stays the same', () => {
    const push = vi.spyOn(history, 'pushState')
    useStore.getState().setCurrentView('archive')
    expect(push).not.toHaveBeenCalled()
  })

  it('does not push while handling a popstate navigation', () => {
    const push = vi.spyOn(history, 'pushState')
    setPopStateFlag(true)
    useStore.getState().setCurrentView('settings')
    expect(push).not.toHaveBeenCalled()
    expect(useStore.getState().currentView).toBe('settings')
  })
})

describe('analyses', () => {
  const a = (id: string) => ({ id }) as never

  it('addAnalysis puts the newest first', () => {
    useStore.getState().setAnalyses([a('a1')])
    useStore.getState().addAnalysis(a('a2'))
    expect(useStore.getState().analyses.map((x) => x.id)).toEqual(['a2', 'a1'])
  })

  it('removeAnalysis drops only the matching id', () => {
    useStore.getState().setAnalyses([a('a1'), a('a2'), a('a3')])
    useStore.getState().removeAnalysis('a2')
    expect(useStore.getState().analyses.map((x) => x.id)).toEqual(['a1', 'a3'])
  })
})

describe('translation', () => {
  it('setTranslationMetadata stores source, staleness and availability', () => {
    useStore.getState().setTranslationMetadata({ source: 'refined', stale: true, sourceAvailable: false })
    const s = useStore.getState()
    expect(s.translationSource).toBe('refined')
    expect(s.translationStale).toBe(true)
    expect(s.translationSourceAvailable).toBe(false)
  })

  it('setTranslationMetadata(null) restores the defaults', () => {
    useStore.getState().setTranslationMetadata({ source: 'refined', stale: true, sourceAvailable: false })
    useStore.getState().setTranslationMetadata(null)
    const s = useStore.getState()
    expect(s.translationSource).toBeNull()
    expect(s.translationStale).toBe(false)
    expect(s.translationSourceAvailable).toBe(true)
  })

  it('clearTranslation drops the translation and returns to the original view', () => {
    useStore.getState().setTranslatedUtterances([{ start: 0, end: 1, text: 'x' }] as never)
    useStore.getState().setTranslationLanguage('de')
    useStore.getState().setTranslationMetadata({ source: 'original', stale: true, sourceAvailable: false })
    useStore.getState().setActiveView('translated')
    useStore.getState().setRefinedUtterances([{ start: 0, end: 1, text: 'r' }] as never)

    useStore.getState().clearTranslation()

    const s = useStore.getState()
    expect(s.translatedUtterances).toBeNull()
    expect(s.translationLanguage).toBeNull()
    expect(s.translationSource).toBeNull()
    expect(s.translationStale).toBe(false)
    expect(s.translationSourceAvailable).toBe(true)
    expect(s.activeView).toBe('original')
    // The refinement is a separate artifact and survives.
    expect(s.refinedUtterances).toHaveLength(1)
  })
})

describe('clearRefinement', () => {
  it('drops the refinement and returns to the original view, keeping the translation', () => {
    useStore.getState().setRefinedUtterances([{ start: 0, end: 1, text: 'r' }] as never)
    useStore.getState().setRefinementMetadata({ model: 'm' } as never)
    useStore.getState().setRefinementStale(true)
    useStore.getState().setActiveView('refined')
    useStore.getState().setTranslationLanguage('en')

    useStore.getState().clearRefinement()

    const s = useStore.getState()
    expect(s.refinedUtterances).toBeNull()
    expect(s.refinementMetadata).toBeNull()
    expect(s.refinementStale).toBe(false)
    expect(s.activeView).toBe('original')
    expect(s.translationLanguage).toBe('en')
  })
})

describe('help drawer', () => {
  it('opens on a given section and closes keeping nothing open', () => {
    useStore.getState().setHelpOpen(true, 'upload')
    expect(useStore.getState().helpOpen).toBe(true)
    expect(useStore.getState().helpInitialSection).toBe('upload')
    useStore.getState().closeHelp()
    expect(useStore.getState().helpOpen).toBe(false)
  })

  it('opens without a section', () => {
    useStore.getState().setHelpOpen(true, 'upload')
    useStore.getState().setHelpOpen(true)
    expect(useStore.getState().helpInitialSection).toBeNull()
  })
})

describe('reset', () => {
  it('returns to the archive and forgets the file, upload, recording and transcription', () => {
    useStore.setState({
      currentView: 'detail',
      file: { id: 'f1' } as never,
      uploading: true,
      uploadAbortController: new AbortController(),
      recordingActive: true,
      transcriptionId: 't1',
      transcriptionTitle: 'T',
      transcriptionStatus: 'completed',
      unsavedEdits: true,
    })
    useStore.getState().reset()
    const s = useStore.getState()
    expect(s.currentView).toBe('archive')
    expect(s.file).toBeNull()
    expect(s.uploading).toBe(false)
    expect(s.uploadAbortController).toBeNull()
    expect(s.recordingActive).toBe(false)
    expect(s.transcriptionId).toBeNull()
    expect(s.transcriptionTitle).toBeNull()
    expect(s.transcriptionStatus).toBeNull()
    expect(s.unsavedEdits).toBe(false)
  })

  it('keeps config, presets and the history list', () => {
    useStore.setState({
      config: { asr_backend: 'whisperx' } as never,
      transcriptionPresets: [{ id: 'p1' }] as never,
      bundles: [{ id: 'b1' }] as never,
      activeBundleId: 'b1',
      transcriptionHistory: [{ id: 't1' }] as never,
    })
    useStore.getState().reset()
    const s = useStore.getState()
    expect(s.config).not.toBeNull()
    expect(s.transcriptionPresets).toHaveLength(1)
    expect(s.bundles).toHaveLength(1)
    expect(s.activeBundleId).toBe('b1')
    expect(s.transcriptionHistory).toHaveLength(1)
  })
})
