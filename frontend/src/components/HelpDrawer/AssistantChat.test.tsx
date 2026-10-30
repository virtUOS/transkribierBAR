import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssistantStreamError, streamAssistantChat } from '../../api/client'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { AssistantChat } from './AssistantChat'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  streamAssistantChat: vi.fn(),
}))

type Opts = { onDelta: (t: string) => void; signal?: AbortSignal }
const mockStream = vi.mocked(streamAssistantChat)
const initialState = useStore.getState()

beforeEach(async () => {
  useStore.setState(initialState, true)
  useStore.getState().resetAssistant()
  mockStream.mockReset()
  await i18n.changeLanguage('de')
})

describe('AssistantChat', () => {
  it('starter question sends and renders the streamed markdown answer', async () => {
    mockStream.mockImplementation(async (_b, opts: Opts) => {
      opts.onDelta('**Fett** und [Handbuch](/handbuch/)')
    })
    render(<AssistantChat />)
    fireEvent.click(screen.getByRole('button', { name: 'Wie benenne ich die Sprechenden um?' }))
    const strong = await screen.findByText('Fett')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'Handbuch' })).toHaveAttribute('target', '_blank')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Antwort des Assistenten ist da.'))
  })

  it('Enter sends, Shift+Enter does not', async () => {
    mockStream.mockResolvedValue(undefined)
    render(<AssistantChat />)
    const box = screen.getByPlaceholderText('Ihre Frage …')
    expect(box).toHaveAttribute('maxlength', '4000')
    fireEvent.change(box, { target: { value: 'Hallo' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(mockStream).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(1))
    expect(box).toHaveValue('')
  })

  it('shows the error and retries', async () => {
    mockStream.mockRejectedValueOnce(new AssistantStreamError('llm_error'))
    render(<AssistantChat />)
    const box = screen.getByPlaceholderText('Ihre Frage …')
    fireEvent.change(box, { target: { value: 'Hallo' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Der Assistent konnte keine Antwort erzeugen.')).toBeInTheDocument()
    mockStream.mockImplementation(async (_b, opts: Opts) => opts.onDelta('ok'))
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('ok')).toBeInTheDocument()
  })

  it('new conversation clears the messages', async () => {
    mockStream.mockImplementation(async (_b, opts: Opts) => opts.onDelta('Antwort'))
    render(<AssistantChat />)
    const box = screen.getByPlaceholderText('Ihre Frage …')
    fireEvent.change(box, { target: { value: 'Frage' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Antwort')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Neues Gespräch' }))
    expect(screen.queryByText('Antwort')).not.toBeInTheDocument()
    expect(screen.getByText('Fragen Sie mich, wie etwas in transkribierBAR funktioniert.')).toBeInTheDocument()
  })

  it('renders both notes', () => {
    render(<AssistantChat />)
    expect(screen.getByText('Antworten erzeugt ein Sprachmodell. Sie können Fehler enthalten.')).toBeInTheDocument()
    expect(screen.getByText('transkribierBAR speichert dieses Gespräch nicht.')).toBeInTheDocument()
  })

  describe('announcement and focus', () => {
    function deferStream() {
      let finish: () => void = () => {}
      let fail: (e: Error) => void = () => {}
      mockStream.mockImplementation(
        (_b, opts: Opts) =>
          new Promise<void>((resolve, reject) => {
            opts.onDelta('Antwort')
            finish = resolve
            fail = reject
          }),
      )
      return { finish: () => finish(), fail: (e: Error) => fail(e) }
    }
    const ask = () => {
      const box = screen.getByPlaceholderText('Ihre Frage …')
      fireEvent.change(box, { target: { value: 'Frage' } })
      fireEvent.keyDown(box, { key: 'Enter' })
    }

    it('does not announce on mount', () => {
      render(<AssistantChat />)
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('announces exactly once after a finished answer', async () => {
      const d = deferStream()
      render(<AssistantChat />)
      ask()
      await screen.findByText('Antwort')
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      await act(async () => d.finish())
      expect(screen.getAllByText('Antwort des Assistenten ist da.')).toHaveLength(1)
    })

    it('does not announce when the conversation is reset mid-stream', async () => {
      deferStream()
      render(<AssistantChat />)
      ask()
      await screen.findByText('Antwort')
      fireEvent.click(screen.getByRole('button', { name: 'Neues Gespräch' }))
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('does not announce on an error', async () => {
      const d = deferStream()
      render(<AssistantChat />)
      ask()
      await screen.findByText('Antwort')
      await act(async () => d.fail(new AssistantStreamError('incomplete')))
      expect(await screen.findByText('Die Antwort ist unvollständig angekommen.')).toBeInTheDocument()
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('keeps focus in the textarea after a starter is sent and the stream finishes', async () => {
      const d = deferStream()
      render(<AssistantChat />)
      fireEvent.click(screen.getByRole('button', { name: 'Wie benenne ich die Sprechenden um?' }))
      await screen.findByText('Antwort')
      const box = screen.getByPlaceholderText('Ihre Frage …')
      expect(box).toHaveFocus()
      await act(async () => d.finish())
      expect(box).toHaveFocus()
    })
  })
})
