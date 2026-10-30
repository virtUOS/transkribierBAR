import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api, ApiError } from '../../api/client'
import { SubtitleEditor } from './SubtitleEditor'
import type { ConfigResponse, RefinementMetadata, TranscriptionResult, Utterance } from '../../api/types'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    saveTranscription: vi.fn(),
    getTranscription: vi.fn(),
    getOriginalTranscription: vi.fn(),
    getRefinement: vi.fn(),
    generateRefinement: vi.fn(),
    retryRefinement: vi.fn(),
    deleteRefinement: vi.fn(),
    translateTranscription: vi.fn(),
    deleteTranslation: vi.fn(),
    updateSpeakers: vi.fn(),
    createRefinementPreset: vi.fn(),
  },
}))

const llmConfig: ConfigResponse = {
  asr_backend: 'murmurai',
  whisper_models: [],
  default_model: 'm',
  llm_available: true,
  logout_url: '',
  popular_languages: [],
  enabled_languages: [],
}

// Five rows, rendered by setup(); most display, search, editing, refinement and
// translation tests use them.
const base: Utterance[] = [
  { start: 0, end: 2000, text: 'Hello world.', speaker: 'SPEAKER_00' },
  { start: 2000, end: 4000, text: 'How are you?', speaker: 'SPEAKER_01' },
  { start: 4000, end: 6000, text: 'Fine, thanks.', speaker: 'SPEAKER_00' },
  { start: 6000, end: 8000, text: 'Great to hear.', speaker: 'SPEAKER_01' },
  { start: 8000, end: 10000, text: 'Bye now.', speaker: 'SPEAKER_00' },
]

function meta(overrides: Partial<RefinementMetadata> = {}): RefinementMetadata {
  return {
    changed_indices: [0],
    changes_summary: 'Fixed punctuation.',
    context: null,
    llm_provider: 'openai',
    llm_model: 'gpt',
    created_at: null,
    failed_ranges: [],
    source_hash: null,
    ...overrides,
  }
}

// A saved two-row transcript with SPEAKER_00 named Alice, opened by openTranscript(),
// and the ASR result it was edited from (ORIGINAL).
const ORIGINAL = [
  { start: 1000, end: 4000, text: 'Hello their', speaker: 'SPEAKER_00' },
  { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
]

function transcript(): TranscriptionResult {
  return {
    id: 't1',
    status: 'completed',
    text: '',
    language: 'en',
    speaker_mappings: {},
    summary: null,
    protocol: null,
    utterances: [
      { start: 1500, end: 4000, text: 'Hello there', speaker: 'SPEAKER_00' },
      { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
    ],
  }
}

const germanTranslation: Utterance[] = [
  { start: 1500, end: 4000, text: 'Hallo', speaker: 'SPEAKER_00' },
  { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
]

function setup(state: Record<string, unknown> = {}, utterances: Utterance[] = base) {
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: { id: 't1', status: 'completed', utterances } as TranscriptionResult,
    ...state,
  })
  return render(<SubtitleEditor />)
}

function openTranscript() {
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: transcript(),
    speakerMappings: { SPEAKER_00: 'Alice' },
  })
}

function savedWithEdits() {
  useStore.setState({ transcriptionResult: { ...transcript(), edited: true } })
}

function renameFirstSpeaker(name: string) {
  fireEvent.click(screen.getAllByTitle('Edit speaker name')[0])
  const input = screen.getByDisplayValue('Alice')
  fireEvent.change(input, { target: { value: name } })
  fireEvent.blur(input)
}

function utterances() {
  return useStore.getState().transcriptionResult!.utterances
}

/** The visible subtitle rows (no header, no separators). */
function bodyRows() {
  return screen.getAllByRole('row').filter((r) => r.closest('tbody') && r.querySelectorAll('td').length === 5)
}

function row(i: number) {
  return within(bodyRows()[i])
}

const initialState = useStore.getState()
let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.clearAllMocks()
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SubtitleEditor — display', () => {
  it('says so when there is no speech', () => {
    setup({}, [])
    expect(screen.getByText('No speech was detected in this recording.')).toBeInTheDocument()
  })

  it('lists every utterance with times, speaker names and text', () => {
    setup({ speakerMappings: { SPEAKER_00: 'Ann' } })
    expect(bodyRows()).toHaveLength(5)
    expect(row(0).getByText('Hello world.')).toBeInTheDocument()
    expect(row(0).getByText('00:00:00')).toBeInTheDocument()
    expect(row(0).getByText('00:00:02')).toBeInTheDocument()
    expect(row(0).getByText('Ann')).toBeInTheDocument()
    expect(row(1).getByText('SPEAKER_01')).toBeInTheDocument()
  })

  it('highlights the row being played', () => {
    setup({ currentTime: 4500 })
    expect(bodyRows()[2]).toHaveClass('bg-blue-900/30')
    expect(bodyRows()[1]).not.toHaveClass('bg-blue-900/30')
  })

  it('seeks to the start of a row when its text is clicked', async () => {
    setup()
    fireEvent.click(row(3).getByText('Great to hear.'))
    await waitFor(() => expect(useStore.getState().seekTo).toBe(6000))
  })

  it('seeks to the end time when the end timestamp is clicked', async () => {
    setup()
    fireEvent.click(row(1).getByText('00:00:04'))
    await waitFor(() => expect(useStore.getState().seekTo).toBe(4000))
  })
})

describe('SubtitleEditor — search', () => {
  async function search(q: string) {
    fireEvent.change(screen.getByPlaceholderText('Search subtitles...'), { target: { value: q } })
    await screen.findByText(/segments$/)
  }

  it('shows matches with one row of context and counts hidden rows', async () => {
    setup()
    await search('great')
    expect(screen.getByText('1 of 5 segments')).toBeInTheDocument()
    // Rows 3, 4, 5 visible (context before and after); rows 1–2 hidden.
    expect(bodyRows()).toHaveLength(3)
    expect(screen.getByText(/2 segments hidden/)).toBeInTheDocument()
    expect(bodyRows()[0]).toHaveClass('opacity-50')
    expect(bodyRows()[1]).not.toHaveClass('opacity-50')
    expect(row(1).getByText('Great')).toHaveClass('bg-yellow-600/40')
  })

  it('matches mapped speaker names and can be limited to text', async () => {
    setup({ speakerMappings: { SPEAKER_01: 'Bob' } })
    await search('bob')
    expect(screen.getByText('2 of 5 segments')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Speaker' })) // only text now
    await screen.findByText('No matching segments')
  })

  it('can be limited to speakers', async () => {
    setup()
    await search('hello')
    expect(screen.getByText('1 of 5 segments')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Text' })) // only speaker now
    expect(await screen.findByText('No matching segments')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Speaker' })) // back to both
    expect(await screen.findByText('1 of 5 segments')).toBeInTheDocument()
  })

  it('clears on Escape', async () => {
    setup()
    await search('bye')
    fireEvent.keyDown(screen.getByPlaceholderText('Search subtitles...'), { key: 'Escape' })
    expect(screen.getByPlaceholderText('Search subtitles...')).toHaveValue('')
    expect(bodyRows()).toHaveLength(5)
  })

  it('treats regex characters literally', async () => {
    setup({}, [{ start: 0, end: 1000, text: 'Cost (approx.) $5?', speaker: null }])
    await search('(approx.)')
    expect(screen.getByText('(approx.)')).toHaveClass('bg-yellow-600/40')
  })
})

describe('SubtitleEditor — editing', () => {
  it('edits text, marks the transcript dirty and saves all utterances', async () => {
    vi.mocked(api.saveTranscription).mockResolvedValue({ status: 'ok', edited: true })
    setup()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    fireEvent.click(row(1).getByTitle('Edit text'))
    const textarea = row(1).getByRole('textbox')
    expect(textarea).toHaveFocus()
    fireEvent.change(textarea, { target: { value: 'How are you doing?' } })
    fireEvent.blur(textarea)

    expect(utterances()[1].text).toBe('How are you doing?')
    expect(useStore.getState().unsavedEdits).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(useStore.getState().unsavedEdits).toBe(false))
    expect(api.saveTranscription).toHaveBeenCalledWith('t1', utterances())
    expect(api.getRefinement).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('does not mark the transcript dirty when the text is unchanged', () => {
    setup()
    fireEvent.click(row(0).getByTitle('Edit text'))
    fireEvent.blur(row(0).getByRole('textbox'))
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('refreshes the refinement staleness after saving when a refinement exists', async () => {
    vi.mocked(api.saveTranscription).mockResolvedValue({ status: 'ok', edited: true })
    vi.mocked(api.getRefinement).mockResolvedValue({ utterances: [], metadata: meta(), stale: true })
    setup({ unsavedEdits: true, refinementMetadata: meta(), refinedUtterances: base })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(useStore.getState().refinementStale).toBe(true))
  })

  it('merges a row with the next one', () => {
    setup()
    fireEvent.click(row(0).getByTitle('Merge with next section'))
    expect(utterances()).toHaveLength(4)
    expect(utterances()[0]).toEqual({ start: 0, end: 4000, text: 'Hello world. How are you?', speaker: 'SPEAKER_00' })
    expect(useStore.getState().unsavedEdits).toBe(true)
  })

  it('offers no merge on the last row', () => {
    setup()
    expect(row(4).queryByTitle('Merge with next section')).not.toBeInTheDocument()
  })

  it('adds an empty row filling the gap to the next row, with the same speaker', () => {
    setup({}, [
      { start: 0, end: 1000, text: 'a', speaker: 'SPEAKER_00' },
      { start: 3000, end: 4000, text: 'b', speaker: 'SPEAKER_01' },
    ])
    fireEvent.click(row(0).getAllByTitle('Add new row after this one')[0])
    expect(utterances()[1]).toEqual({ start: 1000, end: 3000, text: '', speaker: 'SPEAKER_00' })
  })

  it('adds a one-second row after the last row', () => {
    setup({}, [{ start: 0, end: 1000, text: 'a', speaker: null }])
    fireEvent.click(row(0).getAllByTitle('Add new row after this one')[0])
    expect(utterances()[1]).toEqual({ start: 1000, end: 2000, text: '', speaker: null })
  })

  it('deletes a row only after confirmation', () => {
    confirmSpy.mockReturnValueOnce(false)
    setup()
    fireEvent.click(row(2).getByTitle('Delete this row'))
    expect(utterances()).toHaveLength(5)
    fireEvent.click(row(2).getByTitle('Delete this row'))
    expect(confirmSpy).toHaveBeenLastCalledWith('Delete this caption row?')
    expect(utterances().map((u) => u.text)).not.toContain('Fine, thanks.')
    expect(utterances()).toHaveLength(4)
  })

  it('changes a row speaker in place', () => {
    setup()
    fireEvent.click(row(1).getByTitle('Edit speaker name'))
    const input = row(1).getByRole('textbox')
    expect(input).toHaveValue('SPEAKER_01')
    fireEvent.change(input, { target: { value: 'Bob' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(utterances()[1].speaker).toBe('Bob')
    expect(utterances()[3].speaker).toBe('SPEAKER_01')
  })

  it('opens the speaker panel focused on the clicked speaker', async () => {
    setup()
    fireEvent.click(row(1).getByTitle('Rename speaker in all utterances'))
    expect(screen.getByRole('heading', { name: 'Speaker Names' })).toBeInTheDocument()
    const inputs = screen.getAllByPlaceholderText('New name (leave empty to keep)')
    await waitFor(() => expect(inputs[1]).toHaveFocus())
  })

  it('toggles the speaker panel from the toolbar', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Speaker Names' }))
    expect(screen.getByRole('heading', { name: 'Speaker Names' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Speaker Names' }))
    expect(screen.queryByRole('heading', { name: 'Speaker Names' })).not.toBeInTheDocument()
  })
})

describe('SubtitleEditor — speaker field', () => {
  beforeEach(openTranscript)

  it('leaving the field with the shown name keeps the speaker ID and the transcript clean', () => {
    const before = useStore.getState().transcriptionResult
    render(<SubtitleEditor />)
    fireEvent.click(screen.getAllByTitle('Edit speaker name')[0])
    fireEvent.blur(screen.getByDisplayValue('Alice'))
    expect(useStore.getState().transcriptionResult).toBe(before)
    expect(useStore.getState().unsavedEdits).toBe(false)
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('typing another name changes the speaker of that row', () => {
    render(<SubtitleEditor />)
    fireEvent.click(screen.getAllByTitle('Edit speaker name')[0])
    const input = screen.getByDisplayValue('Alice')
    fireEvent.change(input, { target: { value: 'Bob' } })
    fireEvent.blur(input)
    const utterances = useStore.getState().transcriptionResult!.utterances
    expect(utterances[0].speaker).toBe('Bob')
    expect(utterances[1].speaker).toBe('SPEAKER_01')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })
})

describe('SubtitleEditor — timestamps', () => {
  function editTime(i: number, which: 0 | 1, value: string) {
    fireEvent.click(row(i).getAllByTitle('Edit timestamp')[which])
    const input = row(i).getByRole('textbox')
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  it('edits a start time without touching neighbours when there is no overlap', () => {
    setup({}, [
      { start: 0, end: 1000, text: 'a', speaker: null },
      { start: 3000, end: 5000, text: 'b', speaker: null },
    ])
    editTime(1, 0, '00:00:02')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(utterances()[1]).toMatchObject({ start: 2000, end: 5000 })
    expect(utterances()[0]).toMatchObject({ start: 0, end: 1000 })
  })

  it('moving a start earlier shortens the previous row after confirmation', () => {
    setup()
    editTime(2, 0, '00:00:03')
    expect(confirmSpy).toHaveBeenCalledWith('This change will adjust timestamps on 1 adjacent row(s). Continue?')
    expect(utterances()[1]).toMatchObject({ start: 2000, end: 3000 })
    expect(utterances()[2]).toMatchObject({ start: 3000, end: 6000 })
  })

  it('moving an end later cascades forward through every overlapped row', () => {
    setup()
    editTime(0, 1, '00:00:07')
    expect(confirmSpy).toHaveBeenCalledWith('This change will adjust timestamps on 3 adjacent row(s). Continue?')
    expect(utterances().map((u) => [u.start, u.end])).toEqual([
      [0, 7000], [7000, 7000], [7000, 7000], [7000, 8000], [8000, 10000],
    ])
  })

  it('leaves everything unchanged when the cascade is declined', () => {
    confirmSpy.mockReturnValue(false)
    setup()
    editTime(0, 1, '00:00:07')
    expect(utterances()).toEqual(base)
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('keeps a row valid when its start is moved past its end', () => {
    setup({}, [{ start: 0, end: 1000, text: 'a', speaker: null }])
    editTime(0, 0, '00:00:05')
    expect(utterances()[0]).toMatchObject({ start: 5000, end: 5000 })
  })

  it('keeps a row valid when its end is moved before its start', () => {
    setup({}, [{ start: 5000, end: 6000, text: 'a', speaker: null }])
    editTime(0, 1, '00:00:02')
    expect(utterances()[0]).toMatchObject({ start: 2000, end: 2000 })
  })
})

describe('SubtitleEditor — timestamp fields', () => {
  beforeEach(openTranscript)

  // The pencil icons of the start (0) and end (1) of the first row
  function editTime(n: number): HTMLInputElement {
    fireEvent.click(screen.getAllByTitle('Edit timestamp')[n])
    return document.querySelector<HTMLInputElement>('input[data-subtitle-input]')!
  }

  function enter(input: HTMLInputElement, value: string) {
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
  }

  it('opens with milliseconds and leaving it unchanged keeps the time and the transcript clean', () => {
    const before = useStore.getState().transcriptionResult
    render(<SubtitleEditor />)
    const input = editTime(0)
    expect(input.value).toBe('00:00:01.500')
    fireEvent.blur(input)
    expect(useStore.getState().transcriptionResult).toBe(before)
    expect(useStore.getState().unsavedEdits).toBe(false)
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByText('00:00:01')).toBeInTheDocument()
  })

  it('tabbing through the rows without typing keeps the transcript clean', () => {
    const before = useStore.getState().transcriptionResult
    render(<SubtitleEditor />)
    fireEvent.keyDown(editTime(0), { key: 'Tab' })
    const next = document.querySelector<HTMLInputElement>('input[data-subtitle-input]')!
    expect(next.value).toBe('00:01:40.000')
    fireEvent.blur(next)
    expect(useStore.getState().transcriptionResult).toBe(before)
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('reads minutes and seconds', () => {
    render(<SubtitleEditor />)
    enter(editTime(1), '01:30')
    expect(useStore.getState().transcriptionResult!.utterances[0].end).toBe(90000)
    expect(useStore.getState().unsavedEdits).toBe(true)
  })

  it('reads a comma as the decimal separator', () => {
    render(<SubtitleEditor />)
    enter(editTime(1), '12,5')
    expect(useStore.getState().transcriptionResult!.utterances[0].end).toBe(12500)
  })

  it('ignores input that is not a time', () => {
    const before = useStore.getState().transcriptionResult
    render(<SubtitleEditor />)
    enter(editTime(1), 'abc')
    expect(useStore.getState().transcriptionResult).toBe(before)
    expect(useStore.getState().unsavedEdits).toBe(false)
    expect(screen.getByText('00:00:04')).toBeInTheDocument()
  })
})

describe('SubtitleEditor — keyboard navigation', () => {
  it('Tab moves the text editor to the next row and seeks there; Escape leaves', () => {
    setup()
    fireEvent.click(row(0).getByTitle('Edit text'))
    fireEvent.keyDown(row(0).getByRole('textbox'), { key: 'Tab' })
    expect(row(0).queryByRole('textbox')).not.toBeInTheDocument()
    expect(row(1).getByRole('textbox')).toHaveValue('How are you?')
    expect(useStore.getState().seekTo).toBe(2000)

    fireEvent.keyDown(row(1).getByRole('textbox'), { key: 'Tab', shiftKey: true })
    expect(row(0).getByRole('textbox')).toBeInTheDocument()

    fireEvent.keyDown(row(0).getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryAllByRole('textbox').filter((e) => e.tagName === 'TEXTAREA')).toHaveLength(0)
  })

  it('Tab on the last row stays there', () => {
    setup()
    fireEvent.click(row(4).getByTitle('Edit text'))
    fireEvent.keyDown(row(4).getByRole('textbox'), { key: 'Tab' })
    expect(row(4).getByRole('textbox')).toBeInTheDocument()
  })
})

describe('SubtitleEditor — saving', () => {
  beforeEach(openTranscript)

  it('shows the server\'s reason when saving fails and keeps the edits for a retry', async () => {
    vi.mocked(api.saveTranscription).mockRejectedValueOnce(new ApiError(500, 'boom'))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(useStore.getState().unsavedEdits).toBe(true)
    expect(useStore.getState().transcriptionResult!.utterances[0].speaker).toBe('Bob')

    let finishSave!: (value: { status: string; edited: boolean }) => void
    vi.mocked(api.saveTranscription).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => finishSave({ status: 'ok', edited: true }))
    expect(useStore.getState().unsavedEdits).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a general message when saving fails without a server reason', async () => {
    vi.mocked(api.saveTranscription).mockRejectedValueOnce(new Error('network'))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed.')
  })

  it('leaves the store alone when the transcription is closed during the save', async () => {
    let finishSave!: (value: { status: string; edited: boolean }) => void
    vi.mocked(api.saveTranscription).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    act(() => useStore.setState({ transcriptionResult: null }))
    await act(async () => finishSave({ status: 'ok', edited: true }))
    expect(useStore.getState().transcriptionResult).toBeNull()
  })

  it('clears the error when another transcription is opened', async () => {
    vi.mocked(api.saveTranscription).mockRejectedValueOnce(new ApiError(500, 'boom'))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    act(() => useStore.setState({ transcriptionId: 't2', transcriptionResult: { ...transcript(), id: 't2' }, unsavedEdits: false }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the unsaved edits of another transcription opened during the save', async () => {
    let finishSave!: (value: { status: string; edited: boolean }) => void
    vi.mocked(api.saveTranscription).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const other = { ...transcript(), id: 't2' }
    act(() => useStore.setState({ transcriptionId: 't2', transcriptionResult: other, unsavedEdits: true }))
    await act(async () => finishSave({ status: 'ok', edited: true }))
    expect(useStore.getState().transcriptionResult).toBe(other)
    expect(useStore.getState().unsavedEdits).toBe(true)
  })

  it('shows no error on another transcription opened before the save failed', async () => {
    let failSave!: (reason: unknown) => void
    vi.mocked(api.saveTranscription).mockReturnValueOnce(new Promise((_, reject) => { failSave = reject }))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    act(() => useStore.setState({ transcriptionId: 't2', transcriptionResult: { ...transcript(), id: 't2' }, unsavedEdits: false }))
    await act(async () => failSave(new ApiError(500, 'boom')))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables Discard changes and Restore original while saving', async () => {
    savedWithEdits()
    let finishSave!: (value: { status: string; edited: boolean }) => void
    vi.mocked(api.saveTranscription).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restore original' })).toBeDisabled()
    await act(async () => finishSave({ status: 'ok', edited: true }))
    expect(screen.getByRole('button', { name: 'Restore original' })).toBeEnabled()
  })
})

describe('SubtitleEditor — discarding changes', () => {
  beforeEach(openTranscript)

  function discard() {
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  }

  it('reloads the saved version after the prompt', async () => {
    vi.mocked(api.getTranscription).mockResolvedValueOnce(transcript())
    discard()
    await waitFor(() => expect(useStore.getState().unsavedEdits).toBe(false))
    expect(confirmSpy).toHaveBeenCalledWith('Discard all unsaved changes and go back to the last saved version?')
    expect(useStore.getState().transcriptionResult!.utterances[0].speaker).toBe('SPEAKER_00')
  })

  it('shows the server\'s reason when discarding fails and keeps the edits', async () => {
    vi.mocked(api.getTranscription).mockRejectedValueOnce(new ApiError(500, 'boom'))
    discard()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(useStore.getState().unsavedEdits).toBe(true)
    expect(useStore.getState().transcriptionResult!.utterances[0].speaker).toBe('Bob')
  })

  it('shows a general message when discarding fails without a server reason', async () => {
    vi.mocked(api.getTranscription).mockRejectedValueOnce(new Error('network'))
    discard()
    expect(await screen.findByRole('alert')).toHaveTextContent('Discarding failed.')
  })

  it('does not load the saved version into another transcription opened during the discard', async () => {
    let finishDiscard!: (value: TranscriptionResult) => void
    vi.mocked(api.getTranscription).mockReturnValueOnce(new Promise((resolve) => { finishDiscard = resolve }))
    discard()
    const other = { ...transcript(), id: 't2' }
    act(() => useStore.setState({ transcriptionId: 't2', transcriptionResult: other, unsavedEdits: true }))
    await act(async () => finishDiscard(transcript()))
    expect(useStore.getState().transcriptionResult).toBe(other)
    expect(useStore.getState().unsavedEdits).toBe(true)
  })
})

describe('SubtitleEditor — restoring the original', () => {
  beforeEach(openTranscript)

  function restore() {
    vi.mocked(api.getOriginalTranscription).mockResolvedValueOnce({ utterances: ORIGINAL })
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
  }

  it('does not offer Restore original while the saved version is the original', () => {
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore original' })).toBeNull()
  })

  it('offers Restore original without unsaved changes once the saved version differs', () => {
    savedWithEdits()
    render(<SubtitleEditor />)
    expect(screen.getByRole('button', { name: 'Restore original' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
  })

  it('loads the original into the editor as unsaved changes', async () => {
    savedWithEdits()
    restore()
    await waitFor(() => expect(useStore.getState().transcriptionResult!.utterances).toEqual(ORIGINAL))
    expect(confirmSpy).toHaveBeenCalledWith('Load the original transcription into the editor? Unsaved changes will be discarded. Your saved version is only replaced when you click Save changes.')
    expect(api.getOriginalTranscription).toHaveBeenCalledWith('t1')
    expect(api.saveTranscription).not.toHaveBeenCalled()
    expect(useStore.getState().unsavedEdits).toBe(true)
    expect(useStore.getState().speakerMappings).toEqual({ SPEAKER_00: 'Alice' })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()
  })

  it('switches to the Original view', async () => {
    savedWithEdits()
    useStore.setState({ activeView: 'refined', refinedUtterances: transcript().utterances })
    restore()
    await waitFor(() => expect(useStore.getState().activeView).toBe('original'))
  })

  it('changes nothing when the prompt is cancelled', () => {
    savedWithEdits()
    const before = useStore.getState().transcriptionResult
    confirmSpy.mockReturnValue(false)
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(api.getOriginalTranscription).not.toHaveBeenCalled()
    expect(useStore.getState().transcriptionResult).toBe(before)
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('shows the server\'s reason when restoring fails, also without unsaved changes', async () => {
    savedWithEdits()
    vi.mocked(api.getOriginalTranscription).mockRejectedValueOnce(new ApiError(404, 'Original transcription not available'))
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Original transcription not available')
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('shows a general message when restoring fails without a server reason', async () => {
    savedWithEdits()
    vi.mocked(api.getOriginalTranscription).mockRejectedValueOnce(new Error('network'))
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Restoring failed.')
  })

  it('does not load the original into another transcription opened during the restore', async () => {
    savedWithEdits()
    let finishRestore!: (value: { utterances: typeof ORIGINAL }) => void
    vi.mocked(api.getOriginalTranscription).mockReturnValueOnce(new Promise((resolve) => { finishRestore = resolve }))
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    const other = { ...transcript(), id: 't2', edited: true }
    act(() => useStore.setState({ transcriptionId: 't2', transcriptionResult: other }))
    await act(async () => finishRestore({ utterances: ORIGINAL }))
    expect(useStore.getState().transcriptionResult).toBe(other)
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('no longer offers Restore original once the original is saved again', async () => {
    savedWithEdits()
    vi.mocked(api.saveTranscription).mockResolvedValueOnce({ status: 'ok', edited: false })
    restore()
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore original' })).toBeNull())
    expect(api.saveTranscription).toHaveBeenCalledWith('t1', ORIGINAL)
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('offers Restore original after an edit is saved', async () => {
    vi.mocked(api.saveTranscription).mockResolvedValueOnce({ status: 'ok', edited: true })
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('button', { name: 'Restore original' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })
})

describe('SubtitleEditor — refinement', () => {
  const refined: Utterance[] = base.map((u, i) => (i === 0 ? { ...u, text: 'Hello, world!' } : u))

  it('hides the AI buttons without an LLM', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Refine with LLM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument()
  })

  it('refines with context and switches to the refined view', async () => {
    vi.mocked(api.generateRefinement).mockResolvedValue({ utterances: refined, metadata: meta(), stale: false })
    setup({ config: llmConfig })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.change(screen.getByPlaceholderText(/Computer science lecture/), { target: { value: 'A podcast' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await waitFor(() => expect(useStore.getState().activeView).toBe('refined'))
    expect(api.generateRefinement).toHaveBeenCalledWith('t1', 'A podcast')
    expect(useStore.getState().refinedUtterances).toEqual(refined)
    expect(screen.getByText('Hello, world!')).toBeInTheDocument()
    expect(screen.getByText('Fixed punctuation.')).toBeInTheDocument()
    expect(screen.getByText('openai / gpt')).toBeInTheDocument()
  })

  it('sends no context when the field is empty', async () => {
    vi.mocked(api.generateRefinement).mockResolvedValue({ utterances: refined, metadata: meta(), stale: false })
    setup({ config: llmConfig })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await waitFor(() => expect(api.generateRefinement).toHaveBeenCalledWith('t1', undefined))
  })

  it('shows an error in the dialog when refinement fails', async () => {
    vi.mocked(api.generateRefinement).mockRejectedValue(new Error('LLM down'))
    setup({ config: llmConfig })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Refinement failed. Please try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns that long transcripts take a while', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 900, text: `u${i}`, speaker: null }))
    setup({ config: llmConfig }, many)
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    expect(screen.getByText('This transcription has 51 utterances. Refinement may take several minutes.')).toBeInTheDocument()
  })

  it('is read-only in the refined view and compares changed rows with the original', () => {
    setup({ refinedUtterances: refined, refinementMetadata: meta(), activeView: 'refined' })
    expect(screen.queryAllByTitle('Edit text')).toHaveLength(0)
    expect(screen.queryAllByTitle('Delete this row')).toHaveLength(0)
    // Unchanged rows have no compare button.
    expect(row(2).queryByRole('button', { name: 'Compare with original' })).not.toBeInTheDocument()
    fireEvent.click(row(0).getByRole('button', { name: 'Compare with original' }))
    expect(screen.getByText('Original:')).toBeInTheDocument()
    expect(screen.getByText('Hello world.')).toBeInTheDocument()
  })

  it('switches between the original and refined views', () => {
    setup({ refinedUtterances: refined, refinementMetadata: meta(), activeView: 'refined' })
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    expect(useStore.getState().activeView).toBe('original')
    expect(screen.getByText('Hello world.')).toBeInTheDocument()
    expect(screen.getAllByTitle('Edit text')).toHaveLength(5)
  })

  it('flags a stale refinement', () => {
    setup({ refinedUtterances: refined, refinementMetadata: meta(), refinementStale: true })
    expect(screen.getByText('original was edited – delete and refine again')).toBeInTheDocument()
  })

  it('deletes the refinement after confirmation', async () => {
    vi.mocked(api.deleteRefinement).mockResolvedValue({ status: 'ok' })
    setup({ refinedUtterances: refined, refinementMetadata: meta(), activeView: 'refined' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Refinement' }))
    await waitFor(() => expect(useStore.getState().refinedUtterances).toBeNull())
    expect(api.deleteRefinement).toHaveBeenCalledWith('t1')
    expect(useStore.getState().activeView).toBe('original')
  })

  it('keeps the refinement when deletion is declined', () => {
    confirmSpy.mockReturnValue(false)
    setup({ refinedUtterances: refined, refinementMetadata: meta() })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Refinement' }))
    expect(api.deleteRefinement).not.toHaveBeenCalled()
  })

  it('lists failed sections and retries them', async () => {
    const fixed = meta({ failed_ranges: [] })
    vi.mocked(api.retryRefinement).mockResolvedValue({ utterances: refined, metadata: fixed, stale: false })
    setup({ refinedUtterances: refined, refinementMetadata: meta({ failed_ranges: [[2, 4]] }), activeView: 'refined' })
    expect(screen.getByText('Not refined (original text kept): utterances 3–4')).toBeInTheDocument()
    expect(bodyRows()[2]).toHaveClass('border-dashed')
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed sections' }))
    await waitFor(() => expect(screen.queryByText(/Not refined/)).not.toBeInTheDocument())
    expect(useStore.getState().refinementMetadata).toBe(fixed)
  })

  it.each([
    [new ApiError(409, 'stale'), 'Utterances were added or removed since this refinement was saved. Delete the refinement and refine again.'],
    [new Error('boom'), 'Retry failed. Please try again.'],
  ])('explains a failed retry (%s)', async (error, message) => {
    vi.mocked(api.retryRefinement).mockRejectedValue(error)
    setup({ refinedUtterances: refined, refinementMetadata: meta({ failed_ranges: [[2, 3]] }), activeView: 'refined' })
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed sections' }))
    expect(await screen.findByRole('status')).toHaveTextContent(message)
  })
})

describe('SubtitleEditor — compare control', () => {
  const COMPARE = { name: 'Compare with original' }

  function setRefined(changed: number[]) {
    useStore.setState({
      refinedUtterances: [
        { start: 1500, end: 4000, text: 'Hello there!', speaker: 'SPEAKER_00' },
        { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
      ],
      refinementMetadata: {
        changed_indices: changed,
        changes_summary: 'Punctuation',
        context: null,
        llm_provider: null,
        llm_model: null,
        created_at: null,
        failed_ranges: [],
        source_hash: null,
      },
      activeView: 'refined',
    })
  }

  beforeEach(() => {
    openTranscript()
    setRefined([0])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the button on changed rows only', () => {
    render(<SubtitleEditor />)
    const buttons = screen.getAllByRole('button', COMPARE)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].closest('tr')?.textContent).toContain('Hello there!')
    const kenobi = screen.getByText('General Kenobi').closest('tr')!
    expect(within(kenobi).queryByRole('button', COMPARE)).toBeNull()
  })

  it('starts collapsed and toggles the comparison', () => {
    render(<SubtitleEditor />)
    const button = screen.getByRole('button', COMPARE)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Original:')).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Original:')).toBeInTheDocument()
    const diff = document.querySelector('[data-help="row-diff"]')!
    expect(diff.textContent).toContain('Hello there')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Original:')).toBeNull()
  })

  it('points aria-controls at its own comparison row', () => {
    render(<SubtitleEditor />)
    const button = screen.getByRole('button', COMPARE)
    fireEvent.click(button)
    const id = button.getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)).toBe(document.querySelector('[data-help="row-diff"]'))
  })

  it('is a focusable native button', () => {
    render(<SubtitleEditor />)
    const button = screen.getByRole('button', COMPARE)
    button.focus()
    expect(document.activeElement).toBe(button)
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('carries the pressed style class for the open state', () => {
    render(<SubtitleEditor />)
    const button = screen.getByRole('button', COMPARE)
    expect(button.className).toContain('aria-expanded:bg-amber-900/40')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not seek the player when clicked', () => {
    vi.useFakeTimers()
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', COMPARE))
    act(() => { vi.advanceTimersByTime(500) })
    expect(useStore.getState().seekTo).toBeNull()
  })

  it('renders no button in the Original view', () => {
    useStore.setState({ activeView: 'original' })
    render(<SubtitleEditor />)
    expect(screen.queryByRole('button', COMPARE)).toBeNull()
    expect(document.querySelector('[data-help="row-diff"]')).toBeNull()
  })

  it('hides the comparison when switching back to Original with it open', () => {
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', COMPARE))
    expect(document.querySelector('[data-help="row-diff"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    expect(document.querySelector('[data-help="row-diff"]')).toBeNull()
    expect(screen.queryByRole('button', COMPARE)).toBeNull()
  })

  it('uses its own comparison for each changed row', () => {
    setRefined([0, 1])
    render(<SubtitleEditor />)
    const [first, second] = screen.getAllByRole('button', COMPARE)
    fireEvent.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(first.getAttribute('aria-controls')).not.toBe(second.getAttribute('aria-controls'))
  })

  it('opens a comparison for an empty original text', () => {
    const result = transcript()
    result.utterances[0].text = ''
    useStore.setState({ transcriptionResult: result })
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', COMPARE))
    expect(document.querySelector('[data-help="row-diff"]')).not.toBeNull()
  })

  it('keeps the row itself inert', () => {
    render(<SubtitleEditor />)
    const button = screen.getByRole('button', COMPARE)
    fireEvent.click(button.closest('tr')!)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(document.querySelector('[data-help="row-changed-dot"]')!)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('has a German label', async () => {
    await i18n.changeLanguage('de')
    render(<SubtitleEditor />)
    const button = screen.getByRole('button', { name: 'Mit Original vergleichen' })
    expect(button.textContent).toBe('Vergleichen')
  })
})

describe('SubtitleEditor — translation', () => {
  const translated: Utterance[] = base.map((u) => ({ ...u, text: `DE ${u.text}` }))
  const translationResult = {
    utterances: translated, language: 'de', source: 'original' as const, source_hash: null, stale: false, source_available: true,
  }

  it('translates the original when there is no refinement', async () => {
    vi.mocked(api.translateTranscription).mockResolvedValue(translationResult)
    setup({ config: llmConfig })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    fireEvent.change(screen.getByLabelText('Translation language'), { target: { value: 'de' } })
    const dialog = screen.getByRole('heading', { name: 'Translate to' }).parentElement!
    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(useStore.getState().activeView).toBe('translated'))
    expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'de', undefined, false)
    expect(screen.getByText('DE Hello world.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Translated (DE · from original)' })).toBeInTheDocument()
    expect(screen.queryAllByTitle('Edit text')).toHaveLength(0)
  })

  it.each([
    [{ translationStale: true }, 'source has newer content'],
    [{ translationSourceAvailable: false }, 'source no longer available'],
  ])('flags an outdated translation (%o)', (state, label) => {
    setup({ translatedUtterances: translated, translationLanguage: 'de', ...state })
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('deletes the translation after confirmation', async () => {
    vi.mocked(api.deleteTranslation).mockResolvedValue({ status: 'ok' })
    setup({ translatedUtterances: translated, translationLanguage: 'de', activeView: 'translated' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete translation' }))
    await waitFor(() => expect(useStore.getState().translatedUtterances).toBeNull())
    expect(useStore.getState().activeView).toBe('original')
  })
})

describe('SubtitleEditor — translation errors', () => {
  beforeEach(openTranscript)

  function translate() {
    useStore.setState({ config: llmConfig })
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    // The dialog's own Translate button comes after the one that opened it
    const buttons = screen.getAllByRole('button', { name: 'Translate' })
    fireEvent.click(buttons[buttons.length - 1])
  }

  it('shows the server\'s reason when a translation is refused', async () => {
    vi.mocked(api.translateTranscription).mockRejectedValueOnce(
      new ApiError(400, 'The transcript is already in German.'),
    )
    translate()
    expect(await screen.findByRole('alert')).toHaveTextContent('The transcript is already in German.')
  })

  it('shows the general message when the translation fails without a reason', async () => {
    vi.mocked(api.translateTranscription).mockRejectedValueOnce(new Error('network'))
    translate()
    expect(await screen.findByRole('alert')).toHaveTextContent('Translation failed. Please try again.')
  })
})

describe('SubtitleEditor — translating an out-of-date translation again', () => {
  beforeEach(openTranscript)

  function storeTranslation(stale: boolean) {
    useStore.setState({
      config: llmConfig,
      translatedUtterances: germanTranslation,
      translationLanguage: 'de',
      translationSource: 'original',
      translationStale: stale,
      translationSourceAvailable: true,
    })
  }

  function openDialogFromStaleBadge(language: string) {
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'source has newer content' }))
    fireEvent.change(screen.getByLabelText('Translation language'), { target: { value: language } })
  }

  it('asks for a new translation and clears the badge', async () => {
    storeTranslation(true)
    vi.mocked(api.translateTranscription).mockResolvedValueOnce({
      utterances: [
        { start: 1500, end: 4000, text: 'Hallo du', speaker: 'SPEAKER_00' },
        { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
      ],
      language: 'de',
      source: 'original',
      source_hash: 'h2',
      stale: false,
      source_available: true,
    })
    openDialogFromStaleBadge('de')
    expect(screen.getByText('The out-of-date translation will be replaced.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Translate' })).toBeNull())
    expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'de', undefined, true)
    expect(screen.queryByRole('button', { name: 'source has newer content' })).toBeNull()
  })

  it('does not ask for a new translation into another language', async () => {
    storeTranslation(true)
    vi.mocked(api.translateTranscription).mockRejectedValueOnce(new Error('network'))
    openDialogFromStaleBadge('fr')
    expect(screen.queryByText('The out-of-date translation will be replaced.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await screen.findByRole('alert')
    expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'fr', undefined, false)
  })

  it('does not ask for a new translation once the stored one is current', async () => {
    storeTranslation(true)
    vi.mocked(api.translateTranscription).mockRejectedValueOnce(new Error('network'))
    openDialogFromStaleBadge('de')
    // A bundle run can store a current translation while the dialog is open
    act(() => useStore.getState().setTranslationMetadata({ source: 'original', stale: false, sourceAvailable: true }))
    expect(screen.queryByText('The out-of-date translation will be replaced.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await screen.findByRole('alert')
    expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'de', undefined, false)
  })
})

describe('SubtitleEditor — translation language', () => {
  beforeEach(() => {
    openTranscript()
    useStore.setState({ config: llmConfig })
  })

  it('preselects the language of the stored translation', () => {
    useStore.setState({
      translatedUtterances: germanTranslation,
      translationLanguage: 'de',
      translationSource: 'original',
      translationStale: true,
      translationSourceAvailable: true,
    })
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'source has newer content' }))
    expect(screen.getByLabelText('Translation language')).toHaveValue('de')
    expect(screen.getByText('The out-of-date translation will be replaced.')).toBeInTheDocument()
  })

  it('keeps English preselected without a stored translation', () => {
    render(<SubtitleEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    expect(screen.getByLabelText('Translation language')).toHaveValue('en')
  })
})

describe('SubtitleEditor — refinement presets', () => {
  it('loads the context from a chosen preset', () => {
    setup({
      config: llmConfig,
      refinementPresets: [{ id: 'rp1', name: 'Lecture', context: 'University lecture' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rp1' } })
    expect(screen.getByPlaceholderText(/Computer science lecture/)).toHaveValue('University lecture')
  })
})

describe('SubtitleEditor — dialogs start from the current state', () => {
  beforeEach(openTranscript)

  const refined = [
    { start: 1500, end: 4000, text: 'Hello there.', speaker: 'SPEAKER_00' },
    { start: 100000, end: 120000, text: 'General Kenobi.', speaker: 'SPEAKER_01' },
  ]

  function dialogTranslateButton() {
    const buttons = screen.getAllByRole('button', { name: 'Translate' })
    return buttons[buttons.length - 1]
  }

  it('translates the refined text by default each time the dialog opens', async () => {
    useStore.setState({ config: llmConfig, refinedUtterances: refined })
    vi.mocked(api.translateTranscription).mockRejectedValue(new Error('network'))
    render(<SubtitleEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    fireEvent.click(dialogTranslateButton())

    await waitFor(() => expect(api.translateTranscription).toHaveBeenCalled())
    expect(vi.mocked(api.translateTranscription).mock.calls[0][2]).toBe('refined')
  })

  it('translates the original when it is chosen in the open dialog', async () => {
    useStore.setState({ config: llmConfig, refinedUtterances: refined })
    vi.mocked(api.translateTranscription).mockRejectedValue(new Error('network'))
    render(<SubtitleEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    fireEvent.click(dialogTranslateButton())

    await waitFor(() => expect(api.translateTranscription).toHaveBeenCalled())
    expect(vi.mocked(api.translateTranscription).mock.calls[0][2]).toBe('original')
  })

  it('switches the open dialog to a refinement that arrives meanwhile', async () => {
    useStore.setState({ config: llmConfig, refinedUtterances: null })
    vi.mocked(api.translateTranscription).mockRejectedValue(new Error('network'))
    render(<SubtitleEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    act(() => useStore.setState({ refinedUtterances: refined }))
    fireEvent.click(dialogTranslateButton())

    await waitFor(() => expect(api.translateTranscription).toHaveBeenCalled())
    expect(vi.mocked(api.translateTranscription).mock.calls[0][2]).toBe('refined')
  })

  it('fills the refinement context from the active bundle\'s preset', () => {
    useStore.setState({
      config: llmConfig,
      activeBundleId: 'b1',
      bundles: [{
        id: 'b1', name: 'Bundle', transcription_preset_id: null, analysis_preset_id: null,
        refinement_preset_id: 'rp1', translate_language: null, is_default: false, created_at: null, updated_at: null,
      }],
      refinementPresets: [{ id: 'rp1', name: 'Lecture', context: 'Biology lecture', created_at: null, updated_at: null }],
    })
    render(<SubtitleEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))

    expect(screen.getByPlaceholderText('e.g. Computer science lecture, speaker is Prof. Müller')).toHaveValue('Biology lecture')
  })
})
