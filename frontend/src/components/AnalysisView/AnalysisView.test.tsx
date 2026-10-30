import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'
import { AnalysisView } from './AnalysisView'

const item = {
  id: 'an1',
  template: 'summary',
  language: 'en',
  llm_provider: null,
  llm_model: null,
  created_at: null,
  source: null,
}

const summary = {
  summary: 'Overall',
  chapters: [{ title: 'Intro', summary: 'Hello', start_time: 0, end_time: 5 }],
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useStore.setState({ transcriptionId: 't1', analyses: [item] })
  vi.spyOn(api, 'getAnalysisTemplates').mockResolvedValue([])
  vi.spyOn(api, 'listAnalyses').mockResolvedValue([item])
  vi.spyOn(api, 'getAnalysis').mockResolvedValue(summary)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AnalysisView deleting an analysis', () => {
  it('shows the server detail when the delete fails and keeps the analysis', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(api, 'deleteAnalysis').mockRejectedValue(new ApiError(500, 'Server said no'))
    render(<AnalysisView />)

    fireEvent.click(await screen.findByTitle('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no')
    expect(useStore.getState().analyses).toHaveLength(1)
  })

  it('shows a generic message for a non-API failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(api, 'deleteAnalysis').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<AnalysisView />)

    fireEvent.click(await screen.findByTitle('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Deleting the analysis failed.')
  })
})

describe('AnalysisView removing an item', () => {
  async function openCard() {
    render(<AnalysisView />)
    fireEvent.click(await screen.findByText('Summary with chapters'))
    return screen.findByTitle('Remove chapter')
  }

  it('does not call the API when the confirmation is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const del = vi.spyOn(api, 'deleteAnalysisItem').mockResolvedValue(summary)
    fireEvent.click(await openCard())

    expect(confirmSpy).toHaveBeenCalledWith('Remove this item from the analysis?')
    expect(del).not.toHaveBeenCalled()
  })

  it('calls the API when the confirmation is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const del = vi.spyOn(api, 'deleteAnalysisItem').mockResolvedValue(summary)
    fireEvent.click(await openCard())

    await waitFor(() => expect(del).toHaveBeenCalledWith('t1', 'an1', 'chapters', 0))
  })
})

describe('AnalysisView generation settings', () => {
  const template = { id: 'summary', name: 'Summary', description: '', default_prompt: 'Summarize.' }
  const utterance = { start: 0, end: 1000, text: 'Hello', speaker: 'SPEAKER_00' }
  const bundlePreset = {
    id: 'ap1', name: 'German summary', template: 'summary', custom_prompt: null, language: 'de',
    chapter_hints: null, agenda: null, created_at: null, updated_at: null,
  }
  const bundle = {
    id: 'b1', name: 'Bundle', transcription_preset_id: null, analysis_preset_id: 'ap1',
    refinement_preset_id: null, translate_language: null, is_default: false, created_at: null, updated_at: null,
  }

  beforeEach(() => {
    vi.mocked(api.getAnalysisTemplates).mockResolvedValue([template])
    vi.mocked(api.listAnalyses).mockResolvedValue([])
    vi.spyOn(api, 'generateAnalysis').mockResolvedValue({ id: 'an2', template: 'summary', language: 'en' })
    useStore.setState({ analyses: [], refinedUtterances: [utterance], analysisPresets: [], bundles: [], activeBundleId: null })
  })

  afterEach(() => {
    useStore.setState({ refinedUtterances: null, analysisPresets: [], bundles: [], activeBundleId: null })
  })

  it('analyzes the original when the person chooses it', async () => {
    render(<AnalysisView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Summary with chapters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ source: 'original' }))
  })

  it('goes back to the refined text when a new refinement arrives', async () => {
    render(<AnalysisView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Summary with chapters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    act(() => useStore.setState({ refinedUtterances: [{ ...utterance, text: 'Hello again' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ source: 'refined' }))
  })

  it('starts from the active bundle\'s analysis preset', async () => {
    useStore.setState({ analysisPresets: [bundlePreset], bundles: [bundle], activeBundleId: 'b1' })
    render(<AnalysisView />)
    await screen.findByRole('button', { name: 'Summary with chapters' })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ template: 'summary', language: 'de' }))
  })

  it('keeps the bundle preset\'s template when the template list arrives', async () => {
    const agenda = { id: 'agenda', name: 'Agenda', description: '', default_prompt: 'Follow the agenda.' }
    vi.mocked(api.getAnalysisTemplates).mockResolvedValue([template, agenda])
    useStore.setState({
      analysisPresets: [{ ...bundlePreset, template: 'agenda', agenda: 'Item 1' }],
      bundles: [bundle],
      activeBundleId: 'b1',
    })
    render(<AnalysisView />)
    await screen.findByRole('button', { name: 'Summary with chapters' })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ template: 'agenda', agenda: 'Item 1' }))
  })

  it('keeps a preset saved by hand selected while a bundle is active', async () => {
    useStore.setState({ analysisPresets: [bundlePreset], bundles: [bundle], activeBundleId: 'b1' })
    vi.spyOn(api, 'createAnalysisPreset').mockResolvedValue({ ...bundlePreset, id: 'ap2', name: 'Mine' })
    render(<AnalysisView />)
    await screen.findByRole('button', { name: 'Summary with chapters' })

    fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }))
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: '✓' }))

    await waitFor(() => expect(screen.getByRole('option', { name: 'Mine' })).toBeInTheDocument())
    expect((screen.getByRole('option', { name: 'Mine' }).closest('select') as HTMLSelectElement).value).toBe('ap2')
  })
})
