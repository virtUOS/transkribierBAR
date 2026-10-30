import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface PresetItem {
  id: string
  name: string
}

interface PresetSelectProps {
  presets: PresetItem[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSave: (name: string) => void
  placeholder?: string
  hideDropdown?: boolean
  saveDisabled?: boolean
}

export function PresetSelect({ presets, selectedId, onSelect, onSave, placeholder, hideDropdown, saveDisabled = false }: PresetSelectProps) {
  const { t } = useTranslation()
  const [showSave, setShowSave] = useState(false)
  const [saveName, setSaveName] = useState('')

  const handleSave = () => {
    const trimmed = saveName.trim()
    if (!trimmed || saveDisabled) return
    onSave(trimmed)
    setSaveName('')
    setShowSave(false)
  }

  return (
    <div className="flex items-center gap-2">
      {!hideDropdown && (
        <select
          value={selectedId || ''}
          onChange={(e) => onSelect(e.target.value || null)}
          className="bg-gray-700 text-white text-sm rounded px-3 py-1.5 min-w-[140px]"
        >
          <option value="">{placeholder || t('presets.selectPreset')}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {showSave ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSave(false) }}
            placeholder={t('presets.namePlaceholder')}
            className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-36"
            autoFocus
          />
          <button onClick={handleSave} disabled={saveDisabled} className="text-green-400 hover:text-green-300 disabled:opacity-50 text-sm px-1">
            ✓
          </button>
          <button onClick={() => setShowSave(false)} className="text-gray-400 hover:text-gray-300 text-sm px-1">
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSave(true)}
          disabled={saveDisabled}
          className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {t('presets.saveAs')}
        </button>
      )}
    </div>
  )
}
