import { create } from 'zustand'
import i18n from '../i18n'
import { ApiError, AssistantStreamError, streamAssistantChat } from '../api/client'
import type { FileInfo, TranscriptionResult, TranscriptionListItem, ConfigResponse, Utterance, RefinementMetadata, AnalysisListItem, TranscriptionPreset, AnalysisPreset, RefinementPreset, PresetBundle, UtteranceSource, AssistantMessage } from '../api/types'

export type LeaveReason = 'upload' | 'recording' | 'unsavedEdits'

export type AppView = 'archive' | 'upload' | 'record' | 'detail' | 'presets' | 'settings'

interface AppState {
  currentView: AppView
  setCurrentView: (view: AppView) => void
  config: ConfigResponse | null
  setConfig: (config: ConfigResponse) => void
  file: FileInfo | null
  setFile: (file: FileInfo | null) => void
  uploading: boolean
  setUploading: (uploading: boolean) => void
  uploadAbortController: AbortController | null
  setUploadAbortController: (controller: AbortController | null) => void
  recordingActive: boolean
  setRecordingActive: (active: boolean) => void
  leaveReason: () => LeaveReason | null
  confirmLeave: (messages: Record<LeaveReason, string>) => boolean
  transcriptionId: string | null
  transcriptionTitle: string | null
  transcriptionStatus: string | null
  transcriptionResult: TranscriptionResult | null
  setTranscriptionId: (id: string | null) => void
  setTranscriptionTitle: (title: string | null) => void
  setTranscriptionStatus: (status: string | null) => void
  setTranscriptionResult: (result: TranscriptionResult | null) => void
  speakerMappings: Record<string, string>
  setSpeakerMappings: (mappings: Record<string, string>) => void
  transcriptionHistory: TranscriptionListItem[]
  setTranscriptionHistory: (list: TranscriptionListItem[]) => void
  currentTime: number
  setCurrentTime: (time: number) => void
  seekTo: number | null
  setSeekTo: (time: number | null) => void
  activeTab: string
  setActiveTab: (tab: string) => void
  unsavedEdits: boolean
  setUnsavedEdits: (dirty: boolean) => void
  refinedUtterances: Utterance[] | null
  refinementMetadata: RefinementMetadata | null
  activeView: 'original' | 'refined' | 'translated'
  setRefinedUtterances: (utterances: Utterance[] | null) => void
  setRefinementMetadata: (metadata: RefinementMetadata | null) => void
  refinementStale: boolean
  setRefinementStale: (stale: boolean) => void
  setActiveView: (view: 'original' | 'refined' | 'translated') => void
  translatedUtterances: Utterance[] | null
  translationLanguage: string | null
  translationSource: UtteranceSource | null
  translationStale: boolean
  translationSourceAvailable: boolean
  setTranslatedUtterances: (utterances: Utterance[] | null) => void
  setTranslationLanguage: (language: string | null) => void
  setTranslationMetadata: (meta: { source: UtteranceSource; stale: boolean; sourceAvailable: boolean } | null) => void
  clearTranslation: () => void
  analyses: AnalysisListItem[]
  setAnalyses: (analyses: AnalysisListItem[]) => void
  addAnalysis: (item: AnalysisListItem) => void
  removeAnalysis: (id: string) => void
  // Presets
  transcriptionPresets: TranscriptionPreset[]
  analysisPresets: AnalysisPreset[]
  refinementPresets: RefinementPreset[]
  bundles: PresetBundle[]
  activeBundleId: string | null
  setTranscriptionPresets: (presets: TranscriptionPreset[]) => void
  setAnalysisPresets: (presets: AnalysisPreset[]) => void
  setRefinementPresets: (presets: RefinementPreset[]) => void
  setBundles: (bundles: PresetBundle[]) => void
  setActiveBundleId: (id: string | null) => void
  tokenAttention: boolean
  setTokenAttention: (value: boolean) => void
  helpOpen: boolean
  helpInitialSection: string | null
  setHelpOpen: (open: boolean, initialSection?: string | null) => void
  closeHelp: () => void
  helpTab: 'manual' | 'assistant'
  setHelpTab: (tab: 'manual' | 'assistant') => void
  assistantMessages: AssistantMessage[]
  assistantStatus: 'idle' | 'streaming'
  assistantError: string | null
  sendAssistantMessage: (text: string) => Promise<void>
  retryAssistant: () => Promise<void>
  resetAssistant: () => void
  clearRefinement: () => void
  clearTranscriptionState: () => void
  reset: () => void
}

// Everything that belongs to one opened transcription; shared by reset() and
// clearTranscriptionState() so opening another transcription starts clean.
const clearedTranscriptionState = {
  transcriptionResult: null,
  speakerMappings: {},
  currentTime: 0,
  seekTo: null,
  activeTab: 'subtitles' as const,
  unsavedEdits: false,
  refinedUtterances: null,
  refinementMetadata: null,
  refinementStale: false,
  activeView: 'original' as const,
  translatedUtterances: null,
  translationLanguage: null,
  translationSource: null,
  translationStale: false,
  translationSourceAvailable: true,
  analyses: [],
}

const ASSISTANT_MESSAGE_MAX = 8000

/** Newest messages that fit the endpoint's limits; never starts with an assistant message. */
export function trimHistory(messages: AssistantMessage[], maxMessages = 20, maxChars = 48000): AssistantMessage[] {
  const clamped = messages.map((m) =>
    m.role === 'assistant' && m.content.length > ASSISTANT_MESSAGE_MAX ? { ...m, content: m.content.slice(0, ASSISTANT_MESSAGE_MAX) } : m,
  )
  let start = Math.max(0, clamped.length - maxMessages)
  const total = (from: number) => clamped.slice(from).reduce((n, m) => n + m.content.length, 0)
  while (start < clamped.length && (total(start) > maxChars || clamped[start].role === 'assistant')) start++
  return clamped.slice(start)
}

let assistantAbort: AbortController | null = null

let isPopStateNavigation = false

export function setPopStateFlag(value: boolean) {
  isPopStateNavigation = value
}

const clearedAssistantState = {
  assistantMessages: [] as AssistantMessage[],
  assistantStatus: 'idle' as const,
  assistantError: null as string | null,
}

function assistantErrorCode(err: unknown): string {
  if (err instanceof AssistantStreamError) return err.code
  if (err instanceof ApiError) return err.code === 'assistant_busy' ? 'assistant_busy' : 'server_error'
  return 'network'
}

export const useStore = create<AppState>((set, get) => {
  // Streams an answer for the current history (which ends with a user message).
  const runAssistant = async () => {
    const controller = new AbortController()
    assistantAbort = controller
    const { currentView, transcriptionId } = get()
    set((s) => ({
      assistantMessages: [...s.assistantMessages, { role: 'assistant', content: '' }],
      assistantStatus: 'streaming',
      assistantError: null,
    }))
    const history = get().assistantMessages.slice(0, -1)
    try {
      await streamAssistantChat(
        {
          messages: trimHistory(history),
          lang: i18n.language === 'en' ? 'en' : 'de',
          view: currentView,
          transcription_id: currentView === 'detail' ? transcriptionId : null,
        },
        {
          signal: controller.signal,
          onDelta: (text) => {
            if (assistantAbort !== controller) return
            set((s) => {
              const msgs = s.assistantMessages.slice()
              const last = msgs[msgs.length - 1]
              msgs[msgs.length - 1] = { ...last, content: last.content + text }
              return { assistantMessages: msgs }
            })
          },
        },
      )
      if (assistantAbort === controller) {
        const msgs = get().assistantMessages
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant' && last.content === '') {
          set({ assistantMessages: msgs.slice(0, -1), assistantStatus: 'idle', assistantError: 'incomplete' })
        } else {
          set({ assistantStatus: 'idle' })
        }
      }
    } catch (err) {
      if (assistantAbort !== controller) return // reset while streaming
      const msgs = get().assistantMessages
      const last = msgs[msgs.length - 1]
      set({
        assistantMessages: last && last.role === 'assistant' && last.content === '' ? msgs.slice(0, -1) : msgs,
        assistantStatus: 'idle',
        assistantError: assistantErrorCode(err),
      })
    } finally {
      if (assistantAbort === controller) assistantAbort = null
    }
  }

  return {
  currentView: 'archive' as const,
  setCurrentView: (view) => {
    const current = useStore.getState().currentView
    if (view !== current && !isPopStateNavigation) {
      history.pushState({ view }, '', '')
    }
    set({ currentView: view })
  },
  config: null,
  setConfig: (config) => set({ config }),
  file: null,
  setFile: (file) => set({ file }),
  uploading: false,
  setUploading: (uploading) => set({ uploading }),
  uploadAbortController: null,
  setUploadAbortController: (controller) => set({ uploadAbortController: controller }),
  recordingActive: false,
  setRecordingActive: (active) => set({ recordingActive: active }),
  leaveReason: () => {
    const state = get()
    if (state.uploading) return 'upload'
    if (state.recordingActive) return 'recording'
    // A recording whose upload is done (or whose submit failed) but that is not yet in the overview.
    if (state.currentView === 'record' && state.file !== null && state.transcriptionId === null) return 'recording'
    if (state.unsavedEdits && state.currentView === 'detail') return 'unsavedEdits'
    return null
  },
  confirmLeave: (messages) => {
    const reason = get().leaveReason()
    if (!reason) return true
    if (!window.confirm(messages[reason])) return false
    if (reason === 'upload') {
      // Re-read state after the (synchronous) confirm dialog — upload may have
      // completed while the dialog was open.
      const state = get()
      if (state.uploading && state.uploadAbortController) {
        state.uploadAbortController.abort()
      }
      set({ uploading: false, uploadAbortController: null })
    } else if (reason === 'recording') {
      set({ recordingActive: false })
    }
    return true
  },
  transcriptionId: null,
  transcriptionTitle: null,
  transcriptionStatus: null,
  transcriptionResult: null,
  setTranscriptionId: (id) => set({ transcriptionId: id }),
  setTranscriptionTitle: (title) => set({ transcriptionTitle: title }),
  setTranscriptionStatus: (status) => set({ transcriptionStatus: status }),
  setTranscriptionResult: (result) => set({ transcriptionResult: result }),
  speakerMappings: {},
  setSpeakerMappings: (mappings) => set({ speakerMappings: mappings }),
  transcriptionHistory: [],
  setTranscriptionHistory: (list) => set({ transcriptionHistory: list }),
  currentTime: 0,
  setCurrentTime: (time) => set({ currentTime: time }),
  seekTo: null,
  setSeekTo: (time) => set({ seekTo: time }),
  activeTab: 'subtitles',
  setActiveTab: (tab) => set({ activeTab: tab }),
  unsavedEdits: false,
  setUnsavedEdits: (dirty) => set({ unsavedEdits: dirty }),
  refinedUtterances: null,
  refinementMetadata: null,
  activeView: 'original' as const,
  setRefinedUtterances: (utterances) => set({ refinedUtterances: utterances }),
  setRefinementMetadata: (metadata) => set({ refinementMetadata: metadata }),
  refinementStale: false,
  setRefinementStale: (stale) => set({ refinementStale: stale }),
  setActiveView: (view) => set({ activeView: view }),
  translatedUtterances: null,
  translationLanguage: null,
  translationSource: null,
  translationStale: false,
  translationSourceAvailable: true,
  setTranslatedUtterances: (utterances) => set({ translatedUtterances: utterances }),
  setTranslationLanguage: (language) => set({ translationLanguage: language }),
  setTranslationMetadata: (meta) => set({
    translationSource: meta?.source ?? null,
    translationStale: meta?.stale ?? false,
    translationSourceAvailable: meta?.sourceAvailable ?? true,
  }),
  clearTranslation: () => set({
    translatedUtterances: null,
    translationLanguage: null,
    translationSource: null,
    translationStale: false,
    translationSourceAvailable: true,
    activeView: 'original' as const,
  }),
  analyses: [],
  setAnalyses: (analyses) => set({ analyses }),
  addAnalysis: (item) => set((s) => ({ analyses: [item, ...s.analyses] })),
  removeAnalysis: (id) => set((s) => ({ analyses: s.analyses.filter((a) => a.id !== id) })),
  // Presets
  transcriptionPresets: [],
  analysisPresets: [],
  refinementPresets: [],
  bundles: [],
  activeBundleId: null,
  setTranscriptionPresets: (presets) => set({ transcriptionPresets: presets }),
  setAnalysisPresets: (presets) => set({ analysisPresets: presets }),
  setRefinementPresets: (presets) => set({ refinementPresets: presets }),
  setBundles: (bundles) => set({ bundles }),
  setActiveBundleId: (id) => set({ activeBundleId: id }),
  tokenAttention: false,
  setTokenAttention: (value) => set({ tokenAttention: value }),
  helpOpen: false,
  helpInitialSection: null,
  setHelpOpen: (open, initialSection) =>
    set({
      helpOpen: open,
      helpInitialSection: initialSection ?? null,
      ...(initialSection ? { helpTab: 'manual' as const } : {}),
    }),
  closeHelp: () => set({ helpOpen: false }),
  helpTab: 'manual' as const,
  setHelpTab: (tab) => set({ helpTab: tab }),
  ...clearedAssistantState,
  sendAssistantMessage: async (text) => {
    if (get().assistantStatus === 'streaming') return
    set((s) => ({ assistantMessages: [...s.assistantMessages, { role: 'user', content: text }] }))
    await runAssistant()
  },
  retryAssistant: async () => {
    if (get().assistantStatus === 'streaming') return
    const msgs = get().assistantMessages
    const last = msgs[msgs.length - 1]
    if (last?.role === 'assistant') set({ assistantMessages: msgs.slice(0, -1) })
    if (get().assistantMessages.length === 0) return
    await runAssistant()
  },
  resetAssistant: () => {
    assistantAbort?.abort()
    assistantAbort = null
    set(clearedAssistantState)
  },
  clearRefinement: () => set({ refinedUtterances: null, refinementMetadata: null, refinementStale: false, activeView: 'original' as const }),
  clearTranscriptionState: () => set(clearedTranscriptionState),
  reset: () => {
    set({
    ...clearedTranscriptionState,
    currentView: 'archive' as const,
    file: null, uploading: false, uploadAbortController: null, recordingActive: false,
    transcriptionId: null, transcriptionTitle: null, transcriptionStatus: null,
    })
  },
  }
})

// Set initial browser history state
history.replaceState({ view: 'archive' }, '', '')
