import { afterEach, describe, it, expect, vi } from 'vitest'
import { ApiError, AssistantStreamError, api, streamAssistantChat } from './client'

describe('ApiError', () => {
  it('keeps the status and uses the server detail as the message', () => {
    const e = new ApiError(409, 'Transcript changed')
    expect(e.status).toBe(409)
    expect(e.message).toBe('Transcript changed')
  })

  it('carries the code the server sends with the detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'malformed', code: 'malformed_reply' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )))
    try {
      await expect(api.generateAnalysis('t1', { template: 'summary' })).rejects.toMatchObject({
        name: 'ApiError', status: 502, message: 'malformed', code: 'malformed_reply',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('is still an Error, so existing catch blocks keep working', () => {
    const e = new ApiError(500, 'boom')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('ApiError')
  })
})

describe('api.promptBudget', () => {
  // It runs in the background while people type; request() would navigate away and lose the upload.
  it('fails without leaving the page', async () => {
    const navigations: string[] = []
    vi.stubGlobal('location', {
      set href(url: string) { navigations.push(url) },
      reload: () => { navigations.push('reload') },
    })
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      await expect(api.promptBudget({ initial_prompt: 'Sitzung', hotwords: null })).rejects.toThrow()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
      await expect(api.promptBudget({ initial_prompt: 'Sitzung', hotwords: null })).rejects.toThrow()

      expect(navigations).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('streamAssistantChat', () => {
  const body = { messages: [{ role: 'user' as const, content: 'x' }], lang: 'en' as const, view: 'archive' as const }
  const sse = (text: string) => new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

  afterEach(() => vi.unstubAllGlobals())

  it('delivers deltas and resolves on done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('data: {"delta": "A"}\n\ndata: {"delta": "B"}\n\nevent: done\ndata: {}\n\n')))
    const got: string[] = []
    await streamAssistantChat(body, { onDelta: (t) => got.push(t) })
    expect(got).toEqual(['A', 'B'])
  })

  it('throws the code of an error frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('data: {"delta": "A"}\n\nevent: error\ndata: {"code": "output_limit"}\n\n')))
    await expect(streamAssistantChat(body, { onDelta: () => {} })).rejects.toMatchObject({ code: 'output_limit' })
  })

  it('throws incomplete when the stream ends without done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('data: {"delta": "A"}\n\n')))
    await expect(streamAssistantChat(body, { onDelta: () => {} })).rejects.toBeInstanceOf(AssistantStreamError)
  })

  it('turns a 429 into an ApiError with its code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'busy', code: 'assistant_busy' }), { status: 429 },
    )))
    await expect(streamAssistantChat(body, { onDelta: () => {} })).rejects.toMatchObject({ status: 429, code: 'assistant_busy' })
  })
})
