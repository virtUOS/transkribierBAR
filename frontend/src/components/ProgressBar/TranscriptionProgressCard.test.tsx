import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useStore } from '../../store'
import { api } from '../../api/client'
import i18n from '../../i18n'
import { TranscriptionProgressCard } from './TranscriptionProgressCard'
import type { TranscriptionListItem } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: {
    connectWebSocket: vi.fn(),
    getStatus: vi.fn(),
    getTranscription: vi.fn(),
  },
}))

class FakeSocket {
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

const RESTART_TEXT = 'The server restarted while this transcription was running.'

// The detail line as the German UI shows it, failing if the reason has no German text.
function germanDetail(reasonKey: string): string {
  const reason = i18n.getResource('de', 'translation', reasonKey)
  expect(reason).toEqual(expect.any(String))
  return i18n.t('transcription.failedDetail', { lng: 'de', message: reason })
}

describe('TranscriptionProgressCard failure reason', () => {
  let sockets: FakeSocket[]

  beforeEach(async () => {
    vi.clearAllMocks()
    useStore.getState().reset()
    await i18n.changeLanguage('de')
    sockets = []
    vi.mocked(api.connectWebSocket).mockImplementation(() => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    })
    useStore.setState({ transcriptionId: 't1', transcriptionStatus: 'processing' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a known reason from the WebSocket in the German UI', () => {
    render(<TranscriptionProgressCard />)

    act(() => sockets[0].receive({
      type: 'status', status: 'failed', error: RESTART_TEXT, error_code: 'server_restarted',
    }))

    expect(screen.getByText(germanDetail('transcription.errors.server_restarted'))).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(RESTART_TEXT))).toBeNull()
  })

  // The German hint, failing if it has no German text.
  function germanHint(): string {
    const hint = i18n.getResource('de', 'translation', 'transcription.autoLanguageHint')
    expect(hint).toEqual(expect.any(String))
    return hint
  }

  it('suggests choosing the language when the speech recognition failed on Auto-detect', () => {
    render(<TranscriptionProgressCard autoLanguage />)

    act(() => sockets[0].receive({ type: 'status', status: 'failed', error: 'x', error_code: 'asr_failed' }))

    expect(screen.getByText(germanHint())).toBeInTheDocument()
  })

  it('gives no language hint when the language was chosen', () => {
    render(<TranscriptionProgressCard />)

    act(() => sockets[0].receive({ type: 'status', status: 'failed', error: 'x', error_code: 'asr_failed' }))

    expect(screen.queryByText(germanHint())).toBeNull()
  })

  it('gives no language hint for a failure the speech recognition did not report', () => {
    render(<TranscriptionProgressCard autoLanguage />)

    act(() => sockets[0].receive({ type: 'status', status: 'failed', error: RESTART_TEXT, error_code: 'server_restarted' }))

    expect(screen.queryByText(germanHint())).toBeNull()
  })

  it('shows the server text for a failure without a known code', () => {
    render(<TranscriptionProgressCard />)

    act(() => sockets[0].receive({ type: 'status', status: 'failed', error: 'asr exploded', error_code: 'unknown' }))

    expect(screen.getByText(/asr exploded/)).toBeInTheDocument()
  })

  it('loads the reason of a transcription that is already failed when it opens', async () => {
    // Opened from the overview: no socket, so the reason has to be fetched.
    useStore.setState({ transcriptionStatus: 'failed' })
    vi.mocked(api.getStatus).mockResolvedValue({
      id: 't1', status: 'failed', progress: null, error: 'ASR job exceeded 1800s', error_code: 'timeout',
    })

    render(<TranscriptionProgressCard autoLanguage />)

    expect(await screen.findByText(germanDetail('transcription.errors.timeout'))).toBeInTheDocument()
    expect(api.getStatus).toHaveBeenCalledWith('t1')
    expect(api.connectWebSocket).not.toHaveBeenCalled()
    expect(screen.queryByText(germanHint())).toBeNull()
  })

  it('shows the language hint for an already failed Auto-detect transcription', async () => {
    useStore.setState({ transcriptionStatus: 'failed' })
    vi.mocked(api.getStatus).mockResolvedValue({ id: 't1', status: 'failed', progress: null, error: 'x', error_code: 'asr_failed' })

    render(<TranscriptionProgressCard autoLanguage />)

    expect(await screen.findByText(germanHint())).toBeInTheDocument()
  })

  it('shows a known reason from the status poll in the German UI', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.mocked(api.getStatus).mockResolvedValue({
      id: 't1', status: 'failed', progress: null, error: 'ASR job x stuck', error_code: 'timeout',
    })
    render(<TranscriptionProgressCard />)

    // Five reconnects fail, then the card falls back to polling the status.
    for (let i = 0; i < 6; i++) {
      act(() => sockets[i].onclose?.())
      await act(() => vi.advanceTimersByTimeAsync(30000))
    }

    expect(screen.getByText(germanDetail('transcription.errors.timeout'))).toBeInTheDocument()
    expect(screen.queryByText(/ASR job x stuck/)).toBeNull()
  })
})

function historyItem(id: string): TranscriptionListItem {
  return {
    id,
    file_id: `f-${id}`,
    original_filename: `${id}.mp3`,
    status: 'processing',
    language: 'en',
    model: 'm',
    created_at: '2026-01-01T00:00:00Z',
    file_size: 1,
    expires_at: '2026-04-01T00:00:00Z',
    archived: false,
    title: null,
    has_video: false,
  }
}

function titleOf(id: string): string | null | undefined {
  return useStore.getState().transcriptionHistory.find((h) => h.id === id)?.title
}

describe('TranscriptionProgressCard generated title', () => {
  let sockets: FakeSocket[]

  beforeEach(() => {
    vi.clearAllMocks()
    useStore.getState().reset()
    sockets = []
    vi.mocked(api.connectWebSocket).mockImplementation(() => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    })
    vi.mocked(api.getTranscription).mockResolvedValue({
      id: 't1', status: 'completed', utterances: [], text: '', language: 'en', speaker_mappings: {},
    } as never)
    useStore.setState({
      transcriptionId: 't1',
      transcriptionStatus: 'processing',
      transcriptionHistory: [historyItem('t1'), historyItem('t2')],
    })
  })

  async function complete(extra: Record<string, unknown> = {}) {
    await act(async () => sockets[0].receive({ type: 'status', status: 'completed', ...extra }))
  }

  it('shows a title that comes after completion in the detail header and the archive', async () => {
    render(<TranscriptionProgressCard />)
    await complete()
    expect(useStore.getState().transcriptionStatus).toBe('completed')
    expect(sockets[0].close).not.toHaveBeenCalled()

    act(() => sockets[0].receive({ type: 'title', title: 'Weekly meeting' }))

    expect(useStore.getState().transcriptionTitle).toBe('Weekly meeting')
    expect(titleOf('t1')).toBe('Weekly meeting')
    expect(titleOf('t2')).toBeNull()
    expect(sockets[0].close).toHaveBeenCalled()
  })

  it('shows a title that rides on the completed message', async () => {
    render(<TranscriptionProgressCard />)
    await complete({ title: 'Weekly meeting' })

    expect(useStore.getState().transcriptionTitle).toBe('Weekly meeting')
    expect(titleOf('t1')).toBe('Weekly meeting')
  })

  // The card unmounts once the editor opens, and the user may leave or open
  // another transcription before the title arrives.
  it('still takes the title after the card unmounted, without touching another open header', async () => {
    const { unmount } = render(<TranscriptionProgressCard />)
    await complete()
    unmount()
    expect(sockets[0].close).not.toHaveBeenCalled()
    useStore.setState({ transcriptionId: 't2', transcriptionTitle: 'Other' })

    act(() => sockets[0].receive({ type: 'title', title: 'Weekly meeting' }))

    expect(titleOf('t1')).toBe('Weekly meeting')
    expect(useStore.getState().transcriptionTitle).toBe('Other')
  })

  it('changes nothing when the socket closes without a title', async () => {
    render(<TranscriptionProgressCard />)
    await complete()

    act(() => sockets[0].onclose?.())

    expect(useStore.getState().transcriptionTitle).toBeNull()
    expect(titleOf('t1')).toBeNull()
    expect(api.connectWebSocket).toHaveBeenCalledTimes(1)
  })
})

describe('TranscriptionProgressCard connection', () => {
  let sockets: FakeSocket[]

  beforeEach(() => {
    vi.clearAllMocks()
    useStore.getState().reset()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    sockets = []
    vi.mocked(api.connectWebSocket).mockImplementation(() => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    })
    useStore.setState({ transcriptionId: 't1', transcriptionStatus: 'pending' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a single socket when the status changes from pending to processing', async () => {
    render(<TranscriptionProgressCard />)

    act(() => sockets[0].receive({ type: 'status', status: 'processing' }))
    // The browser reports the replaced socket closed only after the next one opened.
    act(() => sockets[0].onclose?.())
    await act(() => vi.advanceTimersByTimeAsync(30000))

    expect(api.connectWebSocket).toHaveBeenCalledTimes(2)
    expect(sockets.filter((s) => s.close.mock.calls.length === 0)).toHaveLength(1)
  })
})
