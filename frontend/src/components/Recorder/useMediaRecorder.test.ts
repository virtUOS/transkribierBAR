import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useMediaRecorder } from './useMediaRecorder'

interface FakeTrack {
  kind: string
  stop: () => void
}

interface FakeStream {
  getTracks: () => FakeTrack[]
  getAudioTracks: () => FakeTrack[]
  getVideoTracks: () => FakeTrack[]
}

function makeStream(tracks: FakeTrack[]): FakeStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  }
}

const recorderInstances: { stream: FakeStream; opts: unknown; stop: () => void }[] = []

// jsdom ships no MediaRecorder; stub the surface the hook uses
class FakeMediaRecorder {
  mimeType = ''
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(stream: FakeStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? ''
    recorderInstances.push({
      stream,
      opts,
      stop: () => {
        this.state = 'inactive'
        this.onstop?.()
      },
    })
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
  static isTypeSupported() {
    return true
  }
}

const mic = () => makeStream([{ kind: 'audio', stop: vi.fn() }])
const cam = () => makeStream([{ kind: 'video', stop: vi.fn() }])
const denied = async () => {
  throw new DOMException('denied', 'NotAllowedError')
}

beforeEach(() => {
  recorderInstances.length = 0
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  // jsdom has no MediaStream constructor; the camera-open path merges mic + video tracks into one
  vi.stubGlobal(
    'MediaStream',
    class {
      tracks: FakeTrack[]
      constructor(tracks: FakeTrack[] = []) {
        this.tracks = tracks
      }
      getTracks() {
        return this.tracks
      }
      getAudioTracks() {
        return this.tracks.filter((t) => t.kind === 'audio')
      }
      getVideoTracks() {
        return this.tracks.filter((t) => t.kind === 'video')
      }
    },
  )
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: class {
      resume() {
        return Promise.resolve()
      }
      close() {
        return Promise.resolve()
      }
    },
  })
})

async function runRecording(options: { useCamera: boolean; cameraOutcome: () => unknown }) {
  const getUserMedia: (constraints: { audio?: unknown; video?: unknown }) => Promise<FakeStream> = async (
    constraints,
  ) => {
    if (constraints.video) return options.cameraOutcome() as FakeStream
    return mic()
  }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })

  const { result } = renderHook(() => useMediaRecorder(options))
  await act(async () => {
    await result.current.start()
  })
  await waitFor(() => expect(result.current.state).toBe('recording'))
  await act(async () => {
    result.current.stop()
  })
  await waitFor(() => expect(result.current.state).toBe('stopped'))
  return result
}

describe('useMediaRecorder has_video reporting', () => {
  it('reports hasVideo false when the camera is denied and the recording falls back to audio only', async () => {
    const result = await runRecording({ useCamera: true, cameraOutcome: denied })
    // The user asked for camera, the recording has no video track: the stored
    // has_video must be false, not the camera toggle state.
    expect(result.current.hasVideo).toBe(false)
    expect(result.current.blob?.type.startsWith('audio')).toBe(true)
    expect(result.current.error).toBe('cameraDenied')
  })

  it('reports hasVideo true when the camera opened and the stream carries a video track', async () => {
    const result = await runRecording({ useCamera: true, cameraOutcome: cam })
    expect(result.current.hasVideo).toBe(true)
    expect(result.current.blob?.type.startsWith('video')).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('reports hasVideo false when the camera is switched off', async () => {
    const result = await runRecording({ useCamera: false, cameraOutcome: cam })
    expect(result.current.hasVideo).toBe(false)
    expect(result.current.blob?.type.startsWith('audio')).toBe(true)
  })

  it('reports hasVideo false when the recorder cannot be created for a camera stream', async () => {
    vi.stubGlobal('MediaRecorder', class extends FakeMediaRecorder {
      constructor(stream: FakeStream, opts?: { mimeType?: string }) {
        super(stream, opts)
        throw new DOMException('unsupported', 'NotSupportedError')
      }
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async (c: { video?: unknown }) => (c.video ? cam() : mic()) },
    })
    const { result } = renderHook(() => useMediaRecorder({ useCamera: true }))
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.state).toBe('idle')
    expect(result.current.hasVideo).toBe(false)
  })

  it('reports hasVideo false after a camera recording is discarded', async () => {
    const result = await runRecording({ useCamera: true, cameraOutcome: cam })
    act(() => {
      result.current.discard()
    })
    expect(result.current.hasVideo).toBe(false)
  })
})
