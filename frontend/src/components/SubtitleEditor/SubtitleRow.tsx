import { useState, useRef, useEffect, useId, forwardRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { formatTime, formatTimeMs, parseTimestamp } from '../../utils/format'
import type { Utterance } from '../../api/types'

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  const queryLower = query.toLowerCase()
  return parts.map((part, i) =>
    part.toLowerCase() === queryLower
      ? <span key={i} className="bg-yellow-600/40 text-yellow-200 rounded px-0.5">{part}</span>
      : part
  )
}

const SPEAKER_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-lime-500',
  'bg-pink-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-yellow-500',
  'bg-sky-500',
  'bg-red-500',
  'bg-fuchsia-500',
  'bg-stone-400',
  'bg-blue-300',
  'bg-green-300',
]

interface Props {
  index: number
  utterance: Utterance
  isActive: boolean
  isContext?: boolean
  speakerMappings: Record<string, string>
  onUpdate: (index: number, field: keyof Utterance, value: string | number) => void
  onEditSpeaker?: (speakerId: string) => void
  speakerColorIndex?: number
  highlightTerms?: string
  highlightScope?: 'text' | 'speaker' | 'both'
  isChanged?: boolean
  isUnrefined?: boolean
  originalText?: string
  readOnly?: boolean
  editingField?: string
  onStartEditing?: (index: number, field?: string) => void
  onStopEditing?: () => void
  onMergeWithNext?: (index: number) => void
  onAddRow?: (afterIndex: number) => void
  onDeleteRow?: (index: number) => void
  isLast?: boolean
}

export const SubtitleRow = forwardRef<HTMLTableRowElement, Props>(function SubtitleRow({ index, utterance, isActive, isContext, speakerMappings, onUpdate, onEditSpeaker, speakerColorIndex, highlightTerms, highlightScope, isChanged, isUnrefined, originalText, readOnly, editingField, onStartEditing, onStopEditing, onMergeWithNext, onAddRow, onDeleteRow, isLast }, ref) {
  const { t } = useTranslation()
  const setSeekTo = useStore((s) => s.setSeekTo)
  const [editValue, setEditValue] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const diffId = useId()
  const [inlineText, setInlineText] = useState(utterance.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const delayedSeek = (time: number) => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { setSeekTo(time); clickTimer.current = null }, 250)
  }

  const cancelSeek = () => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null }
  }

  const speakerDisplay = utterance.speaker
    ? speakerMappings[utterance.speaker] || utterance.speaker
    : ''

  // Sync inlineText when utterance changes externally
  const [prevUtteranceText, setPrevUtteranceText] = useState(utterance.text)
  if (utterance.text !== prevUtteranceText) {
    setPrevUtteranceText(utterance.text)
    if (editingField !== 'text') {
      setInlineText(utterance.text)
    }
  }

  // Initialize editValue when a non-text field starts editing on this row
  const [prevEditingField, setPrevEditingField] = useState(editingField)
  if (editingField !== prevEditingField) {
    setPrevEditingField(editingField)
    if (editingField && editingField !== 'text') {
      if (editingField === 'start') setEditValue(formatTimeMs(utterance.start))
      else if (editingField === 'end') setEditValue(formatTimeMs(utterance.end))
      else if (editingField === 'speaker') setEditValue(speakerDisplay)
    }
  }

  // Auto-focus and auto-size textarea when entering text edit mode
  useEffect(() => {
    if (editingField === 'text' && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [editingField])

  // Auto-focus input when entering non-text edit mode
  useEffect(() => {
    if (editingField && editingField !== 'text' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  const commitInlineEdit = () => {
    if (inlineText !== utterance.text) {
      onUpdate(index, 'text', inlineText)
    }
  }

  const colorClass = speakerColorIndex !== undefined
    ? SPEAKER_COLORS[speakerColorIndex % SPEAKER_COLORS.length]
    : undefined

  const startEdit = (field: string, value: string) => {
    if (readOnly) return
    setEditValue(value)
    onStartEditing?.(index, field)
  }

  const commitEdit = (field: keyof Utterance) => {
    if (field === 'start' || field === 'end') {
      // Input that is not a time, or the same time, leaves the row as it was.
      const ms = parseTimestamp(editValue)
      if (ms !== null && ms !== utterance[field]) onUpdate(index, field, ms)
    } else {
      // The field opens with the display name, so leaving it unchanged must not
      // write that name over the speaker ID.
      if (field === 'speaker' && editValue === speakerDisplay) return
      onUpdate(index, field, editValue)
    }
  }

  const renderCell = (field: keyof Utterance, value: string, displayContent?: ReactNode, className?: string) => {
    if (editingField === field) {
      return (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => { commitEdit(field); onStopEditing?.() }}
          onKeyDown={(e) => e.key === 'Enter' && (commitEdit(field), onStopEditing?.())}
          onClick={(e) => e.stopPropagation()}
          className="bg-gray-600 text-white text-xs px-1 py-0.5 rounded w-full border border-blue-500 focus:outline-none"
          data-subtitle-input="true"
        />
      )
    }
    return (
      <span className={className || ''}>
        {displayContent ?? value}
      </span>
    )
  }

  return (
    <>
      <tr
        ref={ref}
        className={`group block sm:table-row border-b border-gray-700 text-xs ${isActive ? 'bg-blue-900/30' : 'hover:bg-gray-800'} ${isContext ? 'opacity-50' : ''} ${isChanged ? 'border-l-2 border-l-amber-500' : isUnrefined ? 'border-l-2 border-dashed border-l-gray-500' : ''}`}
      >
        <td data-help="row-number" className="hidden sm:table-cell px-3 py-2 text-gray-500">
          <span className="inline-flex items-center gap-0.5">
            {index + 1}
            {isChanged && (
              <span data-help="row-changed-dot" className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle" title={t('editor.utteranceChanged')} />
            )}
            {!isChanged && isUnrefined && (
              <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full border border-gray-500 align-middle" title={t('editor.unrefinedRow')} />
            )}
            {!readOnly && (
              <>
                {onAddRow && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAddRow(index) }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-gray-500 hover:text-green-400 shrink-0"
                    title={t('editor.addRow')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </span>
        </td>
        <td className="inline-block sm:table-cell px-2 py-2 sm:py-2 pt-2 pb-0 text-blue-400 cursor-pointer group" onClick={(e) => { e.stopPropagation(); delayedSeek(utterance.start) }}>
          <span className="inline-flex items-center gap-1">
            {renderCell('start', formatTime(utterance.start))}
            {!readOnly && editingField !== 'start' && (
              <button
                onClick={(e) => { e.stopPropagation(); cancelSeek(); startEdit('start', formatTimeMs(utterance.start)) }}
                className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400 shrink-0"
                title={t('editor.editTimestamp')}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </span>
        </td>
        <td className="inline-block sm:table-cell px-2 py-2 sm:py-2 pt-2 pb-0 text-blue-400 cursor-pointer group" onClick={(e) => { e.stopPropagation(); delayedSeek(utterance.end) }}>
          <span className="inline-flex items-center gap-1">
            {renderCell('end', formatTime(utterance.end))}
            {!readOnly && editingField !== 'end' && (
              <button
                onClick={(e) => { e.stopPropagation(); cancelSeek(); startEdit('end', formatTimeMs(utterance.end)) }}
                className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400 shrink-0"
                title={t('editor.editTimestamp')}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </span>
        </td>
        <td data-help="row-speaker" className="inline-block sm:table-cell px-2 py-2 sm:py-2 pt-2 pb-0 text-green-400 group cursor-pointer" onClick={(e) => { e.stopPropagation(); delayedSeek(utterance.start) }}>
          <span className="inline-flex items-center gap-1.5">
            {colorClass && editingField !== 'speaker' && (
              <span className={`inline-block w-2 h-2 rounded-full ${colorClass} shrink-0`} />
            )}
            {renderCell('speaker', speakerDisplay,
              highlightTerms && (highlightScope === 'speaker' || highlightScope === 'both')
                ? highlightText(speakerDisplay, highlightTerms)
                : undefined
            )}
            {utterance.speaker && !readOnly && editingField !== 'speaker' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); cancelSeek(); startEdit('speaker', speakerDisplay) }}
                  className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400 shrink-0"
                  title={t('editor.editSpeaker')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                {onEditSpeaker && (
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelSeek(); onEditSpeaker(utterance.speaker!) }}
                    className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400 shrink-0"
                    title={t('editor.renameAllSpeaker')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </span>
        </td>
        <td
          className="block sm:table-cell px-3 py-2 text-gray-200 break-words group cursor-pointer"
          onClick={(e) => { e.stopPropagation(); delayedSeek(utterance.start) }}
        >
          {editingField === 'text' && !readOnly ? (
            <textarea
              ref={textareaRef}
              value={inlineText}
              onChange={(e) => {
                setInlineText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              onBlur={() => { commitInlineEdit(); onStopEditing?.() }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-blue-500 focus:outline-none resize-none"
              data-subtitle-textarea="true"
              rows={1}
            />
          ) : (
            <span className="inline-flex items-start gap-1">
              <span className="flex-1">
                {highlightTerms && (highlightScope === 'text' || highlightScope === 'both')
                  ? highlightText(utterance.text, highlightTerms)
                  : utterance.text}
              </span>
              {isChanged && originalText !== undefined && (
                <button
                  type="button"
                  data-help="row-compare"
                  onClick={(e) => {
                    e.stopPropagation()
                    cancelSeek()
                    setShowDiff(d => !d)
                  }}
                  aria-expanded={showDiff}
                  aria-controls={diffId}
                  aria-label={t('editor.compareWithOriginal')}
                  title={t('editor.compareWithOriginal')}
                  className="shrink-0 mt-0.5 rounded border border-amber-700/50 px-1.5 py-0.5 text-amber-400 hover:bg-amber-900/30 aria-expanded:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
                >
                  {t('editor.compare')}
                </button>
              )}
              {!readOnly && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      cancelSeek()
                      onStartEditing?.(index, 'text')
                    }}
                    className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400 shrink-0 mt-0.5"
                    title={t('editor.editText')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  {!isLast && onMergeWithNext && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelSeek()
                        onMergeWithNext(index)
                      }}
                      className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-amber-400 shrink-0 mt-0.5"
                      title={t('editor.mergeWithNext')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                  {onAddRow && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddRow(index) }}
                      className="sm:hidden opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-green-400 shrink-0 mt-0.5"
                      title={t('editor.addRow')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                  {onDeleteRow && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm(t('editor.confirmDeleteRow'))) onDeleteRow(index) }}
                      className="opacity-60 hover:opacity-100 transition-opacity text-gray-500 hover:text-red-400 shrink-0 mt-0.5"
                      title={t('editor.deleteRow')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </span>
          )}
        </td>
      </tr>
      {isChanged && showDiff && originalText !== undefined && (
        <tr id={diffId} data-help="row-diff" className="bg-gray-800/50">
          <td colSpan={5} className="px-3 py-2">
            <div className="flex gap-4 text-xs">
              <div className="flex-1">
                <span className="text-gray-500 font-medium">{t('editor.originalText')}:</span>
                <p className="text-red-400/70 mt-0.5">{originalText}</p>
              </div>
              <div className="flex-1">
                <span className="text-gray-500 font-medium">{t('editor.refinedText')}:</span>
                <p className="text-green-400/70 mt-0.5">{utterance.text}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
})
