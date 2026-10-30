import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaRecorder } from './useMediaRecorder'

type FakeTrack = { kind: 'audio' | 'video'; stop: ReturnType<typeof vi.fn> }

class FakeMediaStream {
  tracks: FakeTrack[]
  constructor(tracks: FakeTrack[] = []) { this.tracks = tracks }
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
}

class FakeMediaRecorder {
  static isTypeSupported() { return true }
  state = 'inactive'
  mimeType = ''
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}

let micTrack: FakeTrack
let cameraTrack: FakeTrack

beforeEach(() => {
  micTrack = { kind: 'audio', stop: vi.fn() }
  cameraTrack = { kind: 'video', stop: vi.fn() }
  vi.stubGlobal('MediaStream', FakeMediaStream)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) =>
        new FakeMediaStream([c.video ? cameraTrack : micTrack])),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function startCameraRecording() {
  const hook = renderHook(() => useMediaRecorder({ useMicrophone: true, useCamera: true }))
  await act(() => hook.result.current.start())
  expect(hook.result.current.state).toBe('recording')
  expect(hook.result.current.stream?.getVideoTracks()).toEqual([cameraTrack])
  return hook
}

describe('useMediaRecorder camera track', () => {
  it('stops the camera when the recording is stopped', async () => {
    const { result } = await startCameraRecording()
    act(() => result.current.stop())
    expect(result.current.state).toBe('stopped')
    expect(micTrack.stop).toHaveBeenCalled()
    expect(cameraTrack.stop).toHaveBeenCalled()
  })

  it('stops the camera when the recording is discarded', async () => {
    const { result } = await startCameraRecording()
    act(() => result.current.discard())
    expect(micTrack.stop).toHaveBeenCalled()
    expect(cameraTrack.stop).toHaveBeenCalled()
  })

  it('stops the camera when the recorder unmounts', async () => {
    const { unmount } = await startCameraRecording()
    unmount()
    expect(micTrack.stop).toHaveBeenCalled()
    expect(cameraTrack.stop).toHaveBeenCalled()
  })
})

describe('useMediaRecorder when the recorder cannot be created', () => {
  class ThrowingMediaRecorder {
    static isTypeSupported() { return true }
    constructor() { throw new Error('unsupported mime type') }
  }

  it('stops the microphone and camera and clears the stream', async () => {
    vi.stubGlobal('MediaRecorder', ThrowingMediaRecorder)
    const { result, unmount } = renderHook(() => useMediaRecorder({ useMicrophone: true, useCamera: true }))
    await act(() => result.current.start())
    expect(result.current.error).toBe('micRequired')
    expect(result.current.state).toBe('idle')
    expect(micTrack.stop).toHaveBeenCalledTimes(1)
    expect(cameraTrack.stop).toHaveBeenCalledTimes(1)
    expect(result.current.stream).toBeNull()
    // Refs are clear: neither discard nor unmount stops the tracks again.
    act(() => result.current.discard())
    unmount()
    expect(micTrack.stop).toHaveBeenCalledTimes(1)
    expect(cameraTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('stops the failed attempt once and records with the retry tracks', async () => {
    let attempts = 0
    class FlakyMediaRecorder extends FakeMediaRecorder {
      constructor() {
        super()
        if (attempts++ === 0) throw new Error('unsupported mime type')
      }
    }
    vi.stubGlobal('MediaRecorder', FlakyMediaRecorder)
    const opened: FakeTrack[][] = []
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockImplementation(
      async (c: MediaStreamConstraints) => {
        const track: FakeTrack = { kind: c.video ? 'video' : 'audio', stop: vi.fn() }
        const attempt = Math.floor(opened.flat().length / 2)
        ;(opened[attempt] ??= []).push(track)
        return new FakeMediaStream([track])
      })
    const { result } = renderHook(() => useMediaRecorder({ useMicrophone: true, useCamera: true }))
    await act(() => result.current.start())
    expect(result.current.state).toBe('idle')
    await act(() => result.current.start())
    expect(result.current.state).toBe('recording')
    expect(result.current.error).toBeNull()
    const [first, second] = opened
    first.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1))
    second.forEach((t) => expect(t.stop).not.toHaveBeenCalled())
    expect(result.current.stream?.getTracks()).toEqual(second)
  })
})
