import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../i18n'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'
import { SubtitleEditor } from './SubtitleEditor'
import type { TranscriptionResult } from '../../api/types'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    api: {
      saveTranscription: vi.fn(),
      getTranscription: vi.fn(),
      translateTranscription: vi.fn(),
    },
  }
})

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

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useStore.getState().reset()
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: transcript(),
    speakerMappings: { SPEAKER_00: 'Alice' },
    config: null,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renameFirstSpeaker(name: string) {
  fireEvent.click(screen.getAllByTitle('Edit speaker name')[0])
  const input = screen.getByDisplayValue('Alice')
  fireEvent.change(input, { target: { value: name } })
  fireEvent.blur(input)
}

describe('SubtitleEditor speaker field', () => {
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

describe('SubtitleEditor timestamp fields', () => {
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

describe('SubtitleEditor saving and restoring', () => {
  it('shows the server\'s reason when saving fails and keeps the edits for a retry', async () => {
    vi.mocked(api.saveTranscription).mockRejectedValueOnce(new ApiError(500, 'boom'))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(useStore.getState().unsavedEdits).toBe(true)
    expect(useStore.getState().transcriptionResult!.utterances[0].speaker).toBe('Bob')

    let finishSave!: (value: { status: string }) => void
    vi.mocked(api.saveTranscription).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => finishSave({ status: 'ok' }))
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

  it('shows the server\'s reason when restoring fails and keeps the edits', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.getTranscription).mockRejectedValueOnce(new ApiError(500, 'boom'))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(useStore.getState().unsavedEdits).toBe(true)
    expect(useStore.getState().transcriptionResult!.utterances[0].speaker).toBe('Bob')

    vi.mocked(api.getTranscription).mockResolvedValueOnce(transcript())
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    await waitFor(() => expect(useStore.getState().unsavedEdits).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useStore.getState().transcriptionResult!.utterances[0].speaker).toBe('SPEAKER_00')
  })

  it('shows a general message when restoring fails without a server reason', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.getTranscription).mockRejectedValueOnce(new Error('network'))
    render(<SubtitleEditor />)
    renameFirstSpeaker('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Restoring failed.')
  })
})

describe('SubtitleEditor translation errors', () => {
  function translate() {
    useStore.setState({
      config: {
        asr_backend: 'murmurai',
        whisper_models: [],
        default_model: 'm',
        llm_available: true,
        logout_url: '',
        popular_languages: [],
        enabled_languages: [],
      },
    })
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

describe('SubtitleEditor translating an out-of-date translation again', () => {
  function storeTranslation(stale: boolean) {
    useStore.setState({
      config: {
        asr_backend: 'murmurai',
        whisper_models: [],
        default_model: 'm',
        llm_available: true,
        logout_url: '',
        popular_languages: [],
        enabled_languages: [],
      },
      translatedUtterances: [
        { start: 1500, end: 4000, text: 'Hallo', speaker: 'SPEAKER_00' },
        { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
      ],
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

describe('SubtitleEditor translation language', () => {
  beforeEach(() => {
    useStore.setState({
      config: {
        asr_backend: 'murmurai',
        whisper_models: [],
        default_model: 'm',
        llm_available: true,
        logout_url: '',
        popular_languages: [],
        enabled_languages: [],
      },
    })
  })

  it('preselects the language of the stored translation', () => {
    useStore.setState({
      translatedUtterances: [
        { start: 1500, end: 4000, text: 'Hallo', speaker: 'SPEAKER_00' },
        { start: 100000, end: 120000, text: 'General Kenobi', speaker: 'SPEAKER_01' },
      ],
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

describe('SubtitleEditor compare control', () => {
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
