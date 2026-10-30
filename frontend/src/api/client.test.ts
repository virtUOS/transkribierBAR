import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ApiError, AssistantStreamError, api, streamAssistantChat } from './client'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

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

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let location: { href: string; reload: ReturnType<typeof vi.fn>; protocol: string; host: string }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    location = { href: 'http://app.test/', reload: vi.fn(), protocol: 'http:', host: 'app.test' }
    vi.stubGlobal('location', location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastCall() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined]
    return { url, init: init ?? {} }
  }

  describe('JSON requests', () => {
    it('GETs the path and returns the parsed body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ asr_backend: 'whisperx' }))
      await expect(api.getConfig()).resolves.toEqual({ asr_backend: 'whisperx' })
      const { url, init } = lastCall()
      expect(url).toBe('/api/config')
      expect(init.method).toBeUndefined()
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    })

    it.each([
      ['startTranscription', () => api.startTranscription({ file_id: 'f1' } as never), 'POST', '/api/transcribe', { file_id: 'f1' }],
      ['saveTranscription', () => api.saveTranscription('t1', [{ start: 0, end: 1, text: 'hi', speaker: null }] as never), 'PUT', '/api/transcription/t1', { utterances: [{ start: 0, end: 1, text: 'hi', speaker: null }] }],
      ['updateSpeakers', () => api.updateSpeakers('t1', { SPEAKER_00: 'Ann' }), 'PUT', '/api/transcription/t1/speakers', { mappings: { SPEAKER_00: 'Ann' } }],
      ['renameFile', () => api.renameFile('f1', 'new.mp3'), 'PATCH', '/api/files/f1/rename', { filename: 'new.mp3' }],
      ['renameTitle', () => api.renameTitle('t1', 'Title'), 'PATCH', '/api/transcription/t1/title', { title: 'Title' }],
      ['generateRefinement with context', () => api.generateRefinement('t1', 'ctx'), 'POST', '/api/refine/t1', { context: 'ctx' }],
      ['generateAnalysis', () => api.generateAnalysis('t1', { template: 'summary' }), 'POST', '/api/analysis/t1', { template: 'summary' }],
      ['translateTranscription', () => api.translateTranscription('t1', 'de'), 'POST', '/api/translate/t1', { target_language: 'de' }],
      ['translateTranscription with source', () => api.translateTranscription('t1', 'de', 'refined'), 'POST', '/api/translate/t1', { target_language: 'de', source: 'refined' }],
      ['createApiToken', () => api.createApiToken('ci', 30), 'POST', '/api/tokens', { name: 'ci', expires_in_days: 30 }],
      ['createInvitation', () => api.createInvitation('a@b.c'), 'POST', '/api/invitations', { email: 'a@b.c' }],
      ['acceptInvitation', () => api.acceptInvitation('tok'), 'POST', '/api/invitations/accept', { token: 'tok' }],
      ['createTranscriptionPreset', () => api.createTranscriptionPreset({ name: 'p' } as never), 'POST', '/api/presets/transcription', { name: 'p' }],
      ['updateBundle', () => api.updateBundle('b1', { name: 'b' } as never), 'PUT', '/api/presets/bundles/b1', { name: 'b' }],
    ])('%s sends %s %s with a JSON body', async (_name, call, method, path, body) => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
      await call()
      const { url, init } = lastCall()
      expect(url).toBe(path)
      expect(init.method).toBe(method)
      expect(JSON.parse(init.body as string)).toEqual(body)
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it.each([
      ['deleteTranscription', () => api.deleteTranscription('t1'), 'DELETE', '/api/transcription/t1'],
      ['archiveTranscription', () => api.archiveTranscription('t1'), 'POST', '/api/transcription/t1/archive'],
      ['retryRefinement', () => api.retryRefinement('t1'), 'POST', '/api/refine/t1/retry'],
      ['deleteAnalysisItem', () => api.deleteAnalysisItem('t1', 'a1', 'action_items', 2), 'DELETE', '/api/analysis/t1/a1/items/action_items/2'],
      ['setDefaultBundle', () => api.setDefaultBundle('b1'), 'PUT', '/api/presets/bundles/b1/default'],
      ['clearDefaultBundle', () => api.clearDefaultBundle(), 'DELETE', '/api/presets/default'],
    ])('%s sends %s %s without a body', async (_name, call, method, path) => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
      await call()
      const { url, init } = lastCall()
      expect(url).toBe(path)
      expect(init.method).toBe(method)
      expect(init.body).toBeUndefined()
    })

    it('generateRefinement without context sends no body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))
      await api.generateRefinement('t1')
      expect(lastCall().init.body).toBeUndefined()
      expect(lastCall().init.method).toBe('POST')
    })

    it('throws an ApiError with the server detail on a non-OK response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Not found' }, { status: 404, statusText: 'Not Found' }))
      const err = await api.getTranscription('x').catch((e) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect(err).toMatchObject({ status: 404, message: 'Not found', code: undefined })
    })

    it('falls back to the status text when the error body is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 500, statusText: 'Internal Server Error' }))
      await expect(api.listTranscriptions()).rejects.toMatchObject({
        name: 'ApiError', status: 500, message: 'Internal Server Error',
      })
    })

    it('falls back to the status text when the JSON error has no detail', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { status: 422, statusText: 'Unprocessable Entity' }))
      await expect(api.listTranscriptions()).rejects.toMatchObject({ status: 422, message: 'Unprocessable Entity' })
    })

    it.each([401, 403])('reloads the page on %i so the proxy can re-authenticate', async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, { status }))
      await expect(api.getConfig()).rejects.toThrow('Authentication required')
      expect(location.reload).toHaveBeenCalledOnce()
    })

    it('follows a redirect (auth expired) with a top-level navigation', async () => {
      const response = jsonResponse({})
      Object.defineProperty(response, 'redirected', { value: true })
      Object.defineProperty(response, 'url', { value: 'https://sso.test/login' })
      fetchMock.mockResolvedValue(response)
      await expect(api.getConfig()).rejects.toThrow('Redirected to auth')
      expect(location.href).toBe('https://sso.test/login')
    })

    it('navigates to the app root and rethrows when fetch itself fails', async () => {
      const failure = new TypeError('Failed to fetch')
      fetchMock.mockRejectedValue(failure)
      await expect(api.getConfig()).rejects.toBe(failure)
      expect(location.href).toBe('/')
    })
  })

  describe('uploads', () => {
    it('uploadFile POSTs multipart form data without a JSON content type and passes the abort signal', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'f1' }))
      const file = new File(['abc'], 'a.mp3', { type: 'audio/mpeg' })
      const controller = new AbortController()
      await expect(api.uploadFile(file, controller.signal)).resolves.toEqual({ id: 'f1' })
      const { url, init } = lastCall()
      expect(url).toBe('/api/upload')
      expect(init.method).toBe('POST')
      expect(init.headers).toBeUndefined()
      expect(init.signal).toBe(controller.signal)
      expect((init.body as FormData).get('file')).toBeInstanceOf(File)
      expect(((init.body as FormData).get('file') as File).name).toBe('a.mp3')
    })

    it('uploadFile throws an ApiError with the server detail', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'File too large' }, { status: 413 }))
      await expect(api.uploadFile(new File(['x'], 'a.mp3'))).rejects.toMatchObject({
        name: 'ApiError', status: 413, message: 'File too large',
      })
    })

    it('uploadRecording tells the server whether the recording has video', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ id: 'f2' }))
      await api.uploadRecording(new File(['x'], 'r.webm'), true)
      expect(lastCall().url).toBe('/api/upload?has_video=true')
      await api.uploadRecording(new File(['x'], 'r.webm'), false)
      expect(lastCall().url).toBe('/api/upload?has_video=false')
    })

    it('uploadRecording throws the server detail on failure', async () => {
      fetchMock.mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }))
      await expect(api.uploadRecording(new File(['x'], 'r.webm'), false)).rejects.toThrow('Server Error')
    })
  })

  describe('exports and deletes outside the JSON helper', () => {
    it('exportTranscription returns the raw text of the requested format', async () => {
      fetchMock.mockResolvedValue(new Response('WEBVTT\n'))
      await expect(api.exportTranscription('t1', 'vtt')).resolves.toBe('WEBVTT\n')
      expect(lastCall().url).toBe('/api/transcription/t1/export/vtt')
    })

    it('exportTranscription throws on a non-OK response', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 500 }))
      await expect(api.exportTranscription('t1', 'srt')).rejects.toThrow('Export failed')
    })

    it.each([
      ['revokeApiToken', (id: string) => api.revokeApiToken(id), '/api/tokens/'],
      ['revokeInvitation', (id: string) => api.revokeInvitation(id), '/api/invitations/'],
    ])('%s DELETEs the item and resolves on success', async (_name, call, prefix) => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
      await expect(call('x1')).resolves.toBeUndefined()
      expect(lastCall().url).toBe(`${prefix}x1`)
      expect(lastCall().init.method).toBe('DELETE')
    })

    it.each([
      ['revokeApiToken', (id: string) => api.revokeApiToken(id)],
      ['revokeInvitation', (id: string) => api.revokeInvitation(id)],
    ])('%s throws the status text on failure', async (_name, call) => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }))
      await expect(call('x1')).rejects.toThrow('Not Found')
    })
  })

  describe('URLs', () => {
    it('builds media URLs', () => {
      expect(api.getMediaUrl('f1')).toBe('/api/media/f1')
      expect(api.getMediaFallbackUrl('f1')).toBe('/api/media/f1/fallback')
    })

    it.each([
      ['http:', 'ws:'],
      ['https:', 'wss:'],
    ])('opens the status WebSocket over the matching protocol (%s → %s)', (protocol, wsProtocol) => {
      location.protocol = protocol
      const WS = vi.fn()
      vi.stubGlobal('WebSocket', WS)
      api.connectWebSocket('t1')
      expect(WS).toHaveBeenCalledWith(`${wsProtocol}//app.test/api/ws/status/t1`)
    })
  })

  describe('subpath deployment', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('prefixes every URL with the base path', async () => {
      vi.stubEnv('BASE_URL', '/test/')
      vi.resetModules()
      const { api: subApi } = await import('./client')
      fetchMock.mockResolvedValue(jsonResponse({}))
      await subApi.getConfig()
      expect(lastCall().url).toBe('/test/api/config')
      expect(subApi.getMediaUrl('f1')).toBe('/test/api/media/f1')
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(subApi.getConfig()).rejects.toThrow('Failed to fetch')
      expect(location.href).toBe('/test/')
    })
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
