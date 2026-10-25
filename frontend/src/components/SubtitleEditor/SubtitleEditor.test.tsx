import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api, ApiError } from '../../api/client'
import { SubtitleEditor } from './SubtitleEditor'
import type { RefinementMetadata, TranscriptionResult, Utterance } from '../../api/types'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    saveTranscription: vi.fn(),
    getTranscription: vi.fn(),
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

function setup(state: Record<string, unknown> = {}, utterances: Utterance[] = base) {
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: { id: 't1', status: 'completed', utterances } as TranscriptionResult,
    ...state,
  })
  return render(<SubtitleEditor />)
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
  confirmSpy.mockRestore()
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
    vi.mocked(api.saveTranscription).mockResolvedValue({ status: 'ok' })
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

  it('keeps the edits dirty when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(api.saveTranscription).mockRejectedValue(new Error('offline'))
    setup({ unsavedEdits: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.saveTranscription).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled())
    expect(useStore.getState().unsavedEdits).toBe(true)
  })

  it.todo(
    'tells the user when saving fails (bug https://github.com/virtUOS/transkribierBAR/issues/246: handleSave only '
    + 'logs the error to the console, so the user sees no message)',
  )

  it('refreshes the refinement staleness after saving when a refinement exists', async () => {
    vi.mocked(api.saveTranscription).mockResolvedValue({ status: 'ok' })
    vi.mocked(api.getRefinement).mockResolvedValue({ utterances: [], metadata: meta(), stale: true })
    setup({ unsavedEdits: true, refinementMetadata: meta(), refinedUtterances: base })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(useStore.getState().refinementStale).toBe(true))
  })

  it('restores the original after confirmation', async () => {
    const original = { id: 't1', status: 'completed', utterances: base } as TranscriptionResult
    vi.mocked(api.getTranscription).mockResolvedValue(original)
    setup({ unsavedEdits: true }, [{ start: 0, end: 1, text: 'edited', speaker: null }])
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard all unsaved changes and restore the original transcription?')
    await waitFor(() => expect(useStore.getState().transcriptionResult).toBe(original))
    expect(useStore.getState().unsavedEdits).toBe(false)
  })

  it('does not restore when the user declines', () => {
    confirmSpy.mockReturnValue(false)
    setup({ unsavedEdits: true })
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(api.getTranscription).not.toHaveBeenCalled()
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

  it.todo(
    'leaves a mapped speaker untouched when its field is opened and left without changes '
    + '(bug https://github.com/virtUOS/transkribierBAR/issues/243: the field is pre-filled with the display name and blur '
    + 'always commits, so the speaker ID is replaced by the name)',
  )

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

  it.todo(
    'opening and leaving a timestamp editor without changes keeps millisecond precision '
    + '(bug https://github.com/virtUOS/transkribierBAR/issues/242: the field is pre-filled with formatTime(), which drops milliseconds, and blur always '
    + 'commits — start 1500 becomes 1000 and the transcript turns dirty; SubtitleRow.tsx:106,145-149,162)',
  )
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

describe('SubtitleEditor — refinement', () => {
  const refined: Utterance[] = base.map((u, i) => (i === 0 ? { ...u, text: 'Hello, world!' } : u))

  it('hides the AI buttons without an LLM', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Refine with LLM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument()
  })

  it('refines with context and switches to the refined view', async () => {
    vi.mocked(api.generateRefinement).mockResolvedValue({ utterances: refined, metadata: meta(), stale: false })
    setup({ config: { llm_available: true } })
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
    setup({ config: { llm_available: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await waitFor(() => expect(api.generateRefinement).toHaveBeenCalledWith('t1', undefined))
  })

  it('shows an error in the dialog when refinement fails', async () => {
    vi.mocked(api.generateRefinement).mockRejectedValue(new Error('LLM down'))
    setup({ config: { llm_available: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Refinement failed. Please try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns that long transcripts take a while', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 900, text: `u${i}`, speaker: null }))
    setup({ config: { llm_available: true } }, many)
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    expect(screen.getByText('This transcription has 51 utterances. Refinement may take several minutes.')).toBeInTheDocument()
  })

  it('is read-only in the refined view and shows a diff for changed rows', () => {
    setup({ refinedUtterances: refined, refinementMetadata: meta(), activeView: 'refined' })
    expect(screen.queryAllByTitle('Edit text')).toHaveLength(0)
    expect(screen.queryAllByTitle('Delete this row')).toHaveLength(0)
    fireEvent.click(bodyRows()[0])
    expect(screen.getByText('Original:')).toBeInTheDocument()
    expect(screen.getByText('Hello world.')).toBeInTheDocument()
    // Unchanged rows do not open a diff.
    fireEvent.click(bodyRows()[2])
    expect(screen.getAllByText('Original:')).toHaveLength(1)
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

describe('SubtitleEditor — translation', () => {
  const translated: Utterance[] = base.map((u) => ({ ...u, text: `DE ${u.text}` }))
  const translationResult = {
    utterances: translated, language: 'de', source: 'original' as const, source_hash: null, stale: false, source_available: true,
  }

  it('translates the original when there is no refinement', async () => {
    vi.mocked(api.translateTranscription).mockResolvedValue(translationResult)
    setup({ config: { llm_available: true, enabled_languages: [], popular_languages: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    fireEvent.change(screen.getByLabelText('Translation language'), { target: { value: 'de' } })
    const dialog = screen.getByRole('heading', { name: 'Translate to' }).parentElement!
    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(useStore.getState().activeView).toBe('translated'))
    expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'de', undefined)
    expect(screen.getByText('DE Hello world.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Translated (DE · from original)' })).toBeInTheDocument()
    expect(screen.queryAllByTitle('Edit text')).toHaveLength(0)
  })

  it('lets the user pick the source when a refinement exists (refined by default)', async () => {
    vi.mocked(api.translateTranscription).mockResolvedValue({ ...translationResult, source: 'refined' })
    setup({
      config: { llm_available: true, enabled_languages: [], popular_languages: [] },
      refinedUtterances: base, refinementMetadata: meta(),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    const dialog = screen.getByRole('heading', { name: 'Translate to' }).parentElement!
    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'en', 'refined'))
  })

  it('can translate the original even when a refinement exists', async () => {
    vi.mocked(api.translateTranscription).mockResolvedValue(translationResult)
    setup({
      config: { llm_available: true, enabled_languages: [], popular_languages: [] },
      refinedUtterances: base, refinementMetadata: meta(),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    const dialog = screen.getByRole('heading', { name: 'Translate to' }).parentElement!
    fireEvent.click(within(dialog).getByRole('button', { name: 'Original' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(api.translateTranscription).toHaveBeenCalledWith('t1', 'en', 'original'))
  })

  it('shows an error when translation fails', async () => {
    vi.mocked(api.translateTranscription).mockRejectedValue(new Error('x'))
    setup({ config: { llm_available: true, enabled_languages: [], popular_languages: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    const dialog = screen.getByRole('heading', { name: 'Translate to' }).parentElement!
    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Translation failed. Please try again.')
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

describe('SubtitleEditor — refinement presets', () => {
  it('loads the context from a chosen preset', () => {
    setup({
      config: { llm_available: true },
      refinementPresets: [{ id: 'rp1', name: 'Lecture', context: 'University lecture' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rp1' } })
    expect(screen.getByPlaceholderText(/Computer science lecture/)).toHaveValue('University lecture')
  })

  it('pre-selects the refinement preset of the active bundle', async () => {
    setup({
      config: { llm_available: true },
      refinementPresets: [{ id: 'rp1', name: 'Lecture', context: 'University lecture' }],
      bundles: [{ id: 'b1', name: 'B', refinement_preset_id: 'rp1' }],
      activeBundleId: 'b1',
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refine with LLM' }))
    })
    expect(screen.getByPlaceholderText(/Computer science lecture/)).toHaveValue('University lecture')
  })
})
