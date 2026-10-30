import { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { api } from '../../api/client'
import { formatDate } from '../../utils/format'
import type { TranscriptionListItem } from '../../api/types'

function PencilButton({ onClick, title }: { onClick: (e: React.MouseEvent) => void; title: string }) {
  return (
    <button
      onClick={onClick}
      className="text-gray-500 hover:text-gray-300 p-0.5 flex-shrink-0"
      title={title}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  )
}

export function TranscriptionList() {
  const { t, i18n } = useTranslation()
  const history = useStore((s) => s.transcriptionHistory)
  const setHistory = useStore((s) => s.setTranscriptionHistory)
  const setTranscriptionId = useStore((s) => s.setTranscriptionId)
  const setTranscriptionTitle = useStore((s) => s.setTranscriptionTitle)
  const setTranscriptionStatus = useStore((s) => s.setTranscriptionStatus)
  const setResult = useStore((s) => s.setTranscriptionResult)
  const setSpeakerMappings = useStore((s) => s.setSpeakerMappings)
  const setFile = useStore((s) => s.setFile)
  const setRefinedUtterances = useStore((s) => s.setRefinedUtterances)
  const setRefinementMetadata = useStore((s) => s.setRefinementMetadata)
  const setRefinementStale = useStore((s) => s.setRefinementStale)
  const clearRefinement = useStore((s) => s.clearRefinement)
  const setTranslatedUtterances = useStore((s) => s.setTranslatedUtterances)
  const setTranslationLanguage = useStore((s) => s.setTranslationLanguage)
  const setTranslationMetadata = useStore((s) => s.setTranslationMetadata)
  const clearTranslation = useStore((s) => s.clearTranslation)
  const setCurrentView = useStore((s) => s.setCurrentView)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editingField, setEditingField] = useState<'title' | 'filename' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.listTranscriptions().then(setHistory).catch(console.error)
  }, [setHistory])

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const reset = useStore((s) => s.reset)
  const clearTranscriptionState = useStore((s) => s.clearTranscriptionState)

  const doSelect = useCallback(async (item: TranscriptionListItem) => {
    clearTranscriptionState()
    setTranscriptionId(item.id)
    setTranscriptionTitle(item.title || null)
    setTranscriptionStatus(item.status)
    const ext = item.original_filename.split('.').pop()?.toLowerCase() || ''
    setFile({ id: item.file_id, original_filename: item.original_filename, media_type: ext, file_size: item.file_size, has_video: item.has_video })
    setCurrentView('detail')
    // Another transcription may have been opened while a request was in flight.
    const isCurrent = () => useStore.getState().transcriptionId === item.id
    if (item.status === 'completed') {
      try {
        const result = await api.getTranscription(item.id)
        if (!isCurrent()) return
        setResult(result)
        setSpeakerMappings(result.speaker_mappings || {})
        try {
          const refinement = await api.getRefinement(item.id)
          if (!isCurrent()) return
          setRefinedUtterances(refinement.utterances)
          setRefinementMetadata(refinement.metadata)
          setRefinementStale(refinement.stale)
        } catch {
          if (!isCurrent()) return
          clearRefinement()
        }
        try {
          const translation = await api.getTranslation(item.id)
          if (!isCurrent()) return
          setTranslatedUtterances(translation.utterances)
          setTranslationLanguage(translation.language)
          setTranslationMetadata({
            source: translation.source,
            stale: translation.stale,
            sourceAvailable: translation.source_available,
          })
        } catch {
          if (!isCurrent()) return
          clearTranslation()
        }
      } catch {
        if (!isCurrent()) return
        reset()
        const currentHistory = useStore.getState().transcriptionHistory
        setHistory(currentHistory.filter((h) => h.id !== item.id))
      }
    }
  }, [clearTranscriptionState, setTranscriptionId, setTranscriptionTitle, setTranscriptionStatus, setFile, setCurrentView, setResult, setSpeakerMappings, setRefinedUtterances, setRefinementMetadata, setRefinementStale, clearRefinement, setTranslatedUtterances, setTranslationLanguage, setTranslationMetadata, clearTranslation, reset, setHistory])

  const handleClick = useCallback((item: TranscriptionListItem) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      doSelect(item)
    }, 250)
  }, [doSelect])

  const handleEditStart = useCallback((e: React.MouseEvent, item: TranscriptionListItem, field: 'title' | 'filename') => {
    e.stopPropagation()
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    if (field === 'filename') {
      const baseName = item.original_filename.replace(/\.[^.]+$/, '')
      setEditValue(baseName)
    } else {
      setEditValue(item.title || '')
    }
    setEditingId(item.id)
    setEditingField(field)
  }, [])

  const handleEditSave = useCallback(async (item: TranscriptionListItem) => {
    if (savingRef.current) return
    if (editingId !== item.id) return

    const trimmed = editValue.trim()
    const field = editingField
    setEditingId(null)
    setEditingField(null)

    if (!trimmed) return

    if (field === 'filename') {
      const ext = item.original_filename.includes('.')
        ? '.' + item.original_filename.split('.').pop()
        : ''
      const oldFilename = item.original_filename
      const newFilename = trimmed + ext

      if (newFilename === oldFilename) return

      const currentHistory = useStore.getState().transcriptionHistory
      setHistory(currentHistory.map((h) =>
        h.id === item.id ? { ...h, original_filename: newFilename } : h
      ))
      const currentFile = useStore.getState().file
      if (currentFile && currentFile.id === item.file_id) {
        setFile({ ...currentFile, original_filename: newFilename })
      }

      savingRef.current = true
      try {
        await api.renameFile(item.file_id, trimmed)
      } catch {
        const currentHistory = useStore.getState().transcriptionHistory
        setHistory(currentHistory.map((h) =>
          h.id === item.id ? { ...h, original_filename: oldFilename } : h
        ))
        const currentFile = useStore.getState().file
        if (currentFile && currentFile.id === item.file_id) {
          setFile({ ...currentFile, original_filename: oldFilename })
        }
      } finally {
        savingRef.current = false
      }
    } else if (field === 'title') {
      const oldTitle = item.title
      if (trimmed === oldTitle) return

      const currentHistory = useStore.getState().transcriptionHistory
      setHistory(currentHistory.map((h) =>
        h.id === item.id ? { ...h, title: trimmed } : h
      ))

      savingRef.current = true
      try {
        await api.renameTitle(item.id, trimmed)
      } catch {
        const currentHistory = useStore.getState().transcriptionHistory
        setHistory(currentHistory.map((h) =>
          h.id === item.id ? { ...h, title: oldTitle } : h
        ))
      } finally {
        savingRef.current = false
      }
    }
  }, [editValue, editingId, editingField, setHistory, setFile])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, item: TranscriptionListItem) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleEditSave(item)
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditingField(null)
    }
  }, [handleEditSave])

  const supportsRecording = typeof MediaRecorder !== 'undefined'

  return (
    <div data-help="archive" className="mx-6 my-4">
      <div className="flex items-center gap-3 mb-4">
        <button
          data-help="new-upload"
          onClick={() => { reset(); setCurrentView('upload') }}
          className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          + {t('nav.newUpload')}
        </button>
        {supportsRecording && (
          <button
            data-help="new-recording"
            onClick={() => { reset(); setCurrentView('record') }}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            + {t('nav.newRecording')}
          </button>
        )}
      </div>

      {history.length > 0 && (
        <>
      <h2 className="text-sm font-medium text-gray-400 mb-2">{t('transcription.history')}</h2>
      <div className="space-y-1">
        {history.map((item) => (
          <div
            key={item.id}
            onClick={() => handleClick(item)}
            className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm text-left cursor-pointer"
          >
            {editingId === item.id ? (
              <span className="flex items-center gap-1 min-w-0 sm:flex-1" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleEditSave(item)}
                  onKeyDown={(e) => handleRenameKeyDown(e, item)}
                  className="bg-gray-700 text-gray-200 px-1 py-0 rounded text-sm flex-1 min-w-0 outline-none focus:ring-1 focus:ring-blue-500"
                />
                {editingField === 'filename' && (
                  <span className="text-gray-500 text-xs">{item.original_filename.includes('.') ? '.' + item.original_filename.split('.').pop() : ''}</span>
                )}
              </span>
            ) : (
              <span className="min-w-0 sm:flex-1">
                {item.title ? (
                  <>
                    <span data-help="archive-title" className="flex items-center gap-1">
                      <span className="text-gray-300 truncate">{item.title}</span>
                      <PencilButton onClick={(e) => handleEditStart(e, item, 'title')} title={t('transcription.editTitle')} />
                    </span>
                    <span data-help="archive-filename" className="flex items-center gap-1">
                      <span className="text-xs text-gray-500 truncate">{item.original_filename}</span>
                      <PencilButton onClick={(e) => handleEditStart(e, item, 'filename')} title={t('transcription.editFilename')} />
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1">
                    <span className="text-gray-300 truncate">{item.original_filename}</span>
                    <PencilButton onClick={(e) => handleEditStart(e, item, 'filename')} title={t('transcription.editFilename')} />
                  </span>
                )}
              </span>
            )}
            <div data-help="archive-meta" className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-500 text-xs">{item.model}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                item.status === 'completed' ? 'bg-green-900 text-green-300' :
                item.status === 'failed' ? 'bg-red-900 text-red-300' :
                'bg-yellow-900 text-yellow-300'
              }`}>
                {t(`transcription.status.${item.status}`, item.status)}
              </span>
              <span className="text-gray-500 text-xs">
                {formatDate(item.created_at, i18n.language)}
              </span>
              {item.archived && (
                <span className="text-xs text-blue-400" title={t('transcription.archived')}>
                  <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
        </>
      )}

      {history.length === 0 && (
        <div className="mt-6 px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg flex items-center justify-between gap-4">
          <span className="text-sm text-gray-400">
            {t('help.emptyStateHint')}
          </span>
          <button
            type="button"
            onClick={() => useStore.getState().setHelpOpen(true, 'getting-started')}
            className="text-sm text-blue-400 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
          >
            {t('help.emptyStateLink')} →
          </button>
        </div>
      )}
    </div>
  )
}
