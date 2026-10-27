import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { api } from '../../api/client'
import type { FileInfo } from '../../api/types'
import { useStore } from '../../store'
import { RecorderPanel } from './RecorderPanel'

const recorder = vi.hoisted(() => ({
  current: {
    state: 'idle' as string,
    blob: null as Blob | null,
    stream: null as MediaStream | null,
    duration: 0,
    error: null,
    hasVideo: false,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    discard: vi.fn(),
  },
}))

vi.mock('./useMediaRecorder', () => ({
  useMediaRecorder: () => recorder.current,
  getFileExtension: () => 'webm',
  getPreferredMimeType: () => 'audio/webm',
}))

vi.mock('./RecordingSources', () => ({
  RecordingSources: ({ onUseCameraChange }: { onUseCameraChange: (on: boolean) => void }) => (
    <button onClick={() => onUseCameraChange(true)}>Camera on</button>
  ),
}))
vi.mock('./AudioLevelMeter', () => ({ AudioLevelMeter: () => null }))

describe('RecorderPanel recording guard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useStore.getState().reset()
    recorder.current.state = 'recording'
    recorder.current.blob = null
    recorder.current.discard = vi.fn(() => {
      recorder.current.state = 'idle'
      recorder.current.blob = null
    })
  })

  it('marks a recording as at stake while recording, not after Discard, not after unmount', () => {
    const { rerender, unmount } = render(<RecorderPanel />)
    expect(useStore.getState().recordingActive).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    rerender(<RecorderPanel />)
    expect(recorder.current.state).toBe('idle')
    expect(useStore.getState().recordingActive).toBe(false)

    recorder.current.state = 'paused'
    rerender(<RecorderPanel />)
    expect(useStore.getState().recordingActive).toBe(true)
    unmount()
    expect(useStore.getState().recordingActive).toBe(false)
  })
})

describe('RecorderPanel start beep', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useStore.getState().reset()
    recorder.current.state = 'idle'
    recorder.current.blob = null
    recorder.current.start = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts recording even when AudioContext.resume() never settles', () => {
    vi.stubGlobal('AudioContext', class {
      resume() { return new Promise<void>(() => {}) }
    })
    render(<RecorderPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }))
    expect(recorder.current.start).toHaveBeenCalledTimes(1)
  })
})

describe('RecorderPanel after the camera fell back to audio only', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useStore.getState().reset()
    recorder.current.state = 'idle'
    recorder.current.blob = null
    recorder.current.stream = null
    recorder.current.hasVideo = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the level meter, not a video preview, while recording', () => {
    const { container, rerender } = render(<RecorderPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Camera on' }))

    recorder.current.state = 'recording'
    recorder.current.stream = {} as MediaStream
    rerender(<RecorderPanel />)

    expect(container.querySelector('video')).toBeNull()
  })

  it('uploads the recording with has_video false', async () => {
    const upload = vi.spyOn(api, 'uploadRecording').mockResolvedValue({
      id: 'f1', original_filename: 'recording.webm', file_size: 3,
    } as FileInfo)
    const { rerender } = render(<RecorderPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Camera on' }))

    recorder.current.state = 'stopped'
    recorder.current.blob = new Blob(['abc'], { type: 'audio/webm' })
    rerender(<RecorderPanel />)

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload).toHaveBeenCalledWith(expect.any(File), false)
  })
})
