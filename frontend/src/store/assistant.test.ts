import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, AssistantStreamError, streamAssistantChat } from '../api/client'
import type { AssistantChatRequest, AssistantMessage } from '../api/types'
import { trimHistory, useStore } from './index'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  streamAssistantChat: vi.fn(),
}))

type Opts = { onDelta: (t: string) => void; signal?: AbortSignal }
const mockStream = vi.mocked(streamAssistantChat)
const initialState = useStore.getState()

describe('assistant store', () => {
  beforeEach(() => {
    useStore.setState(initialState, true)
    useStore.getState().resetAssistant()
    mockStream.mockReset()
  })

  it('sends the question with view, language and open transcription', async () => {
    useStore.setState({ currentView: 'detail', transcriptionId: 't1' })
    mockStream.mockImplementation(async (_body, opts: Opts) => {
      opts.onDelta('A')
      opts.onDelta('B')
    })
    await useStore.getState().sendAssistantMessage('Wie?')
    const body = mockStream.mock.calls[0][0] as AssistantChatRequest
    expect(body.view).toBe('detail')
    expect(body.transcription_id).toBe('t1')
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'Wie?' })
    const s = useStore.getState()
    expect(s.assistantMessages[s.assistantMessages.length - 1]).toEqual({ role: 'assistant', content: 'AB' })
    expect(s.assistantStatus).toBe('idle')
    expect(s.assistantError).toBeNull()
  })

  it('trimHistory keeps the newest messages within limits', () => {
    const msgs: AssistantMessage[] = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }))
    const t = trimHistory(msgs)
    expect(t.length).toBeLessThanOrEqual(20)
    expect(t[0].role).toBe('user')
    expect(t[t.length - 1]).toEqual(msgs[24])

    const big: AssistantMessage[] = [
      { role: 'user', content: 'a'.repeat(30000) },
      { role: 'assistant', content: 'b'.repeat(30000) },
      { role: 'user', content: 'c'.repeat(10) },
    ]
    const tb = trimHistory(big)
    expect(tb).toEqual([big[2]])
  })

  it('keeps a partial answer and records the error', async () => {
    mockStream.mockImplementation(async (_b, opts: Opts) => {
      opts.onDelta('Teil')
      throw new AssistantStreamError('llm_error')
    })
    await useStore.getState().sendAssistantMessage('Wie?')
    const s = useStore.getState()
    expect(s.assistantMessages[s.assistantMessages.length - 1].content).toBe('Teil')
    expect(s.assistantError).toBe('llm_error')
    expect(s.assistantStatus).toBe('idle')
  })

  it('retry drops the partial answer and resends without duplicating the question', async () => {
    mockStream.mockImplementationOnce(async (_b, opts: Opts) => {
      opts.onDelta('Teil')
      throw new AssistantStreamError('llm_error')
    })
    await useStore.getState().sendAssistantMessage('Wie?')
    mockStream.mockImplementationOnce(async (_b, opts: Opts) => {
      opts.onDelta('Ganz')
    })
    await useStore.getState().retryAssistant()
    const body = mockStream.mock.calls[1][0] as AssistantChatRequest
    expect(body.messages.filter((m) => m.role === 'user' && m.content === 'Wie?')).toHaveLength(1)
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'Wie?' })
    const s = useStore.getState()
    expect(s.assistantMessages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(s.assistantMessages[s.assistantMessages.length - 1].content).toBe('Ganz')
    expect(s.assistantError).toBeNull()
  })

  it('busy error code comes from ApiError', async () => {
    mockStream.mockRejectedValue(new ApiError(429, 'busy', 'assistant_busy'))
    await useStore.getState().sendAssistantMessage('Wie?')
    const s = useStore.getState()
    expect(s.assistantError).toBe('assistant_busy')
    expect(s.assistantMessages).toEqual([{ role: 'user', content: 'Wie?' }])
  })

  it('maps other failures to server_error and network', async () => {
    mockStream.mockRejectedValueOnce(new ApiError(500, 'x'))
    await useStore.getState().sendAssistantMessage('a')
    expect(useStore.getState().assistantError).toBe('server_error')
    mockStream.mockRejectedValueOnce(new TypeError('failed'))
    await useStore.getState().retryAssistant()
    expect(useStore.getState().assistantError).toBe('network')
  })

  it('reset aborts and clears', async () => {
    let signal: AbortSignal | undefined
    mockStream.mockImplementation((_b, opts: Opts) => {
      signal = opts.signal
      return new Promise<void>((_res, rej) => {
        opts.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    })
    const p = useStore.getState().sendAssistantMessage('Wie?')
    useStore.getState().resetAssistant()
    await p
    expect(signal?.aborted).toBe(true)
    const s = useStore.getState()
    expect(s.assistantMessages).toEqual([])
    expect(s.assistantError).toBeNull()
    expect(s.assistantStatus).toBe('idle')
  })
})
