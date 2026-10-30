import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api, ApiError } from '../../api/client'
import { downloadMarkdown, downloadText } from '../../utils/format'
import { AnalysisView } from './AnalysisView'
import type { AnalysisListItem, AnalysisTemplate } from '../../api/types'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    getAnalysisTemplates: vi.fn(),
    listAnalyses: vi.fn(),
    getAnalysis: vi.fn(),
    generateAnalysis: vi.fn(),
    deleteAnalysis: vi.fn(),
    deleteAnalysisItem: vi.fn(),
    createAnalysisPreset: vi.fn(),
  },
}))

vi.mock('../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/format')>()),
  downloadText: vi.fn(),
  downloadMarkdown: vi.fn(),
}))

const templates: AnalysisTemplate[] = [
  { id: 'summary', name: 'Summary', description: 'd', default_prompt: 'Summarise it.' },
  { id: 'protocol', name: 'Protocol', description: 'd', default_prompt: 'Write minutes.' },
  { id: 'agenda', name: 'Agenda', description: 'd', default_prompt: 'Follow the agenda.' },
]

function item(overrides: Partial<AnalysisListItem> = {}): AnalysisListItem {
  return {
    id: 'a1', template: 'summary', language: 'en', llm_provider: 'openai', llm_model: 'gpt-x',
    created_at: null, source: null, ...overrides,
  }
}

const summaryResult = {
  summary: 'They talked.',
  chapters: [
    { title: 'Intro', summary: 'Hello.', start_time: 0, end_time: 61_000 },
    { title: 'Main', summary: 'Stuff.', start_time: 61_000, end_time: 120_000 },
  ],
  llm_provider: 'openai',
  llm_model: 'gpt-x',
}

const protocolResult = {
  title: 'Weekly',
  participants: ['Ann', 'Bob'],
  key_points: [{ topic: 'Budget', speaker: 'Ann', timestamp: 5000, content: 'Over budget.' }],
  decisions: [{ decision: 'Cut costs', timestamp: null }],
  action_items: [{ task: 'Send report', assignee: 'Bob', timestamp: 65_000 }],
}

const initialState = useStore.getState()
let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.clearAllMocks()
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
  vi.mocked(api.getAnalysisTemplates).mockResolvedValue(templates)
  vi.mocked(api.listAnalyses).mockResolvedValue([])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  confirmSpy.mockRestore()
})

function setup(state: Record<string, unknown> = {}) {
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: { id: 't1', utterances: [], language: 'de' } as never,
    config: { enabled_languages: [], popular_languages: [] } as never,
    ...state,
  })
  return render(<AnalysisView />)
}

async function ready() {
  await screen.findByRole('button', { name: 'Summary with chapters' })
}

describe('AnalysisView — generation form', () => {
  it('shows the form with translated templates when there are no analyses', async () => {
    setup()
    await ready()
    expect(screen.getByRole('button', { name: 'Meeting protocol' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agenda-based notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ New Analysis' })).not.toBeInTheDocument()
    // Output language defaults to the transcript's language.
    expect(screen.getByLabelText('Output language')).toHaveValue('de')
  })

  it('generates with the first template and its default prompt unchanged', async () => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'new', template: 'summary', language: 'de', llm_model: 'gpt-x' })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(useStore.getState().analyses).toHaveLength(1))
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', {
      template: 'summary', custom_prompt: null, language: 'de', chapter_hints: null, agenda: null, source: null,
    })
    expect(useStore.getState().analyses[0]).toMatchObject({ id: 'new', template: 'summary', llm_model: 'gpt-x' })
    // The form collapses once an analysis exists.
    expect(await screen.findByRole('button', { name: '+ New Analysis' })).toBeInTheDocument()
  })

  it('shows a generating message while waiting', async () => {
    vi.mocked(api.generateAnalysis).mockReturnValue(new Promise(() => {}))
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Meeting protocol' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Generating Meeting protocol...')).toBeInTheDocument()
  })

  it('sends an edited prompt and can reset it to the template', async () => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'new' })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Customize prompt' }))
    const prompt = screen.getByDisplayValue('Summarise it.')
    fireEvent.change(prompt, { target: { value: 'Be brief.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to template' }))
    expect(prompt).toHaveValue('Summarise it.')
    fireEvent.change(prompt, { target: { value: 'Be brief.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({
      template: 'summary', custom_prompt: 'Be brief.',
    })))
  })

  it('sends a custom prompt without a template', async () => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'new' })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Customize prompt' }))
    expect(screen.queryByRole('button', { name: 'Reset to template' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'List all names.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({
      template: null, custom_prompt: 'List all names.',
    })))
  })

  it('sends only non-empty, trimmed chapter hints for the summary template', async () => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'new' })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Define chapters (optional)' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    const titles = screen.getAllByPlaceholderText('Chapter title')
    const descriptions = screen.getAllByPlaceholderText('Brief description')
    fireEvent.change(titles[0], { target: { value: '  Intro ' } })
    fireEvent.change(descriptions[1], { target: { value: 'Q&A' } })
    // The third hint stays empty and is not sent.
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({
      chapter_hints: [{ title: 'Intro' }, { description: 'Q&A' }],
    })))
  })

  it('removes a chapter hint', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Define chapters (optional)' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    fireEvent.change(screen.getAllByPlaceholderText('Chapter title')[0], { target: { value: 'First' } })
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    expect(screen.getAllByPlaceholderText('Chapter title')).toHaveLength(1)
    expect(screen.getByPlaceholderText('Chapter title')).toHaveValue('')
  })

  it('caps chapter hints at 30', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Define chapters (optional)' }))
    for (let i = 0; i < 30; i++) fireEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    expect(screen.getAllByPlaceholderText('Chapter title')).toHaveLength(30)
    expect(screen.getByRole('button', { name: '+ Maximum 30 chapters' })).toBeDisabled()
  })

  it('sends the trimmed agenda only for the agenda template', async () => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'new' })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Agenda-based notes' }))
    fireEvent.change(screen.getByPlaceholderText('Paste your meeting agenda here...'), { target: { value: ' 1. Budget \n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({
      template: 'agenda', agenda: '1. Budget', chapter_hints: null,
    })))
  })

  it.each([
    [new ApiError(422, 'too long'), "The analysis reached the language model's output limit before it was complete. Try a more focused prompt."],
    [new ApiError(502, 'bad', 'malformed_reply'), 'The language model returned a malformed response. Please try again.'],
    [new Error('Network down'), 'Network down'],
  ])('explains a failed generation (%s)', async (error, message) => {
    vi.mocked(api.generateAnalysis).mockRejectedValue(error)
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('loads an analysis preset into the form', async () => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'new' })
    setup({
      analysisPresets: [{
        id: 'ap1', name: 'Board', template: 'agenda', custom_prompt: 'Custom agenda prompt', language: 'fr',
        chapter_hints: null, agenda: 'Item A',
      }],
    })
    await ready()
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'ap1' } })
    expect(screen.getByPlaceholderText('Paste your meeting agenda here...')).toHaveValue('Item A')
    expect(screen.getByLabelText('Output language')).toHaveValue('fr')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({
      template: 'agenda', custom_prompt: 'Custom agenda prompt', language: 'fr', agenda: 'Item A',
    })))
  })
})

describe('AnalysisView — generation settings', () => {
  const utterance = { start: 0, end: 1000, text: 'Hello', speaker: 'SPEAKER_00' }
  const bundlePreset = {
    id: 'ap1', name: 'German summary', template: 'summary', custom_prompt: null, language: 'de',
    chapter_hints: null, agenda: null, created_at: null, updated_at: null,
  }
  const bundle = {
    id: 'b1', name: 'Bundle', transcription_preset_id: null, analysis_preset_id: 'ap1',
    refinement_preset_id: null, translate_language: null, is_default: false, created_at: null, updated_at: null,
  }

  // An English transcript, so a German output language can only come from the bundle.
  function setupRefined(state: Record<string, unknown> = {}) {
    return setup({
      transcriptionResult: { id: 't1', utterances: [], language: 'en' } as never,
      refinedUtterances: [utterance],
      ...state,
    })
  }

  beforeEach(() => {
    vi.mocked(api.generateAnalysis).mockResolvedValue({ id: 'an2', template: 'summary', language: 'en' })
  })

  it('analyzes the original when the person chooses it', async () => {
    setupRefined()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ source: 'original' }))
  })

  it('goes back to the refined text when a new refinement arrives', async () => {
    setupRefined()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    act(() => useStore.setState({ refinedUtterances: [{ ...utterance, text: 'Hello again' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ source: 'refined' }))
  })

  it('starts from the active bundle\'s analysis preset', async () => {
    setupRefined({ analysisPresets: [bundlePreset], bundles: [bundle], activeBundleId: 'b1' })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ template: 'summary', language: 'de' }))
  })

  it('keeps the bundle preset\'s template when the template list arrives', async () => {
    setupRefined({
      analysisPresets: [{ ...bundlePreset, template: 'agenda', agenda: 'Item 1' }],
      bundles: [bundle],
      activeBundleId: 'b1',
    })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled())
    expect(api.generateAnalysis).toHaveBeenCalledWith('t1', expect.objectContaining({ template: 'agenda', agenda: 'Item 1' }))
  })

  it('keeps a preset saved by hand selected while a bundle is active', async () => {
    vi.mocked(api.createAnalysisPreset).mockResolvedValue({ ...bundlePreset, id: 'ap2', name: 'Mine' })
    setupRefined({ analysisPresets: [bundlePreset], bundles: [bundle], activeBundleId: 'b1' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }))
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: '✓' }))

    await waitFor(() => expect(screen.getByRole('option', { name: 'Mine' })).toBeInTheDocument())
    expect((screen.getByRole('option', { name: 'Mine' }).closest('select') as HTMLSelectElement).value).toBe('ap2')
  })
})

describe('AnalysisView — existing analyses', () => {
  async function setupWith(items: AnalysisListItem[], state: Record<string, unknown> = {}) {
    vi.mocked(api.listAnalyses).mockResolvedValue(items)
    const utils = setup(state)
    await screen.findByRole('button', { name: '+ New Analysis' })
    return utils
  }

  it('lists analyses with their template and model, and hides the form', async () => {
    await setupWith([item(), item({ id: 'a2', template: null, llm_model: null })])
    expect(api.listAnalyses).toHaveBeenCalledWith('t1')
    expect(screen.getByText('Summary with chapters')).toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(screen.getByText('gpt-x')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ New Analysis' }))
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
  })

  it('loads a summary on expand, once, and shows its chapters', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue(summaryResult)
    await setupWith([item()])
    fireEvent.click(screen.getByText('Summary with chapters'))
    expect(await screen.findByText('They talked.')).toBeInTheDocument()
    expect(api.getAnalysis).toHaveBeenCalledWith('t1', 'a1')
    expect(screen.getByText('1. Intro')).toBeInTheDocument()
    expect(screen.getByText('Generated with openai / gpt-x')).toBeInTheDocument()
    // Collapse and expand again without reloading.
    fireEvent.click(screen.getByText('Summary with chapters'))
    expect(screen.queryByText('They talked.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Summary with chapters'))
    expect(screen.getByText('They talked.')).toBeInTheDocument()
    expect(api.getAnalysis).toHaveBeenCalledTimes(1)
  })

  it('shows a load error inside the card', async () => {
    vi.mocked(api.getAnalysis).mockRejectedValue(new Error('Gone'))
    await setupWith([item()])
    fireEvent.click(screen.getByText('Summary with chapters'))
    expect(await screen.findByText('Gone')).toBeInTheDocument()
  })

  it('downloads a summary as text and Markdown under the media file name', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue(summaryResult)
    await setupWith([item()], { file: { id: 'f', original_filename: 'meeting.mp4', file_size: 1 } })
    fireEvent.click(screen.getByText('Summary with chapters'))
    await screen.findByText('They talked.')

    fireEvent.click(screen.getAllByRole('button', { name: 'TXT' })[0])
    expect(downloadText).toHaveBeenCalledWith(
      'They talked.\n\n1. Intro [00:00:00 — 00:01:01]\nHello.\n\n2. Main [00:01:01 — 00:02:00]\nStuff.',
      'meeting_analysis.txt',
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Markdown' })[0])
    expect(downloadMarkdown).toHaveBeenCalledWith(
      'They talked.\n\n### 1. Intro\n*00:00:00 — 00:01:01*\n\nHello.\n\n### 2. Main\n*00:01:01 — 00:02:00*\n\nStuff.',
      'meeting_analysis.md',
    )
  })

  it('renders a protocol and exports it as text and Markdown', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue(protocolResult)
    await setupWith([item({ template: 'protocol' })])
    fireEvent.click(screen.getByText('Meeting protocol'))
    expect(await screen.findByText('Weekly')).toBeInTheDocument()
    expect(screen.getByText('Participants: Ann, Bob')).toBeInTheDocument()
    expect(screen.getByText('Ann — Budget')).toBeInTheDocument()
    expect(screen.getByText('Cut costs')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'TXT' })[0])
    expect(downloadText).toHaveBeenCalledWith([
      'Protocol: Weekly',
      'Participants: Ann, Bob',
      '',
      'KEY POINTS',
      '1. [00:00:05] Ann — Budget',
      '   Over budget.',
      '',
      'DECISIONS',
      '1. Cut costs',
      '',
      'ACTION ITEMS',
      '1. Bob — Send report (00:01:05)',
    ].join('\n'), 'transcription_analysis.txt')

    fireEvent.click(screen.getAllByRole('button', { name: 'Markdown' })[0])
    expect(downloadMarkdown).toHaveBeenCalledWith([
      '# Protocol: Weekly',
      '',
      '**Participants:** Ann, Bob',
      '',
      '## Key Points',
      '',
      '1. **[00:00:05] Ann** — Budget',
      '   Over budget.',
      '',
      '## Decisions',
      '',
      '1. Cut costs',
      '',
      '## Action Items',
      '',
      '- [ ] **Bob** — Send report *(00:01:05)*',
    ].join('\n'), 'transcription_analysis.md')
  })

  it('shows free-form results as text and notes the source', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({ answer: 42, source: 'refined', stale: true })
    await setupWith([item({ template: null })])
    fireEvent.click(screen.getByText('Custom'))
    expect(await screen.findByText(/"answer": 42/)).toBeInTheDocument()
    expect(screen.getByText('from refined · source has newer content')).toBeInTheDocument()
  })

  it('shows string results verbatim', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue('Plain answer')
    await setupWith([item({ template: null })])
    fireEvent.click(screen.getByText('Custom'))
    expect(await screen.findByText('Plain answer')).toBeInTheDocument()
  })

  it('copies the result as text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.mocked(api.getAnalysis).mockResolvedValue('Plain answer')
    await setupWith([item({ template: null })])
    fireEvent.click(screen.getByText('Custom'))
    await screen.findByText('Plain answer')
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy result' })[0])
    expect(await screen.findAllByRole('button', { name: 'Copied!' })).toHaveLength(2)
    expect(writeText).toHaveBeenCalledWith('Plain answer')
  })

  // The two tests below find the buttons by their hard-coded English titles
  // (https://github.com/virtUOS/transkribierBAR/issues/251) and expect deletion without confirmation
  // (https://github.com/virtUOS/transkribierBAR/issues/252); update them when either is fixed.
  it('removes a single chapter through the server', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue(summaryResult)
    vi.mocked(api.deleteAnalysisItem).mockResolvedValue({ ...summaryResult, chapters: [summaryResult.chapters[1]] })
    await setupWith([item()])
    fireEvent.click(screen.getByText('Summary with chapters'))
    await screen.findByText('1. Intro')
    fireEvent.click(screen.getAllByTitle('Remove chapter')[0])
    expect(await screen.findByText('1. Main')).toBeInTheDocument()
    expect(api.deleteAnalysisItem).toHaveBeenCalledWith('t1', 'a1', 'chapters', 0)
    expect(screen.queryByText('1. Intro')).not.toBeInTheDocument()
  })

  it('removes a protocol action item through the server', async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue(protocolResult)
    vi.mocked(api.deleteAnalysisItem).mockResolvedValue({ ...protocolResult, action_items: [] })
    await setupWith([item({ template: 'protocol' })])
    fireEvent.click(screen.getByText('Meeting protocol'))
    await screen.findByText('Weekly')
    fireEvent.click(screen.getAllByTitle('Remove item')[2])
    await waitFor(() => expect(screen.queryByText('Send report')).not.toBeInTheDocument())
    expect(api.deleteAnalysisItem).toHaveBeenCalledWith('t1', 'a1', 'action_items', 0)
  })

  it('does not remove an item when the confirmation is cancelled', async () => {
    confirmSpy.mockReturnValue(false)
    vi.mocked(api.getAnalysis).mockResolvedValue(summaryResult)
    await setupWith([item()])
    fireEvent.click(screen.getByText('Summary with chapters'))
    fireEvent.click((await screen.findAllByTitle('Remove chapter'))[0])

    expect(confirmSpy).toHaveBeenCalledWith('Remove this item from the analysis?')
    expect(api.deleteAnalysisItem).not.toHaveBeenCalled()
  })

  it('deletes an analysis after confirmation', async () => {
    vi.mocked(api.deleteAnalysis).mockResolvedValue(undefined)
    await setupWith([item(), item({ id: 'a2', template: 'protocol' })])
    fireEvent.click(screen.getAllByTitle('Delete')[0])
    expect(confirmSpy).toHaveBeenCalledWith('Delete this analysis? This cannot be undone.')
    await waitFor(() => expect(useStore.getState().analyses.map((a) => a.id)).toEqual(['a2']))
    expect(api.deleteAnalysis).toHaveBeenCalledWith('t1', 'a1')
  })

  it('keeps an analysis when deletion is declined', async () => {
    confirmSpy.mockReturnValue(false)
    await setupWith([item()])
    fireEvent.click(screen.getByTitle('Delete'))
    expect(api.deleteAnalysis).not.toHaveBeenCalled()
  })

  it('shows the server detail when the delete fails and keeps the analysis', async () => {
    vi.mocked(api.deleteAnalysis).mockRejectedValue(new ApiError(500, 'Server said no'))
    await setupWith([item()])

    fireEvent.click(screen.getByTitle('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no')
    expect(useStore.getState().analyses).toHaveLength(1)
  })

  it('shows a generic message when the delete fails without a server detail', async () => {
    vi.mocked(api.deleteAnalysis).mockRejectedValue(new TypeError('Failed to fetch'))
    await setupWith([item()])

    fireEvent.click(screen.getByTitle('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Deleting the analysis failed.')
  })

  it.todo(
    'shows an error when deleting an analysis fails while the form is collapsed (bug https://github.com/virtUOS/transkribierBAR/issues/247: the error is '
    + 'only rendered inside the generation form, which is hidden once analyses exist — AnalysisView.tsx:510,757)',
  )
})
