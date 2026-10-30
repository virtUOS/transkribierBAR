import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'
import { ChapterCard } from '../SummaryView/ChapterCard'
import { ProtocolCard } from '../ProtocolView/ProtocolCard'
import { formatTime, downloadText, downloadMarkdown } from '../../utils/format'
import { analysisErrorMessage } from '../../utils/analysisError'
import { LanguageSelect } from '../LanguageSelect'
import { PresetSelect } from '../PresetSelect/PresetSelect'
import type { AnalysisTemplate, ChapterHint, SummaryChapter } from '../../api/types'

// Type guards for smart result detection
interface SummaryShape {
  summary: string
  chapters: SummaryChapter[]
  llm_provider?: string | null
  llm_model?: string | null
}

interface ProtocolShape {
  title: string
  participants: string[]
  key_points: Array<{ topic: string; speaker: string; timestamp: number | null; content: string }>
  decisions: Array<{ decision: string; timestamp: number | null }>
  action_items: Array<{ task: string; assignee: string; timestamp: number | null }>
  llm_provider?: string | null
  llm_model?: string | null
}

function isSummaryShape(result: unknown): result is SummaryShape {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  return typeof r.summary === 'string' && Array.isArray(r.chapters)
}

function isProtocolShape(result: unknown): result is ProtocolShape {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  return typeof r.title === 'string' && Array.isArray(r.key_points) && Array.isArray(r.decisions) && Array.isArray(r.action_items)
}

function formatResult(result: unknown, t: (key: string) => string, format: 'text' | 'markdown'): string {
  const md = format === 'markdown'

  if (isSummaryShape(result)) {
    let out = result.summary + '\n'
    if (result.chapters.length > 0) {
      out += '\n'
      result.chapters.forEach((ch, i) => {
        const times = `${formatTime(ch.start_time)} — ${formatTime(ch.end_time)}`
        out += md
          ? `### ${i + 1}. ${ch.title}\n*${times}*\n\n${ch.summary}\n\n`
          : `${i + 1}. ${ch.title} [${times}]\n${ch.summary}\n\n`
      })
    }
    return out.trimEnd()
  }

  if (isProtocolShape(result)) {
    let out = md
      ? `# ${t('editor.protocol')}: ${result.title}\n\n**${t('editor.participants')}:** ${result.participants.join(', ')}\n`
      : `${t('editor.protocol')}: ${result.title}\n${t('editor.participants')}: ${result.participants.join(', ')}\n`

    if (result.key_points.length > 0) {
      out += md ? `\n## ${t('editor.keyPoints')}\n\n` : `\n${t('editor.keyPoints').toUpperCase()}\n`
      result.key_points.forEach((kp, i) => {
        const ts = kp.timestamp !== null ? `[${formatTime(kp.timestamp)}] ` : ''
        out += md
          ? `${i + 1}. **${ts}${kp.speaker}** — ${kp.topic}\n   ${kp.content}\n\n`
          : `${i + 1}. ${ts}${kp.speaker} — ${kp.topic}\n   ${kp.content}\n\n`
      })
    }
    if (result.decisions.length > 0) {
      out += md ? `## ${t('editor.decisions')}\n\n` : `${t('editor.decisions').toUpperCase()}\n`
      result.decisions.forEach((d, i) => {
        const ts = d.timestamp !== null
          ? (md ? `**[${formatTime(d.timestamp)}]** ` : `[${formatTime(d.timestamp)}] `)
          : ''
        out += `${i + 1}. ${ts}${d.decision}\n\n`
      })
    }
    if (result.action_items.length > 0) {
      out += md ? `## ${t('editor.actionItems')}\n\n` : `${t('editor.actionItems').toUpperCase()}\n`
      result.action_items.forEach((ai, i) => {
        const ts = ai.timestamp !== null
          ? (md ? ` *(${formatTime(ai.timestamp)})*` : ` (${formatTime(ai.timestamp)})`)
          : ''
        out += md
          ? `- [ ] **${ai.assignee}** — ${ai.task}${ts}\n`
          : `${i + 1}. ${ai.assignee} — ${ai.task}${ts}\n\n`
      })
    }
    return out.trimEnd()
  }

  if (typeof result === 'string') return result
  return JSON.stringify(result, null, 2)
}

const resultToText = (result: unknown, t: (key: string) => string) => formatResult(result, t, 'text')
const resultToMarkdown = (result: unknown, t: (key: string) => string) => formatResult(result, t, 'markdown')

// Individual analysis card that loads its own data on expand
function AnalysisCard({ analysisId, transcriptionId, templates, baseName, onDelete }: {
  analysisId: string
  transcriptionId: string
  templates: AnalysisTemplate[]
  baseName: string
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const analyses = useStore((s) => s.analyses)
  const meta = analyses.find((a) => a.id === analysisId)
  const [expanded, setExpanded] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [loadingResult, setLoadingResult] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const translateTemplateName = (id: string) =>
    t(`analysis.template${id.charAt(0).toUpperCase()}${id.slice(1)}`,
      templates.find((tp) => tp.id === id)?.name ?? id)

  const templateLabel = meta?.template
    ? translateTemplateName(meta.template)
    : t('analysis.customPrompt')

  const handleToggle = async () => {
    if (!expanded && !result) {
      setLoadingResult(true)
      setError(null)
      try {
        const data = await api.getAnalysis(transcriptionId, analysisId)
        setResult(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load analysis')
      } finally {
        setLoadingResult(false)
      }
    }
    setExpanded((e) => !e)
  }

  const handleDelete = () => {
    if (!confirm(t('analysis.confirmDeleteAnalysis'))) return
    onDelete(analysisId)
  }

  const handleDeleteItem = async (field: string, index: number) => {
    if (!confirm(t('analysis.confirmDeleteItem'))) return
    try {
      const updated = await api.deleteAnalysisItem(transcriptionId, analysisId, field, index)
      setResult(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const copyIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
  )
  const checkIcon = (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
  )
  const downloadIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
  )

  const btnCopy = "px-4 py-1.5 text-sm rounded flex items-center gap-2 text-gray-300 bg-gray-700 hover:bg-gray-600"
  const btnDownload = "px-4 py-1.5 text-sm rounded flex items-center gap-2 text-white bg-green-700 hover:bg-green-600"

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header — always visible */}
      <div data-help="analysis-header" className="flex items-center gap-2 px-4 py-3 bg-gray-800/50 cursor-pointer hover:bg-gray-800" onClick={handleToggle}>
        <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span data-help="analysis-template" className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-purple-900/40 text-purple-300 border border-purple-700/50">
          {templateLabel}
        </span>
        {meta?.created_at && (
          <span className="text-xs text-gray-500">{new Date(meta.created_at).toLocaleDateString()}</span>
        )}
        {meta?.llm_model && (
          <span className="text-xs text-gray-600 ml-auto mr-2">{meta.llm_model}</span>
        )}
        <button
          data-help="analysis-delete"
          onClick={(e) => { e.stopPropagation(); handleDelete() }}
          className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
          title={t('analysis.delete')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="p-4 space-y-4">
          {loadingResult && (
            <div className="text-center text-gray-400 py-4">
              <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
            </div>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {!!result && (() => {
            const copyDownloadButtons = (extraClassName = '') => (
              <div data-help="analysis-actions" className={`flex justify-end gap-2 ${extraClassName}`.trim()}>
                <button data-help="analysis-copy" onClick={() => handleCopy(resultToText(result, t), 'all')} className={btnCopy}>
                  {copied === 'all' ? checkIcon : copyIcon}
                  {copied === 'all' ? t('editor.copied') : t('analysis.copyResult')}
                </button>
                <button onClick={() => downloadText(resultToText(result, t), `${baseName}_analysis.txt`)} className={btnDownload}>
                  {downloadIcon}
                  TXT
                </button>
                <button data-help="analysis-download-md" onClick={() => downloadMarkdown(resultToMarkdown(result, t), `${baseName}_analysis.md`)} className={btnDownload}>
                  {downloadIcon}
                  Markdown
                </button>
              </div>
            )
            return (
            <>
              {copyDownloadButtons()}

              {isSummaryShape(result) && (
                <>
                  <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{result.summary}</p>
                  </div>
                  {result.chapters.length > 0 && (
                    <div>
                      <h2 className="text-sm font-medium text-gray-400 mb-2">{t('editor.chapters')}</h2>
                      <div className="space-y-2">
                        {result.chapters.map((ch, i) => (
                          <ChapterCard key={i} chapter={ch} index={i} onDelete={() => handleDeleteItem('chapters', i)} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {isProtocolShape(result) && (
                <>
                  <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <h2 className="text-base font-medium text-white mb-1">{result.title}</h2>
                    <p className="text-xs text-gray-400">
                      {t('editor.participants')}: {result.participants.join(', ')}
                    </p>
                  </div>
                  {result.key_points.length > 0 && (
                    <div>
                      <h2 className="text-sm font-medium text-gray-400 mb-2">{t('editor.keyPoints')}</h2>
                      <div className="space-y-2">
                        {result.key_points.map((kp, i) => (
                          <ProtocolCard key={i} timestamp={kp.timestamp} label={`${kp.speaker} — ${kp.topic}`} description={kp.content} onDelete={() => handleDeleteItem('key_points', i)} />
                        ))}
                      </div>
                    </div>
                  )}
                  {result.decisions.length > 0 && (
                    <div>
                      <h2 className="text-sm font-medium text-gray-400 mb-2">{t('editor.decisions')}</h2>
                      <div className="space-y-2">
                        {result.decisions.map((d, i) => (
                          <ProtocolCard key={i} timestamp={d.timestamp} label={d.decision} description="" onDelete={() => handleDeleteItem('decisions', i)} />
                        ))}
                      </div>
                    </div>
                  )}
                  {result.action_items.length > 0 && (
                    <div>
                      <h2 className="text-sm font-medium text-gray-400 mb-2">{t('editor.actionItems')}</h2>
                      <div className="space-y-2">
                        {result.action_items.map((ai, i) => (
                          <ProtocolCard key={i} timestamp={ai.timestamp} label={ai.assignee} description={ai.task} onDelete={() => handleDeleteItem('action_items', i)} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!isSummaryShape(result) && !isProtocolShape(result) && (
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{resultToText(result, t)}</pre>
                </div>
              )}

              {copyDownloadButtons('pt-3 border-t border-gray-700')}

              {/* Model info + source */}
              {(() => {
                const r = result as Record<string, unknown>
                const source = r?.source as 'original' | 'refined' | undefined
                const stale = r?.stale as boolean | undefined
                const sourceAvailable = r?.source_available as boolean | undefined
                return (
                  <div className="flex items-center justify-end gap-3">
                    {source && (
                      <p className={`text-xs ${stale || sourceAvailable === false ? 'text-amber-400' : 'text-gray-500'}`}>
                        {source === 'refined' ? t('editor.fromRefined') : t('editor.fromOriginal')}
                        {stale && ` · ${t('editor.sourceStale')}`}
                        {sourceAvailable === false && ` · ${t('editor.sourceMissing')}`}
                      </p>
                    )}
                    {r?.llm_provider && r?.llm_model ? (
                      <p className="text-xs text-gray-500 text-right">
                        {t('editor.generatedWithModel', { provider: r.llm_provider, model: r.llm_model })}
                      </p>
                    ) : null}
                  </div>
                )
              })()}
            </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export function AnalysisView() {
  const { t } = useTranslation()
  const transcriptionId = useStore((s) => s.transcriptionId)
  const analyses = useStore((s) => s.analyses)
  const setAnalyses = useStore((s) => s.setAnalyses)
  const addAnalysis = useStore((s) => s.addAnalysis)
  const removeAnalysis = useStore((s) => s.removeAnalysis)
  const file = useStore((s) => s.file)
  const detectedLanguage = useStore((s) => s.transcriptionResult?.language)

  const analysisPresets = useStore((s) => s.analysisPresets)
  const setAnalysisPresets = useStore((s) => s.setAnalysisPresets)
  const bundles = useStore((s) => s.bundles)
  const activeBundleId = useStore((s) => s.activeBundleId)

  const refinedUtterances = useStore((s) => s.refinedUtterances)

  const [selectedAnalysisPresetId, setSelectedAnalysisPresetId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [language, setLanguage] = useState<string>(detectedLanguage || 'en')
  const [analysisSource, setAnalysisSource] = useState<'original' | 'refined'>(refinedUtterances ? 'refined' : 'original')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // A new refinement (or none) sets the source again, while rendering it
  const [sourceSetFor, setSourceSetFor] = useState(refinedUtterances)
  if (sourceSetFor !== refinedUtterances) {
    setSourceSetFor(refinedUtterances)
    setAnalysisSource(refinedUtterances ? 'refined' : 'original')
  }

  // Chapter hints (for summary template)
  const [hintsExpanded, setHintsExpanded] = useState(false)
  const [hints, setHints] = useState<ChapterHint[]>([])

  // Agenda (for agenda template)
  const [agenda, setAgenda] = useState('')

  const baseName = file?.original_filename?.replace(/\.[^.]+$/, '') || 'transcription'

  // Fetch templates and existing analyses on mount
  useEffect(() => {
    api.getAnalysisTemplates().then((tpls) => {
      setTemplates(tpls)
      if (tpls.length > 0 && !selectedTemplate) {
        setSelectedTemplate(tpls[0].id)
        setCustomPrompt(tpls[0].default_prompt)
      }
    }).catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (transcriptionId) {
      api.listAnalyses(transcriptionId).then(setAnalyses).catch(console.error)
    }
  }, [transcriptionId, setAnalyses])

  const currentTemplate = templates.find((tp) => tp.id === selectedTemplate)

  const translateTemplateName = (id: string) =>
    t(`analysis.template${id.charAt(0).toUpperCase()}${id.slice(1)}`,
      templates.find((tp) => tp.id === id)?.name ?? id)

  const handleSelectTemplate = useCallback((id: string | null) => {
    setSelectedTemplate(id)
    if (id === null) {
      setCustomPrompt('')
    } else {
      const tpl = templates.find((tp) => tp.id === id)
      if (tpl) setCustomPrompt(tpl.default_prompt)
    }
  }, [templates])

  const handleLoadAnalysisPreset = useCallback((presetId: string | null) => {
    setSelectedAnalysisPresetId(presetId)
    if (!presetId) return
    const preset = analysisPresets.find((p) => p.id === presetId)
    if (!preset) return
    setSelectedTemplate(preset.template)
    setCustomPrompt(preset.custom_prompt || '')
    setLanguage(preset.language || 'en')
    setHints(preset.chapter_hints || [])
    setAgenda(preset.agenda || '')
  }, [analysisPresets])

  const handleSaveAnalysisPreset = async (name: string) => {
    const preset = await api.createAnalysisPreset({
      name,
      template: selectedTemplate,
      custom_prompt: customPrompt || null,
      language,
      chapter_hints: hints.length > 0 ? hints : null,
      agenda: agenda || null,
    })
    setAnalysisPresets([...analysisPresets, preset])
    setSelectedAnalysisPresetId(preset.id)
  }

  // The active bundle's analysis preset fills the form once per bundle and preset, as soon as the
  // preset is loaded; a preset chosen or saved by hand afterwards stays selected.
  const bundlePresetId = bundles.find((b) => b.id === activeBundleId)?.analysis_preset_id ?? null
  const bundlePresetKey = bundlePresetId && analysisPresets.some((p) => p.id === bundlePresetId)
    ? `${activeBundleId}:${bundlePresetId}`
    : null
  const [appliedBundlePreset, setAppliedBundlePreset] = useState<string | null>(null)
  if (bundlePresetKey !== appliedBundlePreset) {
    setAppliedBundlePreset(bundlePresetKey)
    if (bundlePresetKey) handleLoadAnalysisPreset(bundlePresetId)
  }

  const handleResetPrompt = useCallback(() => {
    if (selectedTemplate) {
      const tpl = templates.find((tp) => tp.id === selectedTemplate)
      if (tpl) setCustomPrompt(tpl.default_prompt)
    } else {
      setCustomPrompt('')
    }
  }, [selectedTemplate, templates])

  const handleAddHint = useCallback(() => {
    if (hints.length >= 30) return
    setHints(prev => [...prev, { title: '', description: '' }])
  }, [hints.length])

  const handleRemoveHint = useCallback((index: number) => {
    setHints(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleHintChange = useCallback((index: number, field: 'title' | 'description', value: string) => {
    setHints(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h))
  }, [])

  const handleGenerate = async () => {
    if (!transcriptionId) return
    setLoading(true)
    setError(null)
    try {
      const validHints = hints.filter(h => h.title?.trim() || h.description?.trim())
        .map(h => ({
          ...(h.title?.trim() ? { title: h.title.trim() } : {}),
          ...(h.description?.trim() ? { description: h.description.trim() } : {}),
        }))

      const isCustom = selectedTemplate === null
      const promptChanged = currentTemplate && customPrompt !== currentTemplate.default_prompt

      const result = await api.generateAnalysis(transcriptionId, {
        template: isCustom ? null : selectedTemplate,
        custom_prompt: isCustom || promptChanged ? customPrompt : null,
        language,
        chapter_hints: selectedTemplate === 'summary' && validHints.length > 0 ? validHints : null,
        agenda: selectedTemplate === 'agenda' && agenda.trim() ? agenda.trim() : null,
        source: refinedUtterances ? analysisSource : null,
      }) as Record<string, unknown>

      // Add to the analyses list
      addAnalysis({
        id: result.id as string,
        template: (result.template as string) || null,
        language: (result.language as string) || null,
        llm_provider: (result.llm_provider as string) || null,
        llm_model: (result.llm_model as string) || null,
        source: (result.source as 'original' | 'refined') || null,
        created_at: new Date().toISOString(),
      })
      setShowForm(false)
    } catch (e) {
      setError(analysisErrorMessage(e, t))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAnalysis = async (analysisId: string) => {
    if (!transcriptionId) return
    setDeleteError(null)
    try {
      await api.deleteAnalysis(transcriptionId, analysisId)
      removeAnalysis(analysisId)
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : t('analysis.deleteFailed'))
    }
  }

  // Show the form automatically if there are no analyses
  const formVisible = showForm || analyses.length === 0

  // Loading state
  if (loading) {
    const generatingLabel = selectedTemplate
      ? translateTemplateName(selectedTemplate)
      : t('analysis.customPrompt')

    return (
      <div className="p-6 text-center text-gray-400">
        <div className="animate-spin h-6 w-6 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
        {t('analysis.generatingType', { type: generatingLabel })}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Existing analyses */}
      {analyses.length > 0 && (
        <div className="space-y-2">
          {deleteError && <p role="alert" className="text-red-400 text-sm">{deleteError}</p>}
          {analyses.map((a) => (
            <AnalysisCard
              key={a.id}
              analysisId={a.id}
              transcriptionId={transcriptionId!}
              templates={templates}
              baseName={baseName}
              onDelete={handleDeleteAnalysis}
            />
          ))}
        </div>
      )}

      {/* New analysis button — shown when form is not visible and analyses exist */}
      {!formVisible && (
        <button
          data-help="analysis-new"
          onClick={() => setShowForm(true)}
          className="w-full py-2.5 text-sm text-purple-400 hover:text-purple-300 border border-dashed border-gray-700 hover:border-purple-700 rounded-lg transition-colors"
        >
          {t('analysis.newAnalysis')}
        </button>
      )}

      {/* Generation form */}
      {formVisible && (
        <div className="space-y-4">
          {analyses.length > 0 && (
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-300">{t('analysis.newAnalysis')}</h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                {t('analysis.collapseForm')}
              </button>
            </div>
          )}

          {/* Preset selector */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('presets.analysis')}</label>
            <PresetSelect
              presets={analysisPresets}
              selectedId={selectedAnalysisPresetId}
              onSelect={handleLoadAnalysisPreset}
              onSave={handleSaveAnalysisPreset}
            />
          </div>

          {/* Template selector */}
          <div data-help="analysis-templates">
            <label className="block text-xs text-gray-400 mb-2">{t('analysis.selectTemplate')}</label>
            <div className="flex flex-wrap gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl.id)}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                    selectedTemplate === tpl.id
                      ? 'border-purple-500 bg-purple-900/40 text-purple-300'
                      : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                  }`}
                  title={tpl.description}
                >
                  {translateTemplateName(tpl.id)}
                </button>
              ))}
              <button
                onClick={() => handleSelectTemplate(null)}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  selectedTemplate === null
                    ? 'border-purple-500 bg-purple-900/40 text-purple-300'
                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('analysis.customPrompt')}
              </button>
            </div>
          </div>

          {/* Chapter hints — only for summary template */}
          {selectedTemplate === 'summary' && (
            <div data-help="analysis-chapters" className="border border-gray-700 rounded-lg">
              <button
                onClick={() => setHintsExpanded(!hintsExpanded)}
                className="w-full px-4 py-2.5 text-sm text-left text-gray-300 hover:bg-gray-800 rounded-lg flex items-center justify-between"
              >
                {t('editor.chapterHints')}
                <svg
                  className={`w-4 h-4 transition-transform ${hintsExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {hintsExpanded && (
                <div className="px-4 pb-4 space-y-2">
                  {hints.map((hint, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <input
                        type="text"
                        value={hint.title || ''}
                        onChange={(e) => handleHintChange(i, 'title', e.target.value)}
                        placeholder={t('editor.chapterTitle')}
                        className="flex-1 px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500"
                      />
                      <input
                        type="text"
                        value={hint.description || ''}
                        onChange={(e) => handleHintChange(i, 'description', e.target.value)}
                        placeholder={t('editor.chapterDescription')}
                        className="flex-1 px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500"
                      />
                      <button
                        onClick={() => handleRemoveHint(i)}
                        className="p-1.5 text-gray-400 hover:text-red-400"
                        title={t('editor.removeChapter')}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleAddHint}
                    disabled={hints.length >= 30}
                    className="text-sm text-purple-400 hover:text-purple-300 disabled:text-gray-600 disabled:cursor-not-allowed"
                  >
                    + {hints.length >= 30 ? t('editor.maxChaptersReached') : t('editor.addChapter')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Agenda textarea — only for agenda template */}
          {selectedTemplate === 'agenda' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('analysis.agenda')}</label>
              <textarea
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder={t('analysis.agendaPlaceholder')}
                rows={5}
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 resize-y"
              />
            </div>
          )}

          {/* Prompt editor (collapsible) */}
          <div data-help="analysis-prompt" className="border border-gray-700 rounded-lg">
            <button
              onClick={() => setPromptExpanded(!promptExpanded)}
              className="w-full px-4 py-2.5 text-sm text-left text-gray-300 hover:bg-gray-800 rounded-lg flex items-center justify-between"
            >
              {t('analysis.customizePrompt')}
              <svg
                className={`w-4 h-4 transition-transform ${promptExpanded ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {promptExpanded && (
              <div className="px-4 pb-4 space-y-2">
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 resize-y font-mono"
                />
                {selectedTemplate && (
                  <button
                    onClick={handleResetPrompt}
                    className="text-sm text-purple-400 hover:text-purple-300"
                  >
                    {t('analysis.resetPrompt')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Language selector + Source toggle + Generate button */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <div data-help="analysis-language">
              <label htmlFor="analysis-output-language-field" className="block text-xs text-gray-400 mb-1">{t('editor.outputLanguage')}</label>
              <LanguageSelect id="analysis-output-language-field" value={language} onChange={setLanguage} className="bg-gray-700 text-white text-sm rounded px-3 py-1.5" />
            </div>
            {refinedUtterances && (
              <div data-help="analysis-source">
                <label className="block text-xs text-gray-400 mb-1">{t('editor.source')}</label>
                <div className="inline-flex rounded border border-gray-600 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setAnalysisSource('original')}
                    className={`px-3 py-1.5 text-sm ${analysisSource === 'original' ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                  >
                    {t('editor.sourceOriginal')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalysisSource('refined')}
                    className={`px-3 py-1.5 text-sm ${analysisSource === 'refined' ? 'bg-purple-700/70 text-purple-200' : 'bg-gray-700 text-gray-400 hover:bg-gray-650'}`}
                  >
                    {t('editor.sourceRefined')}
                  </button>
                </div>
              </div>
            )}
            <button
              data-help="analysis-generate"
              onClick={handleGenerate}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 self-end"
            >
              {t('analysis.generate')}
            </button>
          </div>

          {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
        </div>
      )}
    </div>
  )
}
