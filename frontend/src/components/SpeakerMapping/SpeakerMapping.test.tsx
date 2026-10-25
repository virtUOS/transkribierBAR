import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api } from '../../api/client'
import { SpeakerMapping } from './SpeakerMapping'
import type { TranscriptionResult, Utterance } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { updateSpeakers: vi.fn() },
}))

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

  it.todo(
    'shows an error when saving the names fails (bug https://github.com/virtUOS/transkribierBAR/issues/245: handleApply has no try/catch, so a failing '
    + 'api.updateSpeakers becomes an unhandled rejection with no feedback — SpeakerMapping.tsx:103)',
  )
})
