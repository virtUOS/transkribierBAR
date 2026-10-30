import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from './i18n'
import { useStore } from './store'
import { api, ApiError } from './api/client'
import App from './App'
import type { ConfigResponse, PresetBundle, PresetBundleExpanded, TranscriptionListItem, TranscriptionPreset } from './api/types'

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return {
    ...actual,
    api: {
      getConfig: vi.fn(),
      getTranscriptionPresets: vi.fn(),
      getAnalysisPresets: vi.fn(),
      getRefinementPresets: vi.fn(),
      getBundles: vi.fn(),
      getDefaultBundle: vi.fn(),
      promptBudget: vi.fn(),
      startTranscription: vi.fn(),
      getStatus: vi.fn(),
      connectWebSocket: vi.fn(() => ({ close: vi.fn() })),
      listTranscriptions: vi.fn(() => Promise.resolve([])),
    },
  }
})

const config: ConfigResponse = {
  asr_backend: 'murmurai',
  whisper_models: ['base', 'large-v3'],
  default_model: 'base',
  llm_available: false,
  logout_url: '',
  popular_languages: [],
  enabled_languages: [],
}

function preset(id: string, overrides: Partial<TranscriptionPreset>): TranscriptionPreset {
  return {
    id,
    name: id,
    language: null,
    model: 'base',
    min_speakers: 1,
    max_speakers: 2,
    initial_prompt: null,
    hotwords: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function bundle(id: string, transcriptionPresetId: string | null, isDefault = false): PresetBundle {
  return {
    id,
    name: id,
    transcription_preset_id: transcriptionPresetId,
    analysis_preset_id: null,
    refinement_preset_id: null,
    translate_language: null,
    is_default: isDefault,
    created_at: null,
    updated_at: null,
  }
}

const germanNoSpeakers = preset('P', { language: 'de', model: 'large-v3', min_speakers: 0, max_speakers: 0 })
const frenchTwoSpeakers = preset('Q', { language: 'fr', min_speakers: 2, max_speakers: 2 })

function serve(bundles: PresetBundle[]) {
  const presets = [germanNoSpeakers, frenchTwoSpeakers]
  const defaultBundle = bundles.find((b) => b.is_default)
  vi.mocked(api.getConfig).mockResolvedValue(config)
  vi.mocked(api.getTranscriptionPresets).mockResolvedValue(presets)
  vi.mocked(api.getAnalysisPresets).mockResolvedValue([])
  vi.mocked(api.getRefinementPresets).mockResolvedValue([])
  vi.mocked(api.getBundles).mockResolvedValue(bundles)
  vi.mocked(api.getDefaultBundle).mockResolvedValue(defaultBundle
    ? {
        ...defaultBundle,
        transcription_preset: presets.find((p) => p.id === defaultBundle.transcription_preset_id) ?? null,
        analysis_preset: null,
        refinement_preset: null,
      } satisfies PresetBundleExpanded
    : null)
}

// The bundle field's label is not tied to it, so find it through its placeholder option
async function bundleSelect(): Promise<HTMLSelectElement> {
  return (await screen.findByRole('option', { name: 'Select a bundle...' })).closest('select')!
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useStore.getState().reset()
  useStore.setState({
    config: null,
    currentView: 'upload',
    file: { id: 'f1', original_filename: 'talk.mp3', media_type: 'audio/mpeg', file_size: 1, has_video: false },
    bundles: [],
    activeBundleId: null,
    transcriptionPresets: [],
  })
})

describe('Upload settings and the default bundle', () => {
  it('applies the default bundle\'s transcription preset at startup', async () => {
    serve([bundle('A', 'P', true)])
    render(<App />)
    expect((await bundleSelect()).value).toBe('A')
    expect(screen.getByLabelText('Transcription language')).toHaveValue('de')
    expect(screen.getByLabelText('Detect speakers')).not.toBeChecked()
    expect(screen.getByLabelText('Quality')).toHaveValue('large-v3')

    // Applied once: a later change by hand survives the next render
    fireEvent.change(screen.getByLabelText('Transcription language'), { target: { value: 'en' } })
    act(() => useStore.getState().setBundles([bundle('A', 'P', true)]))
    expect(screen.getByLabelText('Transcription language')).toHaveValue('en')
  })

  it('keeps the default bundle\'s model when the configuration arrives after the bundles', async () => {
    serve([bundle('A', 'P', true)])
    let sendConfig!: (value: ConfigResponse) => void
    vi.mocked(api.getConfig).mockReturnValue(new Promise((resolve) => { sendConfig = resolve }))
    render(<App />)
    await waitFor(() => expect(useStore.getState().activeBundleId).toBe('A'))
    await act(async () => sendConfig(config))
    expect(screen.getByLabelText('Quality')).toHaveValue('large-v3')
    expect(screen.getByLabelText('Transcription language')).toHaveValue('de')
  })

  it('leaves the settings alone when the default bundle has no transcription preset', async () => {
    serve([bundle('A', null, true)])
    render(<App />)
    expect((await bundleSelect()).value).toBe('A')
    expect(screen.getByLabelText('Transcription language')).toHaveValue('auto')
    expect(screen.getByLabelText('Detect speakers')).toBeChecked()
    expect(screen.getByLabelText('Quality')).toHaveValue('base')
  })

  it('applies the preset of a bundle chosen by hand', async () => {
    serve([bundle('A', 'P', true), bundle('B', 'Q')])
    render(<App />)
    const select = await bundleSelect()
    fireEvent.change(select, { target: { value: 'B' } })
    expect(select.value).toBe('B')
    expect(screen.getByLabelText('Transcription language')).toHaveValue('fr')
    expect(screen.getByLabelText('Detect speakers')).toBeChecked()
  })
})

describe('Upload settings and the prompt budget', () => {
  async function typePrompt(text: string) {
    fireEvent.click(await screen.findByRole('button', { name: /Advanced options/ }))
    fireEvent.change(screen.getByPlaceholderText('Optional context for the transcription'), { target: { value: text } })
  }

  it('blocks Transcribe while the initial prompt and hotwords are too long', async () => {
    serve([])
    vi.mocked(api.promptBudget).mockResolvedValue({ tokens: 300, limit: 223 })
    render(<App />)
    await typePrompt('A very long prompt')

    expect(await screen.findByText(/together are too long \(135% of the available space\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transcribe' })).toBeDisabled()
  })

  it('names the cause when the server rejects them as too long', async () => {
    serve([])
    vi.mocked(api.promptBudget).mockResolvedValue({ tokens: 100, limit: 223 })
    vi.mocked(api.startTranscription).mockRejectedValue(
      new ApiError(422, 'Initial prompt and hotwords together are too long (224 of 223 tokens).', 'prompt_too_long'),
    )
    render(<App />)
    await typePrompt('A prompt')
    await screen.findByText(/use 45% of the available space/)

    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }))

    expect(await screen.findByText('Initial prompt and hotwords together are too long. Please shorten them.')).toBeInTheDocument()
  })
})

describe('A failed transcription opened from the overview', () => {
  const failedItem: TranscriptionListItem = {
    id: 't1', file_id: 'f1', original_filename: 'talk.mp3', status: 'failed', language: null, model: 'base',
    created_at: '2026-10-30T08:00:00Z', file_size: 1, expires_at: '2026-11-02T08:00:00Z', archived: false,
    title: 'Old title', has_video: false,
  }

  it('offers Try again, which returns to the settings for the same file', async () => {
    serve([])
    vi.mocked(api.promptBudget).mockResolvedValue({ tokens: 0, limit: 223 })
    vi.mocked(api.getStatus).mockResolvedValue({
      id: 't1', status: 'failed', progress: null, error: 'ASR job exceeded 1800s', error_code: 'timeout',
    })
    useStore.setState({
      currentView: 'detail',
      transcriptionId: 't1',
      transcriptionStatus: 'failed',
      transcriptionTitle: 'Old title',
      transcriptionHistory: [failedItem],
    })
    render(<App />)

    expect(await screen.findByText(
      'Error message: The speech recognition did not finish this transcription within the time limit.',
    )).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    const transcribe = await screen.findByRole('button', { name: 'Transcribe' })
    const state = useStore.getState()
    expect(state.currentView).toBe('upload')
    expect(state.transcriptionId).toBeNull()
    expect(state.transcriptionStatus).toBeNull()
    expect(state.transcriptionTitle).toBeNull()
    expect(state.file?.id).toBe('f1')
    expect(screen.getByText('talk.mp3')).toBeInTheDocument()

    // The same file is transcribed again, without a new upload.
    await waitFor(() => expect(transcribe).toBeEnabled())
    vi.mocked(api.startTranscription).mockResolvedValue({ id: 't2', status: 'pending' })
    fireEvent.click(transcribe)
    await waitFor(() => expect(api.startTranscription).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'f1' })))
  })

  it('goes to the overview, not an empty page, on Back after Try again', async () => {
    serve([])
    vi.mocked(api.promptBudget).mockResolvedValue({ tokens: 0, limit: 223 })
    vi.mocked(api.getStatus).mockResolvedValue({
      id: 't1', status: 'failed', progress: null, error: 'x', error_code: 'timeout',
    })
    useStore.setState({
      currentView: 'detail', transcriptionId: 't1', transcriptionStatus: 'failed', transcriptionHistory: [failedItem],
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Transcribe' })

    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'detail' } })) })

    expect(useStore.getState().currentView).toBe('archive')
  })
})

describe('Transcribing while the upload runs', () => {
  const talk = { id: 'f2', original_filename: 'lecture.mp3', media_type: 'audio/mpeg', file_size: 2048, has_video: false }

  it('starts the transcription once, when the file lands', async () => {
    serve([])
    vi.mocked(api.startTranscription).mockResolvedValue({ id: 't1', status: 'pending' })
    useStore.setState({ file: null, uploading: true })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe when ready' }))
    expect(api.startTranscription).not.toHaveBeenCalled()

    act(() => useStore.setState({ file: talk, uploading: false }))

    await waitFor(() => expect(api.startTranscription).toHaveBeenCalledTimes(1))
    expect(api.startTranscription).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'f2' }))
    expect(await screen.findByText('lecture.mp3')).toBeInTheDocument()
    act(() => useStore.setState({ uploading: false }))
    expect(api.startTranscription).toHaveBeenCalledTimes(1)
  })

  it('uses the configured default model once the configuration arrives', async () => {
    serve([])
    vi.mocked(api.getConfig).mockResolvedValue({ ...config, default_model: 'large-v3' })
    vi.mocked(api.startTranscription).mockResolvedValue({ id: 't1', status: 'pending' })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe' }))

    await waitFor(() => expect(api.startTranscription).toHaveBeenCalled())
    expect(api.startTranscription).toHaveBeenCalledWith(expect.objectContaining({ model: 'large-v3' }))
  })

  it('drops a transcription still running when the person goes to the overview', async () => {
    serve([])
    useStore.setState({ transcriptionId: 'running', transcriptionStatus: 'processing' })
    render(<App />)
    await waitFor(() => expect(useStore.getState().config).not.toBeNull())
    expect(useStore.getState().transcriptionId).toBe('running')

    act(() => useStore.getState().setCurrentView('archive'))

    expect(useStore.getState().transcriptionId).toBeNull()
    expect(useStore.getState().transcriptionStatus).toBeNull()
  })

  it('forgets a failed start when the person leaves the upload view', async () => {
    serve([])
    vi.mocked(api.startTranscription).mockRejectedValue(new Error('Server unavailable'))
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe' }))
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument()

    act(() => useStore.getState().setCurrentView('archive'))
    act(() => useStore.getState().setCurrentView('upload'))

    expect(screen.queryByText('Server unavailable')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transcribe' })).toBeInTheDocument()
  })
})
