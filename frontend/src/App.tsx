import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Header } from './components/Header'
import { FileUpload, SettingsPanel, SubmittedSummaryCard, TranscribeActionBar } from './components/FileUpload'
import type { SettingsPanelValues } from './components/FileUpload/SettingsPanel'
import { bundleSettings } from './components/FileUpload/presetSettings'
import type { SubmittedSummary } from './components/FileUpload'
import { TranscriptionProgressCard } from './components/ProgressBar'
import { TranscriptionList } from './components/TranscriptionList'
import { TabBar } from './components/TabBar'
import { useStore, setPopStateFlag } from './store'
import { api, ApiError } from './api/client'
import { useBeforeUnloadWarning } from './hooks/useBeforeUnloadWarning'
import { isOverPromptBudget, usePromptBudget } from './hooks/usePromptBudget'
import { LoadingFallback } from './components/LoadingFallback'
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary'
import { DetectedLanguage } from './components/DetectedLanguage'
import { InviteLanding } from './components/InviteLanding'
import { resolveModel } from './utils/models'
import { leaveMessages } from './utils/leaveMessages'
import { formatDate, parseServerDate } from './utils/format'
import { pipelineTargetToRun, releaseStatus, whileTranscriptionOpen } from './utils/pipelineTarget'

const RecorderPanel = lazy(() =>
  import('./components/Recorder').then((m) => ({ default: m.RecorderPanel }))
)
const MediaPlayer = lazy(() =>
  import('./components/MediaPlayer').then((m) => ({ default: m.MediaPlayer }))
)
const SubtitleEditor = lazy(() =>
  import('./components/SubtitleEditor').then((m) => ({ default: m.SubtitleEditor }))
)
const FormatViewer = lazy(() =>
  import('./components/FormatViewer').then((m) => ({ default: m.FormatViewer }))
)
const AnalysisView = lazy(() =>
  import('./components/AnalysisView').then((m) => ({ default: m.AnalysisView }))
)
const PresetsPage = lazy(() =>
  import('./components/PresetsPage/PresetsPage').then((m) => ({ default: m.PresetsPage }))
)
const SettingsPage = lazy(() =>
  import('./components/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const HelpDrawer = lazy(() =>
  import('./components/HelpDrawer').then((m) => ({ default: m.HelpDrawer }))
)

function BackButton() {
  const { t } = useTranslation()
  const setCurrentView = useStore((s) => s.setCurrentView)
  const confirmLeave = useStore((s) => s.confirmLeave)

  const handleClick = () => {
    if (!confirmLeave(leaveMessages(t))) return
    setCurrentView('archive')
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-6 py-2 text-sm text-gray-400 hover:text-white"
    >
      &larr; {t('nav.backToTranscriptions')}
    </button>
  )
}

export function DetailActions() {
  const { t, i18n } = useTranslation()
  const transcriptionId = useStore((s) => s.transcriptionId)
  const history = useStore((s) => s.transcriptionHistory)
  const setHistory = useStore((s) => s.setTranscriptionHistory)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const reset = useStore((s) => s.reset)
  const archiveExpiryHours = useStore((s) => s.config?.archive_expiry_hours)
  const [now] = useState(() => Date.now())

  // Ensure history is loaded (may not be if user navigated directly to detail)
  useEffect(() => {
    if (history.length === 0) {
      api.listTranscriptions().then(setHistory).catch(console.error)
    }
  }, [history.length, setHistory])

  const item = history.find((h) => h.id === transcriptionId)
  if (!item) return null

  const handleArchive = async () => {
    const currentHistory = useStore.getState().transcriptionHistory
    setHistory(currentHistory.map((h) =>
      h.id === item.id ? { ...h, archived: true, expires_at: new Date(Date.now() + (archiveExpiryHours ?? 180 * 24) * 60 * 60 * 1000).toISOString() } : h
    ))
    try {
      const result = await api.archiveTranscription(item.id)
      const updatedHistory = useStore.getState().transcriptionHistory
      setHistory(updatedHistory.map((h) =>
        h.id === item.id ? { ...h, archived: true, expires_at: result.expires_at } : h
      ))
    } catch {
      const revertHistory = useStore.getState().transcriptionHistory
      setHistory(revertHistory.map((h) =>
        h.id === item.id ? { ...h, archived: item.archived, expires_at: item.expires_at } : h
      ))
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('transcription.confirmDelete'))) return
    try {
      await api.deleteTranscription(item.id)
      setHistory(history.filter((h) => h.id !== item.id))
      reset()
      setCurrentView('archive')
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  return (
    <div className="px-6 mt-1 flex items-center gap-3 text-sm">
      {!item.archived ? (
        <button
          onClick={handleArchive}
          className="flex items-center gap-1 text-gray-400 hover:text-blue-400 transition-colors"
          title={t('transcription.archive')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {t('transcription.archive')}
        </button>
      ) : (
        <span className="flex items-center gap-1 text-blue-400 text-xs">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {t('transcription.archived')}
        </span>
      )}
      <button
        onClick={handleDelete}
        className="flex items-center gap-1 text-gray-400 hover:text-red-400 transition-colors"
        title={t('transcription.delete')}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        {t('transcription.delete')}
      </button>
      <span className={`text-xs ${parseServerDate(item.expires_at).getTime() - now < 24 * 60 * 60 * 1000 ? 'text-red-400' : 'text-gray-500'}`}>
        {t('transcription.expiresOn', { date: formatDate(item.expires_at, i18n.language) })}
      </span>
    </div>
  )
}

type PipelineStatus = { key: string; step: 'refine' | 'analyze' | 'translate'; params?: Record<string, string> }

function App() {
  const pathMatch = window.location.pathname.match(/\/invite\/([^/]+)$/)
  if (pathMatch) {
    return <InviteLanding token={pathMatch[1]} />
  }
  return <MainApp />
}

function MainApp() {
  const { t } = useTranslation()
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const file = useStore((s) => s.file)
  const resetAll = useStore((s) => s.reset)
  const uploading = useStore((s) => s.uploading)
  const currentView = useStore((s) => s.currentView)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const transcriptionId = useStore((s) => s.transcriptionId)
  const transcriptionStatus = useStore((s) => s.transcriptionStatus)
  const transcriptionTitle = useStore((s) => s.transcriptionTitle)
  const transcriptionResult = useStore((s) => s.transcriptionResult)
  const transcriptionHistory = useStore((s) => s.transcriptionHistory)
  const activeTab = useStore((s) => s.activeTab)
  const helpOpen = useStore((s) => s.helpOpen)
  const [playerCollapsed, setPlayerCollapsed] = useState(false)

  useBeforeUnloadWarning()

  const [settings, setSettings] = useState<SettingsPanelValues>({
    language: 'auto',
    model: config?.default_model || 'base',
    detectSpeakers: true,
    minSpeakers: 1,
    maxSpeakers: 2,
    initialPrompt: '',
    hotwords: '',
    selectedPresetId: null,
    showAdvanced: false,
  })

  const configModelApplied = useRef(false)
  useEffect(() => {
    if (!config || configModelApplied.current) return
    const models = config.whisper_models ?? []
    const model = resolveModel(models, config.default_model)
    if (!model) return
    configModelApplied.current = true
    // A preset loaded before the configuration arrived (the default bundle's) has chosen the model
    setSettings((s) => (s.selectedPresetId ? s : { ...s, model }))
  }, [config])

  const updateSettings = useCallback((patch: Partial<SettingsPanelValues>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])
  const promptBudget = usePromptBudget(settings.initialPrompt, settings.hotwords)

  const [pendingTranscription, setPendingTranscription] = useState(false)
  const [submittedSummary, setSubmittedSummary] = useState<SubmittedSummary | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [prevFileId, setPrevFileId] = useState(file?.id)
  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id)
    setPlayerCollapsed(false)
  }

  const bundles = useStore((s) => s.bundles)
  const activeBundleId = useStore((s) => s.activeBundleId)

  const setTranscriptionPresets = useStore((s) => s.setTranscriptionPresets)
  const setAnalysisPresets = useStore((s) => s.setAnalysisPresets)
  const setRefinementPresets = useStore((s) => s.setRefinementPresets)
  const setBundles = useStore((s) => s.setBundles)
  const setActiveBundleId = useStore((s) => s.setActiveBundleId)

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error)
    Promise.all([
      api.getTranscriptionPresets(),
      api.getAnalysisPresets(),
      api.getRefinementPresets(),
      api.getBundles(),
      api.getDefaultBundle(),
    ]).then(([tp, ap, rp, bundles, defaultBundle]) => {
      setTranscriptionPresets(tp)
      setAnalysisPresets(ap)
      setRefinementPresets(rp)
      setBundles(bundles)
      if (defaultBundle) {
        setActiveBundleId(defaultBundle.id)
        const patch = bundleSettings(defaultBundle, tp)
        if (patch) updateSettings(patch)
      }
    }).catch(console.error)
  }, [setConfig, setTranscriptionPresets, setAnalysisPresets, setRefinementPresets, setBundles, setActiveBundleId, updateSettings])

  // Track whether current navigation was triggered by browser back/forward
  const isPopStateNav = useRef(false)

  // Sync browser back/forward buttons with view state
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = useStore.getState()
      if (state.leaveReason()) {
        if (!state.confirmLeave(leaveMessages(t))) {
          // User declined — re-pin the current view so the back nav is undone.
          history.pushState({ view: state.currentView }, '', '')
          return
        }
      }
      setPopStateFlag(true)
      isPopStateNav.current = true
      setCurrentView(e.state?.view ?? 'archive')
      setPopStateFlag(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setCurrentView, t])

  // Update browser tab title based on current view
  useEffect(() => {
    if (currentView === 'detail' && file) {
      document.title = `${transcriptionTitle || file.original_filename} — ${t('title')}`
    } else {
      document.title = t('title')
    }
  }, [currentView, file, t, transcriptionTitle])

  const setRefinedUtterances = useStore((s) => s.setRefinedUtterances)
  const setRefinementMetadata = useStore((s) => s.setRefinementMetadata)
  const setRefinementStale = useStore((s) => s.setRefinementStale)
  const setActiveView = useStore((s) => s.setActiveView)
  const addAnalysis = useStore((s) => s.addAnalysis)
  const setTranslatedUtterances = useStore((s) => s.setTranslatedUtterances)
  const setTranslationLanguage = useStore((s) => s.setTranslationLanguage)
  const setTranslationMetadata = useStore((s) => s.setTranslationMetadata)
  const pipelineTargetRef = useRef(new Map<string, string>())
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null)
  const [pipelineErrors, setPipelineErrors] = useState<string[]>([])

  // Clear pipeline progress when a new transcription starts
  const [prevTranscriptionStatus, setPrevTranscriptionStatus] = useState(transcriptionStatus)
  if (transcriptionStatus !== prevTranscriptionStatus) {
    setPrevTranscriptionStatus(transcriptionStatus)
    if (transcriptionStatus && transcriptionStatus !== 'completed') {
      setPipelineStatus(null)
      setPipelineErrors([])
    }
  }

  // Auto-navigate to detail view when transcription completes
  useEffect(() => {
    if (isPopStateNav.current) {
      isPopStateNav.current = false
      return
    }
    if (transcriptionStatus === 'completed' && transcriptionResult && (currentView === 'upload' || currentView === 'record')) {
      setCurrentView('detail')
    }
  }, [transcriptionStatus, transcriptionResult, currentView, setCurrentView])

  // Auto-run refinement & analysis when the transcription submitted with a bundle completes
  useEffect(() => {
    const transcriptionId = useStore.getState().transcriptionId
    const target = pipelineTargetToRun(pipelineTargetRef.current, transcriptionId, transcriptionStatus, !!transcriptionResult)
    if (!target || !transcriptionId) return
    const bundle = useStore.getState().bundles.find((b) => b.id === target.bundleId)
    if (!bundle) return

    const refinementPresets = useStore.getState().refinementPresets
    const analysisPresets = useStore.getState().analysisPresets
    const hasRefinement = bundle.refinement_preset_id && refinementPresets.find((p) => p.id === bundle.refinement_preset_id)
    const hasAnalysis = bundle.analysis_preset_id && analysisPresets.find((p) => p.id === bundle.analysis_preset_id)
    const hasTranslation = bundle.translate_language

    if (!hasRefinement && !hasAnalysis && !hasTranslation) return
    pipelineTargetRef.current.delete(target.transcriptionId)

    const run = async () => {
      const errors: string[] = []
      // The user may open another transcription while the server-side steps run.
      const whenOpen = whileTranscriptionOpen(transcriptionId, () => useStore.getState().transcriptionId)
      // The status line is shared by overlapping runs, so a run clears only the status it set.
      let mine: PipelineStatus | null = null
      const releaseMine = () => setPipelineStatus((s) => releaseStatus(s, mine))
      const ifOpen = (write: () => void) => {
        if (!whenOpen(write)) releaseMine()
      }
      const showStatus = (status: PipelineStatus) => ifOpen(() => {
        mine = status
        setPipelineStatus(status)
      })

      if (hasRefinement) {
        showStatus({ key: 'editor.refining', step: 'refine' })
        try {
          const result = await api.generateRefinement(transcriptionId, hasRefinement.context || undefined)
          ifOpen(() => {
            setRefinedUtterances(result.utterances)
            setRefinementMetadata(result.metadata)
            setRefinementStale(result.stale)
            setActiveView('refined')
          })
        } catch (e) {
          errors.push(`${t('editor.refineTranscription')}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (hasAnalysis) {
        showStatus({ key: 'analysis.generating', step: 'analyze' })
        try {
          const result = await api.generateAnalysis(transcriptionId, {
            template: hasAnalysis.template,
            custom_prompt: hasAnalysis.custom_prompt,
            language: hasAnalysis.language,
            chapter_hints: hasAnalysis.chapter_hints,
            agenda: hasAnalysis.agenda,
          })
          const analysisResult = result as { id: string; template?: string; language?: string; llm_provider?: string; llm_model?: string; created_at?: string; source?: 'original' | 'refined' }
          ifOpen(() => addAnalysis({
            id: analysisResult.id,
            template: analysisResult.template || null,
            language: analysisResult.language || null,
            llm_provider: analysisResult.llm_provider || null,
            llm_model: analysisResult.llm_model || null,
            created_at: analysisResult.created_at || null,
            source: analysisResult.source || null,
          }))
        } catch (e) {
          errors.push(`${t('editor.analysis')}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (hasTranslation) {
        showStatus({ key: 'pipeline.translating', step: 'translate', params: { language: t(`languages.${hasTranslation}`) } })
        try {
          const result = await api.translateTranscription(transcriptionId, hasTranslation)
          ifOpen(() => {
            setTranslatedUtterances(result.utterances)
            setTranslationLanguage(result.language)
            setTranslationMetadata({
              source: result.source,
              stale: result.stale,
              sourceAvailable: result.source_available,
            })
          })
        } catch (e) {
          errors.push(`${t('editor.translate')}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      releaseMine()
      if (errors.length > 0) ifOpen(() => setPipelineErrors(errors))
    }

    run()
  }, [transcriptionStatus, transcriptionResult, setRefinedUtterances, setRefinementMetadata, setRefinementStale, setActiveView, addAnalysis, setTranslatedUtterances, setTranslationLanguage, setTranslationMetadata, t])

  const handleTranscribe = useCallback(async () => {
    const state = useStore.getState()
    const f = state.file
    const isUploading = state.uploading
    const bundleId = state.activeBundleId
    const bundleList = state.bundles
    const bundleName = bundleId ? bundleList.find((b) => b.id === bundleId)?.name : undefined
    const configuredModels = state.config?.whisper_models ?? []
    const model = resolveModel(configuredModels, settings.model)

    if (!f && !isUploading) return

    const summary: SubmittedSummary = {
      filename: f?.original_filename || t('transcription.statusUploading'),
      fileSize: f?.file_size || 0,
      model,
      language: settings.language === 'auto' ? null : settings.language,
      detectSpeakers: settings.detectSpeakers,
      minSpeakers: settings.minSpeakers,
      maxSpeakers: settings.maxSpeakers,
      bundleName,
    }
    setSubmittedSummary(summary)

    if (!f && isUploading) {
      setPendingTranscription(true)
      return
    }
    if (!f) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await api.startTranscription({
        file_id: f.id,
        language: settings.language === 'auto' ? null : settings.language,
        model,
        min_speakers: settings.detectSpeakers ? settings.minSpeakers : 0,
        max_speakers: settings.detectSpeakers ? settings.maxSpeakers : 0,
        initial_prompt: settings.initialPrompt || null,
        hotwords: settings.hotwords || null,
      })
      // Back/forward can reach this view without reset(); start from a clean editor state.
      useStore.getState().clearTranscriptionState()
      if (bundleId) pipelineTargetRef.current.set(result.id, bundleId)
      useStore.getState().setTranscriptionId(result.id)
      useStore.getState().setTranscriptionStatus(result.status)
      setPendingTranscription(false)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'prompt_too_long') {
        setSubmitError(t('settings.promptBudget.rejected'))
      } else {
        setSubmitError(e instanceof Error ? e.message : 'Transcription failed')
      }
      setPendingTranscription(false)
    } finally {
      setSubmitting(false)
    }
  }, [settings, t])

  useEffect(() => {
    if (pendingTranscription && file) {
      handleTranscribe()
    }
  }, [file, pendingTranscription, handleTranscribe])

  useEffect(() => {
    if (pendingTranscription && file && submittedSummary) {
      setSubmittedSummary({
        ...submittedSummary,
        filename: file.original_filename,
        fileSize: file.file_size,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when file lands while pending
  }, [file, pendingTranscription])

  const handleTryAgain = useCallback(() => {
    useStore.getState().setTranscriptionId(null)
    useStore.getState().setTranscriptionStatus(null)
    setPendingTranscription(false)
    setSubmitError(null)
    setSubmittedSummary(null)
  }, [])

  // A failed transcription opened from the overview: back to the settings for
  // its file, which is still on the server, to transcribe it again.
  const handleRetryFailed = useCallback(() => {
    const state = useStore.getState()
    state.clearTranscriptionState()
    state.setTranscriptionTitle(null)
    handleTryAgain()
    state.setCurrentView('upload')
  }, [handleTryAgain])

  const inSubmittedState =
    (transcriptionId !== null && transcriptionStatus !== 'completed')
    || pendingTranscription
    || submitError !== null
    || submitting

  const transcribeLabel = (() => {
    if (pendingTranscription || (uploading && !file)) {
      return t('transcription.transcribeWhenReady')
    }
    const activeBundle = bundles.find((b) => b.id === activeBundleId)
    const isPipeline =
      activeBundle && (activeBundle.analysis_preset_id || activeBundle.refinement_preset_id || activeBundle.translate_language)
    if (isPipeline) return t('transcription.runPipeline')
    return t('transcription.transcribe')
  })()

  const transcribeDisabled = (!file && !uploading) || submitting || isOverPromptBudget(promptBudget)

  useEffect(() => {
    if (currentView !== 'upload' && currentView !== 'record') {
      setPendingTranscription(false)
      setSubmittedSummary(null)
      setSubmitError(null)
      if (currentView !== 'detail') {
        const { transcriptionStatus: status } = useStore.getState()
        if (status !== null && status !== 'completed') {
          useStore.getState().setTranscriptionId(null)
          useStore.getState().setTranscriptionStatus(null)
        }
      }
    }
  }, [currentView])

  if (!config) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">{t('common.loading')}</div>

  const showEditor = transcriptionStatus === 'completed' && transcriptionResult

  return (
    <div className="min-h-screen bg-gray-900 text-white max-w-[1200px] mx-auto overflow-x-hidden">
      <Header />

      {currentView === 'archive' && (
        <TranscriptionList />
      )}

      {currentView === 'presets' && (
        <>
          <BackButton />
          <ChunkErrorBoundary errorMessage={t('common.loadError')} reloadLabel={t('common.reload')}>
            <Suspense fallback={<LoadingFallback />}>
              <PresetsPage />
            </Suspense>
          </ChunkErrorBoundary>
        </>
      )}

      {currentView === 'settings' && (
        <>
          <BackButton />
          <ChunkErrorBoundary errorMessage={t('common.loadError')} reloadLabel={t('common.reload')}>
            <Suspense fallback={<LoadingFallback />}>
              <SettingsPage />
            </Suspense>
          </ChunkErrorBoundary>
        </>
      )}

      {currentView === 'upload' && (
        <>
          <BackButton />
          {inSubmittedState ? (
            <>
              {submittedSummary && <SubmittedSummaryCard summary={submittedSummary} />}
              <TranscriptionProgressCard
                pendingTranscription={pendingTranscription}
                submitError={submitError}
                onTryAgain={handleTryAgain}
                autoLanguage={submittedSummary?.language === null}
              />
            </>
          ) : (
            <>
              <FileUpload />
              {(file || uploading) && !showEditor && (
                <SettingsPanel values={settings} onChange={updateSettings} promptBudget={promptBudget} />
              )}
              {(file || uploading) && !showEditor && (
                <TranscribeActionBar
                  onClick={handleTranscribe}
                  disabled={transcribeDisabled}
                  label={transcribeLabel}
                  submitting={submitting}
                  variant={pendingTranscription || (uploading && !file) ? 'pending' : 'primary'}
                  onDiscard={file ? async () => {
                    if (transcriptionId) {
                      try {
                        await api.deleteTranscription(transcriptionId)
                      } catch { /* ignore — reset still proceeds */ }
                    }
                    resetAll()
                  } : undefined}
                  discardLabel={t('recorder.discard')}
                />
              )}
            </>
          )}
        </>
      )}

      {currentView === 'record' && (
        <>
          <BackButton />
          {inSubmittedState ? (
            <>
              {submittedSummary && <SubmittedSummaryCard summary={submittedSummary} />}
              <TranscriptionProgressCard
                pendingTranscription={pendingTranscription}
                submitError={submitError}
                onTryAgain={handleTryAgain}
                autoLanguage={submittedSummary?.language === null}
              />
            </>
          ) : (
            <>
              <ChunkErrorBoundary errorMessage={t('common.loadError')} reloadLabel={t('common.reload')}>
                <Suspense fallback={<LoadingFallback />}>
                  <RecorderPanel />
                </Suspense>
              </ChunkErrorBoundary>
              {(file || uploading) && !showEditor && (
                <SettingsPanel values={settings} onChange={updateSettings} promptBudget={promptBudget} />
              )}
              {(file || uploading) && !showEditor && (
                <TranscribeActionBar
                  onClick={handleTranscribe}
                  disabled={transcribeDisabled}
                  label={transcribeLabel}
                  submitting={submitting}
                  variant={pendingTranscription || (uploading && !file) ? 'pending' : 'primary'}
                  onDiscard={file ? async () => {
                    if (transcriptionId) {
                      try {
                        await api.deleteTranscription(transcriptionId)
                      } catch { /* ignore — reset still proceeds */ }
                    }
                    resetAll()
                  } : undefined}
                  discardLabel={t('recorder.discard')}
                />
              )}
            </>
          )}
        </>
      )}

      {currentView === 'detail' && (
        <>
          <BackButton />
          {file && (
            <h1 data-help="detail-title" className="px-6 text-lg font-semibold text-white truncate">
              {transcriptionTitle || file.original_filename}
              {transcriptionTitle && (
                <span className="text-sm font-normal text-gray-500 ml-2">[{file.original_filename}]</span>
              )}
            </h1>
          )}
          <DetectedLanguage requested={transcriptionResult?.language} detected={transcriptionResult?.detected_language} />
          <DetailActions />
          <TranscriptionProgressCard
            onTryAgain={handleRetryFailed}
            autoLanguage={transcriptionHistory.find((h) => h.id === transcriptionId)?.language === null}
          />
          {pipelineStatus && (
            <div className={`mx-6 my-2 px-4 py-2 rounded-lg flex items-center gap-3 ${
              pipelineStatus.step === 'refine' ? 'bg-amber-900/30 border border-amber-700/50' :
              pipelineStatus.step === 'translate' ? 'bg-purple-900/30 border border-purple-700/50' :
              'bg-blue-900/30 border border-blue-700/50'
            }`}>
              <div className={`animate-spin h-4 w-4 border-2 border-t-transparent rounded-full shrink-0 ${
                pipelineStatus.step === 'refine' ? 'border-amber-400' :
                pipelineStatus.step === 'translate' ? 'border-purple-400' :
                'border-blue-400'
              }`} />
              <span className={`text-sm ${
                pipelineStatus.step === 'refine' ? 'text-amber-200' :
                pipelineStatus.step === 'translate' ? 'text-purple-200' :
                'text-blue-200'
              }`}>{t(pipelineStatus.key, pipelineStatus.params)}</span>
            </div>
          )}
          {pipelineErrors.length > 0 && (
            <div className="mx-6 my-2 px-4 py-2 bg-red-900/30 rounded-lg border border-red-700/50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-red-300 text-sm font-medium mb-1">{t('pipeline.errors')}</p>
                  {pipelineErrors.map((err, i) => (
                    <p key={i} className="text-red-400/80 text-xs">{err}</p>
                  ))}
                </div>
                <button
                  onClick={() => setPipelineErrors([])}
                  className="text-red-400 hover:text-red-300 text-sm shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {showEditor && file && (
            <ChunkErrorBoundary errorMessage={t('common.loadError')} reloadLabel={t('common.reload')}>
              <Suspense fallback={<LoadingFallback />}>
                <MediaPlayer
                  fileId={file.id}
                  mediaType={file.media_type}
                  hasVideo={file.has_video}
                  onCollapsedChange={setPlayerCollapsed}
                />
                <TabBar />

                <div data-help="detail-panel" className={`mx-6 my-2 ${!file.has_video || playerCollapsed ? 'max-h-[calc(100vh-14rem)]' : 'max-h-[calc(100vh-22rem)]'} overflow-auto`}>
                  {activeTab === 'subtitles' && <SubtitleEditor />}
                  {activeTab === 'analysis' && <AnalysisView />}
                  {['srt', 'vtt', 'json', 'txt'].includes(activeTab) && (
                    <FormatViewer format={activeTab} />
                  )}
                </div>
              </Suspense>
            </ChunkErrorBoundary>
          )}
        </>
      )}

      {helpOpen && (
        <Suspense fallback={null}>
          <HelpDrawer />
        </Suspense>
      )}
    </div>
  )
}

export default App
