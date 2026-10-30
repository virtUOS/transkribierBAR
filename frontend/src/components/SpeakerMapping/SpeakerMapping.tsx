import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'

const SPEAKER_PLACEHOLDER_RE = /^SPEAKER_\d+$/

interface Props {
  isOpen: boolean
  onClose: () => void
  focusSpeaker?: string
}

interface Identity {
  key: string
  display: string
  ids: string[]
}

export function SpeakerMapping({ isOpen, onClose, focusSpeaker }: Props) {
  const { t } = useTranslation()
  const result = useStore((s) => s.transcriptionResult)
  const speakerMappings = useStore((s) => s.speakerMappings)
  const setSpeakerMappings = useStore((s) => s.setSpeakerMappings)
  const transcriptionId = useStore((s) => s.transcriptionId)

  // Group source speaker IDs by their current display name, so utterances
  // that already share a display name (whether via mapping or via in-row
  // rename) are represented as a single identity row. Renaming the row then
  // applies to every underlying source ID at once.
  const identities = useMemo<Identity[]>(() => {
    if (!result) return []
    const groups = new Map<string, string[]>()
    result.utterances.forEach((u) => {
      if (!u.speaker) return
      const display = speakerMappings[u.speaker] || u.speaker
      const ids = groups.get(display)
      if (ids) {
        if (!ids.includes(u.speaker)) ids.push(u.speaker)
      } else {
        groups.set(display, [u.speaker])
      }
    })
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([display, ids]) => ({ key: display, display, ids }))
  }, [result, speakerMappings])

  // Fresh edit state (always starts empty) — the current name is shown as a
  // placeholder, so pressing Apply without typing is a no-op instead of
  // renaming "Lars" to "Lars".
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [applyError, setApplyError] = useState<string | null>(null)

  // Reset draft edits whenever the dialog (re-)opens. Tracking the previous
  // value as state and adjusting during render is the React-recommended way
  // to derive state from a prop change without a redundant effect.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setEdits({})
      setApplyError(null)
    }
  }

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  useEffect(() => {
    if (!isOpen || !focusSpeaker) return
    const target = identities.find((i) => i.ids.includes(focusSpeaker))
    if (!target) return
    const el = inputRefs.current[target.key]
    if (!el) return
    requestAnimationFrame(() => {
      el.focus()
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [isOpen, focusSpeaker, identities])

  const customNames = useMemo(() => {
    const names = new Set<string>()
    identities.forEach((i) => {
      if (!SPEAKER_PLACEHOLDER_RE.test(i.display)) names.add(i.display)
    })
    return Array.from(names).sort()
  }, [identities])

  const handleApply = async () => {
    if (!transcriptionId) return
    const next = { ...speakerMappings }
    let changed = false
    for (const identity of identities) {
      const raw = edits[identity.key]
      if (raw === undefined) continue
      const trimmed = raw.trim()
      if (!trimmed) continue
      if (trimmed === identity.display) continue
      for (const id of identity.ids) {
        if (next[id] !== trimmed) {
          next[id] = trimmed
          changed = true
        }
      }
    }
    if (changed) {
      setApplyError(null)
      try {
        await api.updateSpeakers(transcriptionId, next)
      } catch (e) {
        // Keep the panel open with the typed names so the user can retry.
        setApplyError(e instanceof ApiError && e.message ? e.message : t('editor.speakerSaveFailed'))
        return
      }
      setSpeakerMappings(next)
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <section data-help="speaker-panel" className="mx-2 sm:mx-6 mb-4 bg-gray-800 rounded-lg p-3 sm:p-6">
      <h2 className="text-lg font-medium text-white mb-4">{t('editor.speakerNames')}</h2>
      <div className="space-y-3">
        {identities.map((identity) => {
          const isPlaceholder = SPEAKER_PLACEHOLDER_RE.test(identity.display)
          return (
            <div key={identity.key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
              <span className={`text-sm sm:w-32 sm:shrink-0 break-words ${isPlaceholder ? 'text-gray-500 italic' : 'text-gray-200 font-medium'}`}>
                {identity.display}
                {identity.ids.length > 1 && (
                  <span className="ml-2 text-xs text-gray-500 font-normal not-italic">
                    ({t('editor.speakerMergedCount', { count: identity.ids.length })})
                  </span>
                )}
              </span>
              <span className="hidden sm:inline text-gray-500">{'→'}</span>
              <input
                ref={(el) => { inputRefs.current[identity.key] = el }}
                value={edits[identity.key] ?? ''}
                onChange={(e) => setEdits((prev) => ({ ...prev, [identity.key]: e.target.value }))}
                placeholder={t('editor.speakerRenamePlaceholder')}
                list="speaker-name-suggestions"
                className="flex-1 min-w-0 bg-gray-700 text-white text-sm rounded px-3 py-1.5"
              />
            </div>
          )
        })}
      </div>
      <datalist id="speaker-name-suggestions">
        {customNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {identities.length === 0 && (
        <p className="text-gray-500 text-sm">{t('editor.noSpeakers')}</p>
      )}
      {identities.length > 1 && (
        <p className="text-gray-500 text-xs mt-3">{t('editor.speakerMergeHint')}</p>
      )}
      {applyError && (
        <p role="alert" className="text-xs text-red-400 mt-3">{applyError}</p>
      )}
      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-300 hover:text-white">
          {t('common.cancel')}
        </button>
        <button data-help="speaker-apply" onClick={handleApply} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500">
          {t('editor.apply')}
        </button>
      </div>
    </section>
  )
}
