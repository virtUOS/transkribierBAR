import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'
import { SubtitleRow } from './SubtitleRow'
import { LanguageSelect } from '../LanguageSelect'
import { PresetSelect } from '../PresetSelect/PresetSelect'
import { SpeakerMapping } from '../SpeakerMapping'
import { formatUtteranceRange, isInAnyRange } from '../../utils/utteranceRanges'
import type { Utterance } from '../../api/types'

type SearchScope = 'text' | 'speaker' | 'both'

type DisplayEntry =
  | { type: 'utterance'; originalIndex: number; utterance: Utterance; isMatch: boolean }
  | { type: 'separator'; hiddenCount: number }

export function SubtitleEditor() {
  const { t } = useTranslation()
  const result = useStore((s) => s.transcriptionResult)
  const transcriptionId = useStore((s) => s.transcriptionId)
  const currentTime = useStore((s) => s.currentTime)
  const speakerMappings = useStore((s) => s.speakerMappings)
  const setResult = useStore((s) => s.setTranscriptionResult)
  const dirty = useStore((s) => s.unsavedEdits)
  const setDirty = useStore((s) => s.setUnsavedEdits)
  const refinedUtterances = useStore((s) => s.refinedUtterances)
  const refinementMetadata = useStore((s) => s.refinementMetadata)
  const activeView = useStore((s) => s.activeView)
  const setRefinedUtterances = useStore((s) => s.setRefinedUtterances)
  const setRefinementMetadata = useStore((s) => s.setRefinementMetadata)
  const refinementStale = useStore((s) => s.refinementStale)
  const setRefinementStale = useStore((s) => s.setRefinementStale)
  const setActiveView = useStore((s) => s.setActiveView)
  const clearRefinement = useStore((s) => s.clearRefinement)
  const translatedUtterances = useStore((s) => s.translatedUtterances)
  const translationLanguage = useStore((s) => s.translationLanguage)
  const translationSource = useStore((s) => s.translationSource)
  const translationStale = useStore((s) => s.translationStale)
  const translationSourceAvailable = useStore((s) => s.translationSourceAvailable)
  const setTranslatedUtterances = useStore((s) => s.setTranslatedUtterances)
  const setTranslationLanguage = useStore((s) => s.setTranslationLanguage)
  const setTranslationMetadata = useStore((s) => s.setTranslationMetadata)
  const clearTranslation = useStore((s) => s.clearTranslation)
  const config = useStore((s) => s.config)
  const refinementPresets = useStore((s) => s.refinementPresets)
  const setRefinementPresets = useStore((s) => s.setRefinementPresets)
  const activeBundleId = useStore((s) => s.activeBundleId)
  const bundles = useStore((s) => s.bundles)
  const llmAvailable = config?.llm_available ?? false
  const activeRef = useRef<HTMLTableRowElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // The editor stays mounted when another transcription is opened; its error
  // belongs to the previous one.
  const [prevTranscriptionId, setPrevTranscriptionId] = useState(transcriptionId)
  if (transcriptionId !== prevTranscriptionId) {
    setPrevTranscriptionId(transcriptionId)
    setSaveError(null)
  }
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('both')
  const [showRefineModal, setShowRefineModal] = useState(false)
  const [refineContext, setRefineContext] = useState('')
  const [retryingChunks, setRetryingChunks] = useState(false)
  const [retryError, setRetryError] = useState<'stale' | 'generic' | null>(null)
  const [refineError, setRefineError] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [refining, setRefining] = useState(false)
  const [selectedRefinementPresetId, setSelectedRefinementPresetId] = useState<string | null>(null)
  const [speakerPanelOpen, setSpeakerPanelOpen] = useState(false)
  const [focusSpeaker, setFocusSpeaker] = useState<string | undefined>(undefined)

  const handleLoadRefinementPreset = (presetId: string | null) => {
    setSelectedRefinementPresetId(presetId)
    if (!presetId) return
    const preset = refinementPresets.find((p) => p.id === presetId)
    if (preset) setRefineContext(preset.context || '')
  }

  const handleSaveRefinementPreset = async (name: string) => {
    const preset = await api.createRefinementPreset({ name, context: refineContext || null })
    setRefinementPresets([...refinementPresets, preset])
    setSelectedRefinementPresetId(preset.id)
  }

  // Opening the dialog with no preset chosen yet loads the active bundle's refinement preset
  const openRefineDialog = () => {
    const bundlePresetId = bundles.find((b) => b.id === activeBundleId)?.refinement_preset_id
    if (bundlePresetId && !selectedRefinementPresetId) handleLoadRefinementPreset(bundlePresetId)
    setShowRefineModal(true)
  }
  const [showTranslateModal, setShowTranslateModal] = useState(false)
  const [translateLanguage, setTranslateLanguage] = useState('en')
  const [translateSource, setTranslateSource] = useState<'original' | 'refined'>('refined')
  const [translating, setTranslating] = useState(false)

  // Renewing a stored translation starts from its language; the source starts from the refined text
  const openTranslateDialog = () => {
    if (translationLanguage) setTranslateLanguage(translationLanguage)
    setTranslateSource(refinedUtterances ? 'refined' : 'original')
    setShowTranslateModal(true)
  }

  // A refinement that arrives while the dialog is open (a bundle runs one) becomes its source
  const [translateSourceSetFor, setTranslateSourceSetFor] = useState(refinedUtterances)
  if (translateSourceSetFor !== refinedUtterances) {
    setTranslateSourceSetFor(refinedUtterances)
    if (showTranslateModal) setTranslateSource(refinedUtterances ? 'refined' : 'original')
  }
  const [summaryCollapsed, setSummaryCollapsed] = useState(false)
  const [editingCell, setEditingCell] = useState<{ index: number; field: string } | null>(null)
  const setSeekTo = useStore((s) => s.setSeekTo)

  const utterances = useMemo(() =>
    activeView === 'translated' && translatedUtterances
      ? translatedUtterances
      : activeView === 'refined' && refinedUtterances
        ? refinedUtterances
        : (result?.utterances || []),
    [activeView, translatedUtterances, refinedUtterances, result]
  )

  // Color map based on display names so same-name speakers always share color
  const speakerColorMap = useMemo(() => {
    const displayNames = new Set<string>()
    ;(result?.utterances || []).forEach((u) => {
      if (u.speaker) {
        const display = speakerMappings[u.speaker] || u.speaker
        displayNames.add(display)
      }
    })
    const sorted = Array.from(displayNames).sort()
    const nameToIndex: Record<string, number> = {}
    sorted.forEach((name, i) => { nameToIndex[name] = i })
    // Map original labels to index via their display name
    const map: Record<string, number> = {}
    ;(result?.utterances || []).forEach((u) => {
      if (u.speaker && !(u.speaker in map)) {
        const display = speakerMappings[u.speaker] || u.speaker
        map[u.speaker] = nameToIndex[display]
        map[display] = nameToIndex[display]
      }
    })
    return map
  }, [result, speakerMappings])

  const activeIndex = utterances.findIndex(
    (u) => currentTime >= u.start && currentTime < u.end
  )

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const displayList = useMemo<DisplayEntry[]>(() => {
    if (!debouncedQuery.trim()) return utterances.map((u, i) => ({ type: 'utterance' as const, originalIndex: i, utterance: u, isMatch: false }))

    const query = debouncedQuery.trim().toLowerCase()

    // Find matching indices
    const matchIndices = new Set<number>()
    utterances.forEach((u, i) => {
      const speakerName = u.speaker ? (speakerMappings[u.speaker] || u.speaker) : ''
      const textMatch = (searchScope === 'text' || searchScope === 'both') && u.text.toLowerCase().includes(query)
      const speakerMatch = (searchScope === 'speaker' || searchScope === 'both') && u.speaker !== null && speakerName.toLowerCase().includes(query)
      if (textMatch || speakerMatch) matchIndices.add(i)
    })

    if (matchIndices.size === 0) return []

    // Expand with context (1 before, 1 after)
    const visibleIndices = new Set<number>()
    matchIndices.forEach(i => {
      if (i > 0) visibleIndices.add(i - 1)
      visibleIndices.add(i)
      if (i < utterances.length - 1) visibleIndices.add(i + 1)
    })

    // Build display list with separators
    const sorted = Array.from(visibleIndices).sort((a, b) => a - b)
    const entries: DisplayEntry[] = []

    for (let j = 0; j < sorted.length; j++) {
      const idx = sorted[j]
      // Add separator if there's a gap
      if (j > 0 && sorted[j] - sorted[j - 1] > 1) {
        entries.push({ type: 'separator', hiddenCount: sorted[j] - sorted[j - 1] - 1 })
      }
      entries.push({ type: 'utterance', originalIndex: idx, utterance: utterances[idx], isMatch: matchIndices.has(idx) })
    }

    // Add leading separator if first visible isn't index 0
    if (sorted[0] > 0) {
      entries.unshift({ type: 'separator', hiddenCount: sorted[0] })
    }
    // Add trailing separator if last visible isn't the last utterance
    if (sorted[sorted.length - 1] < utterances.length - 1) {
      entries.push({ type: 'separator', hiddenCount: utterances.length - 1 - sorted[sorted.length - 1] })
    }

    return entries
  }, [utterances, debouncedQuery, searchScope, speakerMappings])

  const matchCount = useMemo(() =>
    displayList.filter(e => e.type === 'utterance' && e.isMatch).length,
    [displayList]
  )

  const toggleScope = (scope: 'text' | 'speaker') => {
    setSearchScope(prev => {
      if (prev === 'both') return scope === 'text' ? 'speaker' : 'text'
      if (prev === scope) return 'both' // toggling the only active one re-activates both
      return scope
    })
  }

  const clearSearch = () => {
    setSearchQuery('')
    setDebouncedQuery('')
  }

  useEffect(() => {
    if (!debouncedQuery && activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeIndex, debouncedQuery])

  const handleStartEditing = useCallback((index: number, field: string = 'text') => {
    if (activeView === 'refined' || activeView === 'translated') return
    setEditingCell({ index, field })
  }, [activeView])

  const handleStopEditing = useCallback(() => {
    setEditingCell(null)
  }, [])

  // Hotkey handler for subtitle editing navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (!target.hasAttribute('data-subtitle-textarea') && !target.hasAttribute('data-subtitle-input')) return

      if (e.key === 'Tab') {
        e.preventDefault()
        if (editingCell === null) return

        // Explicitly blur to trigger save
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) target.blur()

        const nextIndex = e.shiftKey
          ? Math.max(0, editingCell.index - 1)
          : Math.min(utterances.length - 1, editingCell.index + 1)

        setEditingCell({ index: nextIndex, field: editingCell.field })
        setSeekTo(utterances[nextIndex].start)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) target.blur()
        setEditingCell(null)
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [editingCell, utterances, setSeekTo])

  const handleEditSpeaker = useCallback((speakerId: string) => {
    setFocusSpeaker(speakerId)
    setSpeakerPanelOpen(true)
  }, [])

  const handleCloseSpeakerPanel = useCallback(() => {
    setSpeakerPanelOpen(false)
    setFocusSpeaker(undefined)
  }, [])

  const handleUpdate = useCallback((index: number, field: keyof Utterance, value: string | number) => {
    if (!result) return
    const updated = [...result.utterances]
    updated[index] = { ...updated[index], [field]: value }

    if (typeof value === 'number') {
      // Ensure current row stays valid: start <= end
      if (field === 'start' && value > updated[index].end) {
        updated[index] = { ...updated[index], end: value }
      }
      if (field === 'end' && value < updated[index].start) {
        updated[index] = { ...updated[index], start: value }
      }

      // Count how many rows would be affected by cascade (simulate it)
      let affectedCount = 0
      if (field === 'start') {
        let curStart = updated[index].start
        for (let i = index; i > 0; i--) {
          if (curStart < updated[i - 1].end) {
            affectedCount++
            curStart = Math.min(curStart, updated[i - 1].start)
          } else {
            break
          }
        }
      }
      if (field === 'end') {
        let curEnd = updated[index].end
        for (let i = index; i < updated.length - 1; i++) {
          if (curEnd > updated[i + 1].start) {
            affectedCount++
            curEnd = Math.max(curEnd, updated[i + 1].end)
          } else {
            break
          }
        }
      }

      // Warn user if cascade will affect other rows
      if (affectedCount > 0 && !confirm(t('editor.confirmTimestampCascade', { count: affectedCount }))) {
        return // user cancelled — don't apply the edit
      }

      // Link timestamps: editing start cascades backward through previous rows
      if (field === 'start') {
        for (let i = index; i > 0; i--) {
          const curStart = updated[i].start
          const prev = updated[i - 1]
          if (curStart < prev.end) {
            updated[i - 1] = { ...prev, end: curStart, start: Math.min(curStart, prev.start) }
          } else {
            break
          }
        }
      }

      // Link timestamps: editing end cascades forward through all subsequent rows
      if (field === 'end') {
        for (let i = index; i < updated.length - 1; i++) {
          const curEnd = updated[i].end
          const next = updated[i + 1]
          if (curEnd > next.start) {
            updated[i + 1] = { ...next, start: curEnd, end: Math.max(curEnd, next.end) }
          } else {
            break
          }
        }
      }
    }

    setResult({ ...result, utterances: updated })
    setDirty(true)
  }, [result, setResult, setDirty, t])

  const handleAddRow = useCallback((afterIndex: number) => {
    if (!result) return
    const updated = [...result.utterances]
    const current = updated[afterIndex]
    const next = updated[afterIndex + 1]
    const newStart = current.end
    const newEnd = next ? next.start : current.end + 1000
    updated.splice(afterIndex + 1, 0, {
      start: newStart,
      end: newEnd,
      text: '',
      speaker: current.speaker,
    })
    setResult({ ...result, utterances: updated })
    setDirty(true)
  }, [result, setResult, setDirty])

  const handleDeleteRow = useCallback((index: number) => {
    if (!result) return
    const updated = [...result.utterances]
    updated.splice(index, 1)
    setResult({ ...result, utterances: updated })
    setDirty(true)
  }, [result, setResult, setDirty])

  const handleMergeWithNext = useCallback((index: number) => {
    if (!result || index >= result.utterances.length - 1) return
    const updated = [...result.utterances]
    const current = updated[index]
    const next = updated[index + 1]
    updated[index] = {
      ...current,
      end: next.end,
      text: current.text + ' ' + next.text,
    }
    updated.splice(index + 1, 1)
    setResult({ ...result, utterances: updated })
    setDirty(true)
  }, [result, setResult, setDirty])

  const handleDiscard = useCallback(async () => {
    if (!transcriptionId || !confirm(t('editor.confirmDiscard'))) return
    setSaveError(null)
    try {
      const saved = await api.getTranscription(transcriptionId)
      if (useStore.getState().transcriptionId !== transcriptionId) return
      setResult(saved)
      setDirty(false)
    } catch (e) {
      if (useStore.getState().transcriptionId !== transcriptionId) return
      setSaveError(e instanceof ApiError && e.message ? e.message : t('editor.discardFailed'))
    }
  }, [transcriptionId, setResult, setDirty, t])

  const handleRestoreOriginal = useCallback(async () => {
    if (!transcriptionId || !confirm(t('editor.confirmRestore'))) return
    setSaveError(null)
    try {
      const original = await api.getOriginalTranscription(transcriptionId)
      const current = useStore.getState().transcriptionResult
      if (!current || current.id !== transcriptionId) return
      setResult({ ...current, utterances: original.utterances })
      // When the saved version is the original, loading it leaves nothing unsaved
      setDirty(current.edited === true)
      setActiveView('original')
    } catch (e) {
      if (useStore.getState().transcriptionId !== transcriptionId) return
      setSaveError(e instanceof ApiError && e.message ? e.message : t('editor.restoreFailed'))
    }
  }, [transcriptionId, setResult, setDirty, setActiveView, t])

  const handleSave = async () => {
    if (!transcriptionId || !result) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await api.saveTranscription(transcriptionId, result.utterances)
      const current = useStore.getState().transcriptionResult
      // Another transcription may have been opened while this one was saving
      if (current?.id !== transcriptionId) return
      setResult({ ...current, edited: saved.edited })
      setDirty(false)
      if (refinementMetadata) {
        // Staleness is decided server-side from the saved texts; refresh it so
        // the badge appears without a reload.
        api.getRefinement(transcriptionId).then((r) => {
          if (useStore.getState().transcriptionId === transcriptionId) setRefinementStale(r.stale)
        }).catch(() => {})
      }
    } catch (e) {
      if (useStore.getState().transcriptionId !== transcriptionId) return
      setSaveError(e instanceof ApiError && e.message ? e.message : t('editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleRefine = async () => {
    if (!transcriptionId) return
    setRefining(true)
    setRefineError(false)
    try {
      const refinementResult = await api.generateRefinement(transcriptionId, refineContext || undefined)
      setRefinedUtterances(refinementResult.utterances)
      setRefinementMetadata(refinementResult.metadata)
      setRefinementStale(refinementResult.stale)
      setActiveView('refined')
      setShowRefineModal(false)
      setRefineContext('')
    } catch {
      setRefineError(true)
    } finally {
      setRefining(false)
    }
  }

  const handleRetryFailedChunks = async () => {
    if (!transcriptionId) return
    setRetryingChunks(true)
    setRetryError(null)
    try {
      const refinementResult = await api.retryRefinement(transcriptionId)
      setRefinedUtterances(refinementResult.utterances)
      setRefinementMetadata(refinementResult.metadata)
      setRefinementStale(refinementResult.stale)
    } catch (e) {
      setRetryError(e instanceof ApiError && e.status === 409 ? 'stale' : 'generic')
    } finally {
      setRetryingChunks(false)
    }
  }

  const handleDeleteRefinement = async () => {
    if (!transcriptionId || !confirm(t('editor.confirmDeleteRefinement'))) return
    try {
      await api.deleteRefinement(transcriptionId)
      clearRefinement()
    } catch {
      console.error('Failed to delete refinement')
    }
  }

  // The server hands back a stored translation for the same language and source
  // unchanged (a request without a source matches any), so replacing an
  // out-of-date one has to be asked for explicitly.
  const replacesStaleTranslation = !!translatedUtterances
    && (translationStale || !translationSourceAvailable)
    && translateLanguage === translationLanguage
    && (!refinedUtterances || translateSource === translationSource)

  const handleTranslate = async () => {
    if (!transcriptionId) return
    setTranslating(true)
    setTranslateError(null)
    try {
      const translationResult = await api.translateTranscription(
        transcriptionId,
        translateLanguage,
        refinedUtterances ? translateSource : undefined,
        replacesStaleTranslation,
      )
      setTranslatedUtterances(translationResult.utterances)
      setTranslationLanguage(translationResult.language)
      setTranslationMetadata({
        source: translationResult.source,
        stale: translationResult.stale,
        sourceAvailable: translationResult.source_available,
      })
      setActiveView('translated')
      setShowTranslateModal(false)
    } catch (e) {
      setTranslateError(e instanceof ApiError && e.message ? e.message : t('editor.translationFailed'))
    } finally {
      setTranslating(false)
    }
  }

  const handleDeleteTranslation = async () => {
    if (!transcriptionId || !confirm(t('editor.confirmDeleteTranslation'))) return
    try {
      await api.deleteTranslation(transcriptionId)
      clearTranslation()
    } catch {
      console.error('Failed to delete translation')
    }
  }

  const baseUtterances = result?.utterances || []

  if (!utterances.length && !baseUtterances.length) return (
    <div className="flex items-center justify-center py-12 text-gray-400">
      {t('editor.noUtterances')}
    </div>
  )

  return (
    <div>
      {/* Search bar — pinned above scrollable area */}
      <div data-help="editor-search" className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
        <div className="relative flex-1">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') clearSearch() }}
            placeholder={t('editor.search.placeholder')}
            className="w-full bg-gray-700 text-gray-200 text-xs pl-7 pr-7 py-1.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => toggleScope('text')}
            className={`px-2 py-1 text-xs rounded ${searchScope === 'text' || searchScope === 'both' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >
            {t('editor.search.scopeText')}
          </button>
          <button
            onClick={() => toggleScope('speaker')}
            className={`px-2 py-1 text-xs rounded ${searchScope === 'speaker' || searchScope === 'both' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >
            {t('editor.search.scopeSpeaker')}
          </button>
        </div>
        {debouncedQuery && (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {t('editor.search.matchCount', { count: matchCount, total: utterances.length })}
          </span>
        )}
      </div>

      {/* Edit hint + shortcuts + Refinement / Translation toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 flex-wrap">
        <span className="hidden sm:inline text-gray-500 text-xs">{t('editor.editHint')}</span>
        <details className="hidden sm:block text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-400 select-none">
            {t('editor.hotkeyLegend')}
          </summary>
          <div className="mt-1.5 mb-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300 font-mono text-[10px]">Tab</kbd>
            <span>{t('editor.hotkeyTab')}</span>
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300 font-mono text-[10px]">Shift+Tab</kbd>
            <span>{t('editor.hotkeyShiftTab')}</span>
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300 font-mono text-[10px]">Esc</kbd>
            <span>{t('editor.hotkeyEscape')}</span>
          </div>
        </details>
        <div className="ml-auto flex items-center gap-2">
          <button
            data-help="speaker-names"
            onClick={() => { setFocusSpeaker(undefined); setSpeakerPanelOpen((open) => !open) }}
            className={`px-3 py-1 text-xs rounded border ${speakerPanelOpen ? 'bg-blue-600 text-white border-blue-500' : 'text-gray-300 border-gray-600 hover:text-white hover:border-gray-400'}`}
          >
            {t('editor.speakerNames')}
          </button>
          {saveError && (
            <span role="alert" className="text-xs text-red-400">{saveError}</span>
          )}
          {dirty && (
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="px-3 py-1 text-gray-400 text-xs rounded border border-gray-600 hover:text-white hover:border-gray-400 disabled:opacity-50"
            >
              {t('editor.discardChanges')}
            </button>
          )}
          {result?.edited && (
            <button
              onClick={handleRestoreOriginal}
              disabled={saving}
              className="px-3 py-1 text-gray-400 text-xs rounded border border-gray-600 hover:text-white hover:border-gray-400 disabled:opacity-50"
            >
              {t('editor.restoreOriginal')}
            </button>
          )}
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? t('common.loading') : t('editor.saveChanges')}
            </button>
          )}
        </div>
      </div>
      <SpeakerMapping
        isOpen={speakerPanelOpen}
        onClose={handleCloseSpeakerPanel}
        focusSpeaker={focusSpeaker}
      />
      {(llmAvailable || refinementMetadata || translatedUtterances) && (
      <div data-help="editor-versions" className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
        {llmAvailable && !refinementMetadata && (
          <button
            data-help="refine-open"
            onClick={openRefineDialog}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-amber-700/40 text-amber-300 border border-amber-700/50 rounded hover:bg-amber-700/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t('editor.refineTranscription')}
          </button>
        )}
        {llmAvailable && !translatedUtterances && (
          <button
            data-help="translate-open"
            onClick={openTranslateDialog}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-indigo-700/40 text-indigo-300 border border-indigo-700/50 rounded hover:bg-indigo-700/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            {t('editor.translate')}
          </button>
        )}
        {(refinementMetadata || translatedUtterances) && (
          <>
            <div data-help="editor-views" className="flex rounded overflow-hidden border border-gray-600">
              <button
                onClick={() => setActiveView('original')}
                className={`px-3 py-1 text-xs ${activeView === 'original' ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
              >
                {t('editor.viewOriginal')}
              </button>
              {refinementMetadata && (
                <button
                  data-help="view-refined"
                  onClick={() => setActiveView('refined')}
                  className={`px-3 py-1 text-xs ${activeView === 'refined' ? 'bg-amber-700/70 text-amber-200' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                >
                  {t('editor.viewRefined')}
                </button>
              )}
              {translatedUtterances && (
                <button
                  onClick={() => setActiveView('translated')}
                  className={`px-3 py-1 text-xs ${activeView === 'translated' ? 'bg-indigo-700/70 text-indigo-200' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                >
                  {t('editor.translated')}
                  {translationLanguage && ` (${translationLanguage.toUpperCase()}`}
                  {translationLanguage && translationSource && ` · ${translationSource === 'refined' ? t('editor.fromRefined') : t('editor.fromOriginal')}`}
                  {translationLanguage && ')'}
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {refinementMetadata && refinementStale && (
                <span
                  className="flex items-center gap-1 px-2 py-1 text-xs text-amber-400 border border-amber-700/40 rounded"
                  title={t('editor.refinementStale')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.635 19.364A9 9 0 0120 12" />
                  </svg>
                  {t('editor.refinementStale')}
                </span>
              )}
              {translatedUtterances && (translationStale || !translationSourceAvailable) && (
                <button
                  onClick={openTranslateDialog}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-amber-400 border border-amber-700/40 rounded hover:bg-amber-700/10"
                  title={!translationSourceAvailable ? t('editor.sourceMissing') : t('editor.sourceStale')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.635 19.364A9 9 0 0120 12" />
                  </svg>
                  {!translationSourceAvailable ? t('editor.sourceMissing') : t('editor.sourceStale')}
                </button>
              )}
              {translatedUtterances && (
                <button
                  onClick={handleDeleteTranslation}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-red-400 border border-gray-700 rounded hover:border-red-700/50"
                  title={t('editor.deleteTranslation')}
                >
                  {t('editor.deleteTranslation')}
                </button>
              )}
              {refinementMetadata && (
                <button
                  onClick={handleDeleteRefinement}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-red-400 border border-gray-700 rounded hover:border-red-700/50"
                  title={t('editor.deleteRefinement')}
                >
                  {t('editor.deleteRefinement')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {/* Changes summary banner */}
      {activeView === 'refined' && refinementMetadata && (
        <div data-help="refined-summary" className="px-3 py-2 bg-amber-900/20 border-b border-amber-700/30">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSummaryCollapsed(c => !c)}
              className="flex items-center gap-1.5 text-xs text-amber-400 font-medium"
            >
              <svg
                className={`w-3 h-3 transition-transform ${summaryCollapsed ? '-rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {t('editor.changesSummary')}
              <span className="text-amber-600 font-normal">
                ({refinementMetadata.changed_indices.length})
              </span>
            </button>
            {refinementMetadata.llm_provider && refinementMetadata.llm_model && (
              <span className="ml-auto text-xs text-gray-600">
                {refinementMetadata.llm_provider} / {refinementMetadata.llm_model}
              </span>
            )}
          </div>
          {refinementMetadata.failed_ranges.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-200/90">
              <span>
                {t('editor.refinementPartial', {
                  ranges: refinementMetadata.failed_ranges.map(formatUtteranceRange).join(', '),
                })}
              </span>
              <button
                onClick={handleRetryFailedChunks}
                disabled={retryingChunks}
                aria-busy={retryingChunks}
                className="px-2 py-0.5 rounded border border-amber-600/60 text-amber-300 hover:bg-amber-800/30 disabled:opacity-50"
              >
                {retryingChunks ? t('editor.retryingSections') : t('editor.retryFailedSections')}
              </button>
              {retryError && (
                <span role="status" className="text-red-400">
                  {t(retryError === 'stale' ? 'editor.retryStaleTranscript' : 'editor.retryFailed')}
                </span>
              )}
            </div>
          )}
          {!summaryCollapsed && (
            <div className="mt-1.5 space-y-1">
              <p className="text-xs text-amber-200/70">{refinementMetadata.changes_summary}</p>
              {refinementMetadata.context && (
                <p className="text-xs text-gray-500">
                  <span className="text-gray-600">{t('editor.changesContext')}: </span>
                  {refinementMetadata.context}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrollable subtitle table */}
      <div ref={containerRef} className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="hidden sm:table-header-group">
            <tr className="bg-gray-800 text-gray-400 text-xs">
              <th className="px-3 py-2 text-left w-10">#</th>
              <th className="px-2 py-2 text-left w-24">{t('editor.start')}</th>
              <th className="px-2 py-2 text-left w-24">{t('editor.end')}</th>
              <th className="px-2 py-2 text-left w-32">{t('editor.speaker')}</th>
              <th className="px-3 py-2 text-left">{t('editor.text')}</th>
            </tr>
          </thead>
          <tbody>
            {debouncedQuery && displayList.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-500 text-xs">
                  {t('editor.search.noMatches')}
                </td>
              </tr>
            ) : (
              displayList.map((entry, i) => {
                if (entry.type === 'separator') {
                  return (
                    <tr key={`sep-${i}`}>
                      <td colSpan={5} className="px-3 py-1 text-center text-gray-600 text-xs">
                        · · · {t('editor.search.hiddenSegments', { count: entry.hiddenCount })} · · ·
                      </td>
                    </tr>
                  )
                }
                return (
                  <SubtitleRow
                    key={entry.originalIndex}
                    ref={entry.originalIndex === activeIndex ? activeRef : undefined}
                    index={entry.originalIndex}
                    utterance={entry.utterance}
                    isActive={entry.originalIndex === activeIndex}
                    isContext={!entry.isMatch && !!debouncedQuery}
                    speakerMappings={speakerMappings}
                    onUpdate={handleUpdate}
                    onEditSpeaker={handleEditSpeaker}
                    speakerColorIndex={entry.utterance.speaker ? speakerColorMap[entry.utterance.speaker] : undefined}
                    highlightTerms={debouncedQuery || undefined}
                    highlightScope={searchScope}
                    isChanged={activeView === 'refined' && (refinementMetadata?.changed_indices.includes(entry.originalIndex) ?? false)}
                    isUnrefined={activeView === 'refined' && isInAnyRange(entry.originalIndex, refinementMetadata?.failed_ranges ?? [])}
                    originalText={activeView === 'refined' ? result?.utterances[entry.originalIndex]?.text : undefined}
                    readOnly={activeView === 'refined' || activeView === 'translated'}
                    editingField={editingCell?.index === entry.originalIndex ? editingCell.field : undefined}
                    onStartEditing={handleStartEditing}
                    onStopEditing={handleStopEditing}
                    onMergeWithNext={handleMergeWithNext}
                    onAddRow={handleAddRow}
                    onDeleteRow={handleDeleteRow}
                    isLast={entry.originalIndex === utterances.length - 1}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Refine modal */}
      {showRefineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div data-help="refine-dialog" className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
            <h3 className="text-sm font-medium text-gray-200 mb-3">{t('editor.refineTranscription')}</h3>
            <div data-help="refine-preset" className="mb-3">
              <PresetSelect
                presets={refinementPresets}
                selectedId={selectedRefinementPresetId}
                onSelect={handleLoadRefinementPreset}
                onSave={handleSaveRefinementPreset}
              />
            </div>
            <label data-help="refine-context-label" className="block text-xs text-gray-400 mb-1">{t('editor.refinementContext')}</label>
            <textarea
              data-help="refine-context"
              value={refineContext}
              onChange={(e) => setRefineContext(e.target.value)}
              placeholder={t('editor.refinementContextPlaceholder')}
              disabled={refining}
              rows={3}
              className="w-full bg-gray-700 text-gray-200 text-xs px-3 py-2 rounded border border-gray-600 focus:border-amber-500 focus:outline-none resize-none disabled:opacity-50"
            />
            {baseUtterances.length > 50 && (
              <p className="text-xs text-amber-400/80 mt-2">
                {t('editor.refinementWarningLong', { count: baseUtterances.length })}
              </p>
            )}
            {refineError && (
              <p role="alert" className="text-xs text-red-400 mt-2">{t('editor.refinementFailed')}</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowRefineModal(false); setRefineContext(''); setRefineError(false) }}
                disabled={refining}
                className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded hover:border-gray-500 hover:text-gray-200 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                data-help="refine-submit"
                onClick={handleRefine}
                disabled={refining}
                className="px-3 py-1.5 text-xs bg-amber-700/60 text-amber-200 border border-amber-700/50 rounded hover:bg-amber-700/80 disabled:opacity-50 flex items-center gap-1.5"
              >
                {refining && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {refining ? t('editor.refining') : t('editor.refine')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Translate modal */}
      {showTranslateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div data-help="translate-dialog" className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-sm mx-4 p-5">
            <h3 className="text-sm font-medium text-gray-200 mb-3">{t('editor.translateTo')}</h3>
            <label htmlFor="translation-language-field" className="block text-xs text-gray-400 mb-1">{t('editor.translationLanguage')}</label>
            <LanguageSelect
              id="translation-language-field"
              value={translateLanguage}
              onChange={setTranslateLanguage}
              disabled={translating}
              className="w-full bg-gray-700 text-gray-200 text-xs px-3 py-2 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
            {refinedUtterances && (
              <div data-help="translate-source" className="mt-3">
                <label className="block text-xs text-gray-400 mb-1">{t('editor.source')}</label>
                <div className="inline-flex rounded border border-gray-600 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setTranslateSource('original')}
                    disabled={translating}
                    className={`px-3 py-1 text-xs ${translateSource === 'original' ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                  >
                    {t('editor.sourceOriginal')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranslateSource('refined')}
                    disabled={translating}
                    className={`px-3 py-1 text-xs ${translateSource === 'refined' ? 'bg-indigo-700/70 text-indigo-200' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                  >
                    {t('editor.sourceRefined')}
                  </button>
                </div>
              </div>
            )}
            {baseUtterances.length > 50 && (
              <p className="text-xs text-indigo-400/80 mt-2">
                {t('editor.translationWarningLong', { count: baseUtterances.length })}
              </p>
            )}
            {replacesStaleTranslation && (
              <p className="text-xs text-amber-400 mt-2">{t('editor.translationReplacesStale')}</p>
            )}
            {translateError && (
              <p role="alert" className="text-xs text-red-400 mt-2">{translateError}</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowTranslateModal(false); setTranslateError(null) }}
                disabled={translating}
                className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded hover:border-gray-500 hover:text-gray-200 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                data-help="translate-submit"
                onClick={handleTranslate}
                disabled={translating}
                className="px-3 py-1.5 text-xs bg-indigo-700/60 text-indigo-200 border border-indigo-700/50 rounded hover:bg-indigo-700/80 disabled:opacity-50 flex items-center gap-1.5"
              >
                {translating && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {translating ? t('editor.translating') : t('editor.translate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
