import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { useStore } from '../../store'
import { api, ApiError } from '../../api/client'
import { SpeakerMapping } from './SpeakerMapping'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, api: { updateSpeakers: vi.fn() } }
})

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useStore.getState().reset()
  useStore.setState({
    transcriptionId: 't1',
    transcriptionResult: {
      id: 't1',
      status: 'completed',
      text: '',
      language: 'en',
      speaker_mappings: {},
      summary: null,
      protocol: null,
      utterances: [
        { start: 0, end: 1000, text: 'Hi', speaker: 'SPEAKER_00' },
        { start: 1000, end: 2000, text: 'Hello', speaker: 'SPEAKER_01' },
      ],
    },
    speakerMappings: {},
  })
})

function typeFirstName(name: string): HTMLElement {
  const input = screen.getAllByPlaceholderText('New name (leave empty to keep)')[0]
  fireEvent.change(input, { target: { value: name } })
  return input
}

describe('SpeakerMapping applying names', () => {
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
