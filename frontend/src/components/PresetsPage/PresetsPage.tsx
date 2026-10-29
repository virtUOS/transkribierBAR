import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'
import { isLanguageEnabled } from '../../utils/languages'
import { resolveModel, singleConfiguredModel } from '../../utils/models'
import { LanguageOptions } from '../LanguageOptions'
import { SpeakerFields } from '../FileUpload/SpeakerFields'
import { PromptBudgetNote } from '../FileUpload/PromptBudgetNote'
import { isOverPromptBudget, usePromptBudget } from '../../hooks/usePromptBudget'
import type {
  TranscriptionPreset,
  TranscriptionPresetCreate,
  AnalysisPreset,
  AnalysisPresetCreate,
  RefinementPreset,
  RefinementPresetCreate,
  PresetBundle,
  PresetBundleCreate,
} from '../../api/types'

// ---------------------------------------------------------------------------
// TranscriptionPresetsList
// ---------------------------------------------------------------------------

function TranscriptionPresetsList() {
  const { t } = useTranslation()
  const config = useStore((s) => s.config)
  const presets = useStore((s) => s.transcriptionPresets)
  const setPresets = useStore((s) => s.setTranscriptionPresets)

  const emptyForm: TranscriptionPresetCreate = { name: '', language: null, model: '', min_speakers: 1, max_speakers: 2, initial_prompt: null, hotwords: null }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TranscriptionPresetCreate>(emptyForm)
  const [saving, setSaving] = useState(false)
  // Shown only while the form is the one the failed save was made with
  const [saveError, setSaveError] = useState<{ form: TranscriptionPresetCreate; message: string } | null>(null)
  const promptBudget = usePromptBudget(form.initial_prompt, form.hotwords)

  const models = config?.whisper_models ?? []
  const singleModel = singleConfiguredModel(models)
  const defaultModel = config?.default_model ?? ''
  const enabledLanguages = config?.enabled_languages ?? []
  const popularLanguages = config?.popular_languages ?? []

  const openNew = () => {
    setEditingId(null)
    setForm({ ...emptyForm, model: singleModel ?? defaultModel })
    setShowForm(true)
  }

  const openEdit = (p: TranscriptionPreset) => {
    setEditingId(p.id)
    const model = resolveModel(models, p.model)
    const language = p.language && !isLanguageEnabled(p.language, enabledLanguages) ? null : p.language
    setForm({
      name: p.name,
      language,
      model,
      min_speakers: p.min_speakers,
      max_speakers: p.max_speakers,
      initial_prompt: p.initial_prompt,
      hotwords: p.hotwords,
    })
    setShowForm(true)
  }

  const detectSpeakers = (form.min_speakers ?? 0) > 0 || (form.max_speakers ?? 0) > 0

  const handleSpeakerChange = (patch: { detectSpeakers?: boolean; minSpeakers?: number; maxSpeakers?: number }) => {
    if (patch.detectSpeakers === false) {
      setForm({ ...form, min_speakers: 0, max_speakers: 0 })
    } else if (patch.detectSpeakers === true) {
      setForm({ ...form, min_speakers: 1, max_speakers: 2 })
    } else {
      setForm({
        ...form,
        min_speakers: patch.minSpeakers ?? form.min_speakers,
        max_speakers: patch.maxSpeakers ?? form.max_speakers,
      })
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const updated = await api.updateTranscriptionPreset(editingId, form)
        setPresets(presets.map((p) => (p.id === editingId ? updated : p)))
      } else {
        const created = await api.createTranscriptionPreset(form)
        setPresets([...presets, created])
      }
      handleCancel()
    } catch (err) {
      console.error(err)
      const message = err instanceof ApiError && err.code === 'prompt_too_long'
        ? t('settings.promptBudget.rejected')
        : err instanceof Error ? err.message : String(err)
      setSaveError({ form, message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('presets.confirmDelete'))) return
    try {
      await api.deleteTranscriptionPreset(id)
      setPresets(presets.filter((p) => p.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="space-y-3">
      {presets.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm">{t('presets.noPresets')}</p>
      )}

      {presets.map((p) => (
        <div key={p.id} data-help="preset-card" className="bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-white truncate">{p.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {p.model}{p.language ? ` · ${t(`languages.${p.language}`, p.language)}` : ''}{p.hotwords ? ` · ${p.hotwords}` : ''}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button data-help="preset-edit" onClick={() => openEdit(p)} className="text-sm text-blue-400 hover:text-blue-300">
              {t('presets.edit')}
            </button>
            <button data-help="preset-delete" onClick={() => handleDelete(p.id)} className="text-sm text-red-400 hover:text-red-300">
              {t('presets.delete')}
            </button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('presets.namePlaceholder')}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="transcription-preset-language-field" className="block text-xs text-gray-400 mb-1">{t('settings.language')}</label>
            <select
              id="transcription-preset-language-field"
              value={form.language ?? ''}
              onChange={(e) => setForm({ ...form, language: e.target.value || null })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('languages.auto')}</option>
              <LanguageOptions enabled={enabledLanguages} popular={popularLanguages} />
            </select>
          </div>
          <div>
            <label htmlFor="transcription-preset-model-field" className="block text-xs text-gray-400 mb-1">
              {singleModel ? t('settings.modelName') : t('settings.model')}
            </label>
            {singleModel ? (
              <output id="transcription-preset-model-field" className="block w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5">
                {singleModel}
              </output>
            ) : (
              <select
                id="transcription-preset-model-field"
                value={form.model ?? defaultModel}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
              >
                {models.map((m) => {
                  const label = t(`settings.modelLabels.${m}`, '')
                  return <option key={m} value={m}>{label ? `${label} (${m})` : m}</option>
                })}
              </select>
            )}
          </div>
          <fieldset className="border border-gray-700 rounded px-3 pb-2 flex flex-wrap items-end gap-x-4">
            <legend className="text-xs text-gray-400 px-1">{t('settings.groups.speakers')}</legend>
            <SpeakerFields
              detectSpeakers={detectSpeakers}
              minSpeakers={form.min_speakers || 1}
              maxSpeakers={form.max_speakers || 2}
              onChange={handleSpeakerChange}
            />
          </fieldset>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('settings.hotwords')}</label>
            <input
              type="text"
              value={form.hotwords ?? ''}
              onChange={(e) => setForm({ ...form, hotwords: e.target.value || null })}
              placeholder={t('settings.hotwordsHelp')}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('settings.initialPrompt')}</label>
            <textarea
              value={form.initial_prompt ?? ''}
              onChange={(e) => setForm({ ...form, initial_prompt: e.target.value || null })}
              placeholder={t('settings.initialPromptHelp')}
              rows={2}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
            <PromptBudgetNote budget={promptBudget} />
          </div>
          {saveError?.form === form && <p className="text-xs text-red-400">{saveError.message}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={handleCancel} className="text-sm text-gray-400 hover:text-white px-3 py-1.5">
              {t('common.cancel')}
            </button>
            <button
              data-help="preset-save"
              onClick={handleSave}
              disabled={saving || !form.name.trim() || isOverPromptBudget(promptBudget)}
              className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-1.5"
            >
              {saving ? '…' : t('presets.save')}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button
          data-help="preset-new"
          onClick={openNew}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          + {t('presets.create')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AnalysisPresetsList
// ---------------------------------------------------------------------------

const ANALYSIS_TEMPLATES = ['summary', 'protocol', 'agenda', 'custom'] as const

function AnalysisPresetsList() {
  const { t } = useTranslation()
  const presets = useStore((s) => s.analysisPresets)
  const setPresets = useStore((s) => s.setAnalysisPresets)
  const enabledLanguages = useStore((s) => s.config?.enabled_languages) || []
  const popularLanguages = useStore((s) => s.config?.popular_languages) || []

  const emptyForm: AnalysisPresetCreate = { name: '', template: 'summary', custom_prompt: null, language: null }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AnalysisPresetCreate>(emptyForm)
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (p: AnalysisPreset) => {
    setEditingId(p.id)
    const language = p.language && !isLanguageEnabled(p.language, enabledLanguages) ? null : p.language
    setForm({
      name: p.name,
      template: p.template,
      custom_prompt: p.custom_prompt,
      language,
      chapter_hints: p.chapter_hints,
      agenda: p.agenda,
    })
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const updated = await api.updateAnalysisPreset(editingId, form)
        setPresets(presets.map((p) => (p.id === editingId ? updated : p)))
      } else {
        const created = await api.createAnalysisPreset(form)
        setPresets([...presets, created])
      }
      handleCancel()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('presets.confirmDelete'))) return
    try {
      await api.deleteAnalysisPreset(id)
      setPresets(presets.filter((p) => p.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const templateLabel = (tmpl: string | null) => {
    if (!tmpl) return t('analysis.customPrompt')
    if (tmpl === 'summary') return t('analysis.templateSummary')
    if (tmpl === 'protocol') return t('analysis.templateProtocol')
    if (tmpl === 'agenda') return t('analysis.templateAgenda')
    return tmpl
  }

  return (
    <div className="space-y-3">
      {presets.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm">{t('presets.noPresets')}</p>
      )}

      {presets.map((p) => (
        <div key={p.id} data-help="preset-card" className="bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-white truncate">{p.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {templateLabel(p.template)}{p.language ? ` · ${t(`languages.${p.language}`, p.language)}` : ''}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button data-help="preset-edit" onClick={() => openEdit(p)} className="text-sm text-blue-400 hover:text-blue-300">
              {t('presets.edit')}
            </button>
            <button data-help="preset-delete" onClick={() => handleDelete(p.id)} className="text-sm text-red-400 hover:text-red-300">
              {t('presets.delete')}
            </button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('presets.namePlaceholder')}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('analysis.selectTemplate')}</label>
            <select
              value={form.template ?? 'custom'}
              onChange={(e) => setForm({ ...form, template: e.target.value === 'custom' ? null : e.target.value })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              {ANALYSIS_TEMPLATES.map((tmpl) => (
                <option key={tmpl} value={tmpl}>{templateLabel(tmpl === 'custom' ? null : tmpl)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="analysis-preset-language-field" className="block text-xs text-gray-400 mb-1">{t('editor.outputLanguage')}</label>
            <select
              id="analysis-preset-language-field"
              value={form.language ?? ''}
              onChange={(e) => setForm({ ...form, language: e.target.value || null })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('languages.auto')}</option>
              <LanguageOptions enabled={enabledLanguages} popular={popularLanguages} />
            </select>
          </div>
          {(form.template === null || form.template === 'custom') && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('analysis.customizePrompt')}</label>
              <textarea
                value={form.custom_prompt ?? ''}
                onChange={(e) => setForm({ ...form, custom_prompt: e.target.value || null })}
                rows={3}
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={handleCancel} className="text-sm text-gray-400 hover:text-white px-3 py-1.5">
              {t('common.cancel')}
            </button>
            <button
              data-help="preset-save"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-1.5"
            >
              {saving ? '…' : t('presets.save')}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button data-help="preset-new" onClick={openNew} className="text-sm text-blue-400 hover:text-blue-300">
          + {t('presets.create')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RefinementPresetsList
// ---------------------------------------------------------------------------

function RefinementPresetsList() {
  const { t } = useTranslation()
  const presets = useStore((s) => s.refinementPresets)
  const setPresets = useStore((s) => s.setRefinementPresets)

  const emptyForm: RefinementPresetCreate = { name: '', context: null }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RefinementPresetCreate>(emptyForm)
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (p: RefinementPreset) => {
    setEditingId(p.id)
    setForm({ name: p.name, context: p.context })
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const updated = await api.updateRefinementPreset(editingId, form)
        setPresets(presets.map((p) => (p.id === editingId ? updated : p)))
      } else {
        const created = await api.createRefinementPreset(form)
        setPresets([...presets, created])
      }
      handleCancel()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('presets.confirmDelete'))) return
    try {
      await api.deleteRefinementPreset(id)
      setPresets(presets.filter((p) => p.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="space-y-3">
      {presets.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm">{t('presets.noPresets')}</p>
      )}

      {presets.map((p) => (
        <div key={p.id} data-help="preset-card" className="bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-white truncate">{p.name}</p>
            {p.context && <p className="text-xs text-gray-400 mt-0.5 truncate">{p.context}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button data-help="preset-edit" onClick={() => openEdit(p)} className="text-sm text-blue-400 hover:text-blue-300">
              {t('presets.edit')}
            </button>
            <button data-help="preset-delete" onClick={() => handleDelete(p.id)} className="text-sm text-red-400 hover:text-red-300">
              {t('presets.delete')}
            </button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('presets.namePlaceholder')}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('editor.refinementContext')}</label>
            <textarea
              value={form.context ?? ''}
              onChange={(e) => setForm({ ...form, context: e.target.value || null })}
              placeholder={t('editor.refinementContextPlaceholder')}
              rows={3}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={handleCancel} className="text-sm text-gray-400 hover:text-white px-3 py-1.5">
              {t('common.cancel')}
            </button>
            <button
              data-help="preset-save"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-1.5"
            >
              {saving ? '…' : t('presets.save')}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button data-help="preset-new" onClick={openNew} className="text-sm text-blue-400 hover:text-blue-300">
          + {t('presets.create')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BundlesList
// ---------------------------------------------------------------------------

function BundlesList() {
  const { t } = useTranslation()
  const bundles = useStore((s) => s.bundles)
  const setBundles = useStore((s) => s.setBundles)
  const activeBundleId = useStore((s) => s.activeBundleId)
  const setActiveBundleId = useStore((s) => s.setActiveBundleId)
  const transcriptionPresets = useStore((s) => s.transcriptionPresets)
  const analysisPresets = useStore((s) => s.analysisPresets)
  const refinementPresets = useStore((s) => s.refinementPresets)
  const enabledLanguages = useStore((s) => s.config?.enabled_languages) || []
  const popularLanguages = useStore((s) => s.config?.popular_languages) || []

  const emptyForm: PresetBundleCreate = { name: '', transcription_preset_id: null, analysis_preset_id: null, refinement_preset_id: null }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PresetBundleCreate>(emptyForm)
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (b: PresetBundle) => {
    setEditingId(b.id)
    const translateLanguage = b.translate_language && !isLanguageEnabled(b.translate_language, enabledLanguages)
      ? null
      : b.translate_language
    setForm({
      name: b.name,
      transcription_preset_id: b.transcription_preset_id,
      analysis_preset_id: b.analysis_preset_id,
      refinement_preset_id: b.refinement_preset_id,
      translate_language: translateLanguage,
    })
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const updated = await api.updateBundle(editingId, form)
        setBundles(bundles.map((b) => (b.id === editingId ? updated : b)))
      } else {
        const created = await api.createBundle(form)
        setBundles([...bundles, created])
      }
      handleCancel()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('presets.bundle.confirmDelete'))) return
    try {
      await api.deleteBundle(id)
      setBundles(bundles.filter((b) => b.id !== id))
      if (activeBundleId === id) setActiveBundleId(null)
    } catch (err) {
      console.error(err)
    }
  }

  const handleToggleDefault = async (b: PresetBundle) => {
    try {
      if (b.is_default) {
        await api.clearDefaultBundle()
        if (activeBundleId === b.id) setActiveBundleId(null)
        setBundles(bundles.map((x) => ({ ...x, is_default: false })))
      } else {
        await api.setDefaultBundle(b.id)
        setActiveBundleId(b.id)
        setBundles(bundles.map((x) => ({ ...x, is_default: x.id === b.id })))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const presetName = (
    list: { id: string; name: string }[],
    id: string | null
  ) => (id ? (list.find((p) => p.id === id)?.name ?? id) : null)

  return (
    <div className="space-y-3">
      {bundles.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm">{t('presets.noBundles')}</p>
      )}

      {bundles.map((b) => {
        const tpName = presetName(transcriptionPresets, b.transcription_preset_id)
        const apName = presetName(analysisPresets, b.analysis_preset_id)
        const rpName = presetName(refinementPresets, b.refinement_preset_id)
        const isDefault = b.is_default

        return (
          <div key={b.id} className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-white truncate">{b.name}</p>
                  {isDefault && (
                    <span className="text-xs bg-blue-900 text-blue-300 rounded px-1.5 py-0.5">
                      {t('presets.bundle.isDefault')}
                    </span>
                  )}
                </div>
                <div data-help="bundle-parts" className="flex flex-wrap gap-1.5 mt-1.5">
                  {tpName && (
                    <span className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5">
                      {t('presets.transcription')}: {tpName}
                    </span>
                  )}
                  {apName && (
                    <span className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5">
                      {t('presets.analysis')}: {apName}
                    </span>
                  )}
                  {rpName && (
                    <span className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5">
                      {t('presets.refinement')}: {rpName}
                    </span>
                  )}
                  {b.translate_language && (
                    <span className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5">
                      {t('editor.translate')}: {t(`languages.${b.translate_language}`, b.translate_language)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                <button
                  data-help="bundle-default"
                  onClick={() => handleToggleDefault(b)}
                  className={`text-sm ${isDefault ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-400 hover:text-yellow-400'}`}
                  title={isDefault ? t('presets.bundle.clearDefault') : t('presets.bundle.setDefault')}
                >
                  ★
                </button>
                <button onClick={() => openEdit(b)} className="text-sm text-blue-400 hover:text-blue-300">
                  {t('presets.edit')}
                </button>
                <button data-help="bundle-delete" onClick={() => handleDelete(b.id)} className="text-sm text-red-400 hover:text-red-300">
                  {t('presets.delete')}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {showForm && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('presets.namePlaceholder')}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div data-help="bundle-transcription">
            <label className="block text-xs text-gray-400 mb-1">{t('presets.bundle.selectTranscription')}</label>
            <select
              value={form.transcription_preset_id ?? ''}
              onChange={(e) => setForm({ ...form, transcription_preset_id: e.target.value || null })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('presets.bundle.none')}</option>
              {transcriptionPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.bundle.selectAnalysis')}</label>
            <select
              value={form.analysis_preset_id ?? ''}
              onChange={(e) => setForm({ ...form, analysis_preset_id: e.target.value || null })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('presets.bundle.none')}</option>
              {analysisPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.bundle.selectRefinement')}</label>
            <select
              value={form.refinement_preset_id ?? ''}
              onChange={(e) => setForm({ ...form, refinement_preset_id: e.target.value || null })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('presets.bundle.none')}</option>
              {refinementPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div data-help="bundle-translate">
            <label htmlFor="bundle-translate-language-field" className="block text-xs text-gray-400 mb-1">{t('presets.bundle.translateLanguage')}</label>
            <select
              id="bundle-translate-language-field"
              value={form.translate_language ?? ''}
              onChange={(e) => setForm({ ...form, translate_language: e.target.value || null })}
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('presets.bundle.none')}</option>
              <LanguageOptions enabled={enabledLanguages} popular={popularLanguages} />
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={handleCancel} className="text-sm text-gray-400 hover:text-white px-3 py-1.5">
              {t('common.cancel')}
            </button>
            <button
              data-help="preset-save"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-1.5"
            >
              {saving ? '…' : t('presets.save')}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button data-help="bundle-new" onClick={openNew} className="text-sm text-blue-400 hover:text-blue-300">
          + {t('presets.bundle.create')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PresetsPage
// ---------------------------------------------------------------------------

type Tab = 'transcription' | 'analysis' | 'refinement' | 'bundles'

export function PresetsPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('transcription')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'transcription', label: t('presets.transcription') },
    { key: 'analysis', label: t('presets.analysis') },
    { key: 'refinement', label: t('presets.refinement') },
    { key: 'bundles', label: t('presets.bundles') },
  ]

  return (
    <div data-help="presets-page" className="px-6 py-4">
      <h2 className="text-xl font-semibold text-white mb-4">{t('presets.title')}</h2>

      {/* Tab bar */}
      <div data-help="presets-tabs" className="flex gap-1 border-b border-gray-700 mb-5 overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] sm:[mask-image:none]">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            data-help={`presets-tab-${key}`}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === key
                ? 'text-white border-b-2 border-blue-400 -mb-px'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'transcription' && <TranscriptionPresetsList />}
      {activeTab === 'analysis' && <AnalysisPresetsList />}
      {activeTab === 'refinement' && <RefinementPresetsList />}
      {activeTab === 'bundles' && <BundlesList />}
    </div>
  )
}
