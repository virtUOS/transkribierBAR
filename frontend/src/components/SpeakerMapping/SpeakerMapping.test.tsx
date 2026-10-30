import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api, ApiError } from '../../api/client'
import { SpeakerMapping } from './SpeakerMapping'
import type { TranscriptionResult, Utterance } from '../../api/types'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, api: { updateSpeakers: vi.fn() } }
})

const PLACEHOLDER = 'New name (leave empty to keep)'

function setup(speakers: (string | null)[], mappings: Record<string, string> = {}) {
  const utterances: Utterance[] = speakers.map((speaker, i) => ({ start: i * 1000, end: i * 1000 + 900, text: `u${i}`, speaker }))
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: { id: 't1', utterances } as TranscriptionResult,
    speakerMappings: mappings,
  })
}

function renderOpen() {
  const onClose = vi.fn()
  const utils = render(<SpeakerMapping isOpen onClose={onClose} />)
  return { onClose, ...utils }
}

function typeFirstName(name: string): HTMLElement {
  const input = screen.getAllByPlaceholderText(PLACEHOLDER)[0]
  fireEvent.change(input, { target: { value: name } })
  return input
}

const initialState = useStore.getState()

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(api.updateSpeakers).mockResolvedValue({ status: 'ok' })
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
})

describe('SpeakerMapping', () => {
  it('renders nothing when closed', () => {
    setup(['SPEAKER_00'])
    const { container } = render(<SpeakerMapping isOpen={false} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each speaker once, sorted, with an empty input', () => {
    setup(['SPEAKER_01', 'SPEAKER_00', 'SPEAKER_01', null])
    renderOpen()
    expect(screen.getByRole('heading', { name: 'Speaker Names' })).toBeInTheDocument()
    const inputs = screen.getAllByPlaceholderText(PLACEHOLDER)
    expect(inputs).toHaveLength(2)
    inputs.forEach((i) => expect(i).toHaveValue(''))
    const labels = screen.getAllByText(/^SPEAKER_0\d$/).map((e) => e.textContent)
    expect(labels).toEqual(['SPEAKER_00', 'SPEAKER_01'])
    expect(screen.getByText('Tip: give two speakers the same name to merge them.')).toBeInTheDocument()
  })

  it('says so when no speakers were detected', () => {
    setup([null, null])
    renderOpen()
    expect(screen.getByText('No speakers detected.')).toBeInTheDocument()
  })

  it('renames a speaker, saves the mapping and closes', async () => {
    setup(['SPEAKER_00', 'SPEAKER_01'])
    const { onClose } = renderOpen()
    const [first] = screen.getAllByPlaceholderText(PLACEHOLDER)
    fireEvent.change(first, { target: { value: '  Ann  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.updateSpeakers).toHaveBeenCalledWith('t1', { SPEAKER_00: 'Ann' })
    expect(useStore.getState().speakerMappings).toEqual({ SPEAKER_00: 'Ann' })
  })

  it('does not call the server when nothing was typed', async () => {
    setup(['SPEAKER_00'])
    const { onClose } = renderOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.updateSpeakers).not.toHaveBeenCalled()
  })

  it('ignores whitespace-only input and renaming to the current name', async () => {
    setup(['SPEAKER_00', 'SPEAKER_01'], { SPEAKER_01: 'Bob' })
    const { onClose } = renderOpen()
    const [bob, sp0] = screen.getAllByPlaceholderText(PLACEHOLDER)
    fireEvent.change(bob, { target: { value: 'Bob' } })
    fireEvent.change(sp0, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.updateSpeakers).not.toHaveBeenCalled()
  })

  it('merges speakers that share a display name into one row and renames all of them', async () => {
    setup(['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'], { SPEAKER_00: 'Ann', SPEAKER_01: 'Ann' })
    renderOpen()
    expect(screen.getByText('(2 merged)')).toBeInTheDocument()
    const inputs = screen.getAllByPlaceholderText(PLACEHOLDER)
    expect(inputs).toHaveLength(2)
    fireEvent.change(inputs[0], { target: { value: 'Anna' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(api.updateSpeakers).toHaveBeenCalled())
    expect(api.updateSpeakers).toHaveBeenCalledWith('t1', { SPEAKER_00: 'Anna', SPEAKER_01: 'Anna' })
  })

  it('suggests existing custom names, not placeholders', () => {
    setup(['SPEAKER_00', 'SPEAKER_01'], { SPEAKER_01: 'Bob' })
    const { container } = renderOpen()
    const options = Array.from(container.querySelectorAll('datalist option')).map((o) => o.getAttribute('value'))
    expect(options).toEqual(['Bob'])
  })

  it('cancels without saving', () => {
    setup(['SPEAKER_00'])
    const { onClose } = renderOpen()
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.updateSpeakers).not.toHaveBeenCalled()
  })

  it('starts with empty inputs again when re-opened', () => {
    setup(['SPEAKER_00'])
    const { rerender } = renderOpen()
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Ann' } })
    rerender(<SpeakerMapping isOpen={false} onClose={() => {}} />)
    rerender(<SpeakerMapping isOpen onClose={() => {}} />)
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('')
  })

  it('focuses the row of the requested speaker', async () => {
    setup(['SPEAKER_00', 'SPEAKER_01'])
    Element.prototype.scrollIntoView = vi.fn()
    render(<SpeakerMapping isOpen onClose={() => {}} focusSpeaker="SPEAKER_01" />)
    const inputs = screen.getAllByPlaceholderText(PLACEHOLDER)
    await waitFor(() => expect(inputs[1]).toHaveFocus())
  })
})

describe('SpeakerMapping applying names', () => {
  beforeEach(() => {
    setup(['SPEAKER_00', 'SPEAKER_01'])
  })

  it('shows the server\'s reason when saving fails and keeps the panel open with the typed name', async () => {
    vi.mocked(api.updateSpeakers).mockRejectedValueOnce(new ApiError(500, 'boom'))
    const onClose = vi.fn()
    render(<SpeakerMapping isOpen onClose={onClose} />)
    const input = typeFirstName('Alice')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(onClose).not.toHaveBeenCalled()
    expect(input).toHaveValue('Alice')
    expect(useStore.getState().speakerMappings).toEqual({})

    vi.mocked(api.updateSpeakers).mockResolvedValueOnce({ status: 'ok' })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useStore.getState().speakerMappings).toEqual({ SPEAKER_00: 'Alice' })
  })

  it('shows a general message when saving fails without a server reason', async () => {
    vi.mocked(api.updateSpeakers).mockRejectedValueOnce(new Error('network'))
    render(<SpeakerMapping isOpen onClose={vi.fn()} />)
    typeFirstName('Alice')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Saving the speaker names failed.')
  })

  it('does not show an old error after the panel is closed and opened again', async () => {
    vi.mocked(api.updateSpeakers).mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { rerender } = render(<SpeakerMapping isOpen onClose={vi.fn()} />)
    typeFirstName('Alice')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByRole('alert')
    rerender(<SpeakerMapping isOpen={false} onClose={vi.fn()} />)
    rerender(<SpeakerMapping isOpen onClose={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
