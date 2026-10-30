import { useState, useRef, useCallback, useEffect } from 'react'
import { inferFromError } from '../../utils/devicePermissions'

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

interface UseMediaRecorderOptions {
  audioDeviceId?: string
  videoDeviceId?: string
  useCamera?: boolean
  captureSystemAudio?: boolean
  secondAudioDeviceId?: string
  useMicrophone?: boolean
}

interface UseMediaRecorderReturn {
  state: RecorderState
  blob: Blob | null
  stream: MediaStream | null
  duration: number
  error: string | null
  hasVideo: boolean
  start: () => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  discard: () => void
}

function getPreferredMimeType(hasVideo: boolean): string {
  const candidates = hasVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'mp4'
  return 'webm'
}

export function useMediaRecorder(options: UseMediaRecorderOptions = {}): UseMediaRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle')
  const [blob, setBlob] = useState<Blob | null>(null)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [hasVideo, setHasVideo] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const elapsedBeforePauseRef = useRef(0)
  const discardingRef = useRef(false)

  const displayStreamRef = useRef<MediaStream | null>(null)
  const mixAudioContextRef = useRef<AudioContext | null>(null)
  const displayEndedHandlerRef = useRef<(() => void) | null>(null)
  const secondStreamRef = useRef<MediaStream | null>(null)

  const stopAllTracks = useCallback(() => {
    // Remove ended listener before stopping tracks
    if (displayEndedHandlerRef.current) {
      const displayTrack = displayStreamRef.current?.getAudioTracks()[0]
      const secondTrack = secondStreamRef.current?.getAudioTracks()[0]
      const track = displayTrack ?? secondTrack
      if (track) track.removeEventListener('ended', displayEndedHandlerRef.current)
      displayEndedHandlerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    cameraStreamRef.current = null
    displayStreamRef.current?.getTracks().forEach((t) => t.stop())
    displayStreamRef.current = null
    secondStreamRef.current?.getTracks().forEach((t) => t.stop())
    secondStreamRef.current = null
    if (mixAudioContextRef.current) {
      mixAudioContextRef.current.close()
      mixAudioContextRef.current = null
    }
    setStream(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      discardingRef.current = true
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (displayEndedHandlerRef.current) {
        const displayTrack = displayStreamRef.current?.getAudioTracks()[0]
        const secondTrack = secondStreamRef.current?.getAudioTracks()[0]
        const track = displayTrack ?? secondTrack
        if (track) track.removeEventListener('ended', displayEndedHandlerRef.current)
      }
      displayStreamRef.current?.getTracks().forEach((t) => t.stop())
      secondStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (mixAudioContextRef.current) mixAudioContextRef.current.close()
    }
  }, [])

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setDuration(elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current))
    }, 200)
  }, [])

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    elapsedBeforePauseRef.current += Date.now() - startTimeRef.current
  }, [])

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    startTimeRef.current = 0
    elapsedBeforePauseRef.current = 0
    setDuration(0)
  }, [])

  const start = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return
    // A recorder that is still active returned above, so only leftovers of a
    // failed earlier attempt can be open here; stop them instead of overwriting.
    stopAllTracks()
    discardingRef.current = false
    setError(null)
    setBlob(null)
    setHasVideo(false)
    chunksRef.current = []
    resetTimer()

    try {
      let recordingStream: MediaStream

      if (options.captureSystemAudio && options.useMicrophone === false) {
        // System audio only — no microphone
        if (options.secondAudioDeviceId) {
          // Dual-device mode: use second device directly as the only audio source
          let secondStream: MediaStream
          try {
            secondStream = await navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: options.secondAudioDeviceId } },
            })
          } catch {
            setError('secondDeviceFailed')
            return
          }

          secondStreamRef.current = secondStream

          const secondAudioTrack = secondStream.getAudioTracks()[0]
          const onSecondEnded = () => {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
              recorderRef.current.stop()
            }
          }
          secondAudioTrack.addEventListener('ended', onSecondEnded)
          displayEndedHandlerRef.current = onSecondEnded

          recordingStream = secondStream
        } else {
          // getDisplayMedia mode: use display audio directly
          let displayStream: MediaStream
          try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({
              audio: true,
              video: true,
            })
          } catch {
            setError('systemAudioFailed')
            return
          }

          displayStream.getVideoTracks().forEach((t) => t.stop())

          if (displayStream.getAudioTracks().length === 0) {
            displayStream.getTracks().forEach((t) => t.stop())
            setError('systemAudioFailed')
            return
          }

          displayStreamRef.current = displayStream

          const displayAudioTrack = displayStream.getAudioTracks()[0]
          const onDisplayEnded = () => {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
              recorderRef.current.stop()
            }
          }
          displayAudioTrack.addEventListener('ended', onDisplayEnded)
          displayEndedHandlerRef.current = onDisplayEnded

          recordingStream = displayStream
        }
      } else {
        // Standard path: microphone (with optional system audio mixing and/or camera)
        if (options.useMicrophone === false) {
          // Defensive: the UI requires an audio source, so this is unreachable from it.
          throw new Error('The microphone is switched off.')
        }
        const audioConstraint: MediaTrackConstraints | boolean = options.audioDeviceId
          ? { deviceId: { exact: options.audioDeviceId } }
          : true

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
        streamRef.current = micStream

        let cameraStream: MediaStream | null = null
        if (options.useCamera && !options.captureSystemAudio) {
          const videoConstraint: MediaTrackConstraints | boolean = options.videoDeviceId
            ? { deviceId: { exact: options.videoDeviceId } }
            : true
          try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint })
            cameraStreamRef.current = cameraStream
          } catch (err) {
            // Camera isn't usable (denied, missing, or otherwise). Since the mic
            // already opened successfully, continue with audio-only recording
            // rather than aborting the whole session — matches what the user
            // asked for in #139 ("if I can still record audio … record audio").
            setError(inferFromError(err) === 'denied' ? 'cameraDenied' : 'cameraFailed')
            cameraStream = null
          }
        }

        recordingStream = cameraStream
          ? new MediaStream([...micStream.getTracks(), ...cameraStream.getVideoTracks()])
          : micStream

        if (options.captureSystemAudio) {
          if (options.secondAudioDeviceId) {
            // Dual-device mode: mix mic + second audio input
            let secondStream: MediaStream
            try {
              secondStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: options.secondAudioDeviceId } },
              })
            } catch {
              micStream.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              setError('secondDeviceFailed')
              return
            }

            secondStreamRef.current = secondStream

            const secondAudioTrack = secondStream.getAudioTracks()[0]
            const onSecondEnded = () => {
              if (recorderRef.current && recorderRef.current.state !== 'inactive') {
                recorderRef.current.stop()
              }
            }
            secondAudioTrack.addEventListener('ended', onSecondEnded)
            displayEndedHandlerRef.current = onSecondEnded

            const audioCtx = new AudioContext()
            const micSource = audioCtx.createMediaStreamSource(micStream)
            const secondSource = audioCtx.createMediaStreamSource(secondStream)
            const destination = audioCtx.createMediaStreamDestination()
            micSource.connect(destination)
            secondSource.connect(destination)

            mixAudioContextRef.current = audioCtx
            recordingStream = destination.stream
          } else {
            // getDisplayMedia path: mix mic + display audio
            let displayStream: MediaStream
            try {
              displayStream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: true,
              })
            } catch {
              micStream.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              setError('systemAudioFailed')
              return
            }

            displayStream.getVideoTracks().forEach((t) => t.stop())

            if (displayStream.getAudioTracks().length === 0) {
              displayStream.getTracks().forEach((t) => t.stop())
              micStream.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              setError('systemAudioFailed')
              return
            }

            displayStreamRef.current = displayStream

            const displayAudioTrack = displayStream.getAudioTracks()[0]
            const onDisplayEnded = () => {
              if (recorderRef.current && recorderRef.current.state !== 'inactive') {
                recorderRef.current.stop()
              }
            }
            displayAudioTrack.addEventListener('ended', onDisplayEnded)
            displayEndedHandlerRef.current = onDisplayEnded

            const audioCtx = new AudioContext()
            const micSource = audioCtx.createMediaStreamSource(micStream)
            const displaySource = audioCtx.createMediaStreamSource(displayStream)
            const destination = audioCtx.createMediaStreamDestination()
            micSource.connect(destination)
            displaySource.connect(destination)

            mixAudioContextRef.current = audioCtx
            recordingStream = destination.stream
          }
        }
      }

      setStream(recordingStream)

      const hasVideo = !!options.useCamera && !options.captureSystemAudio && !!recordingStream.getVideoTracks().length
      const mimeType = getPreferredMimeType(hasVideo)
      const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        if (discardingRef.current) {
          discardingRef.current = false
          return
        }
        const finalMime = recorder.mimeType || mimeType
        const recordedBlob = new Blob(chunksRef.current, { type: finalMime })
        setBlob(recordedBlob)
        setState('stopped')
        if (timerRef.current) pauseTimer()
        stopAllTracks()
      }

      recorder.onerror = () => {
        setError('deviceDisconnected')
        if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
        stopAllTracks()
      }

      recorderRef.current = recorder
      recorder.start(1000)
      // Only once the recorder runs, so a failed start never reports video
      setHasVideo(hasVideo)
      setState('recording')
      startTimer()
    } catch (err) {
      if (options.captureSystemAudio && options.useMicrophone === false) {
        setError('systemAudioFailed')
      } else if (inferFromError(err) === 'denied') {
        setError('micDenied')
      } else {
        setError('micRequired')
      }
      // Release anything opened before the failure (e.g. MediaRecorder threw).
      stopAllTracks()
    }
  }, [options.audioDeviceId, options.videoDeviceId, options.useCamera, options.captureSystemAudio, options.secondAudioDeviceId, options.useMicrophone, resetTimer, startTimer, pauseTimer, stopAllTracks])

  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause()
      setState('paused')
      pauseTimer()
    }
  }, [pauseTimer])

  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume()
      setState('recording')
      startTimer()
    }
  }, [startTimer])

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
      // Don't stopAllTracks() here — let onstop fire first to create the blob
    }
  }, [])

  const discard = useCallback(() => {
    discardingRef.current = true
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    stopAllTracks()
    setBlob(null)
    setHasVideo(false)
    chunksRef.current = []
    resetTimer()
    setState('idle')
    setError(null)
  }, [stopAllTracks, resetTimer])

  return { state, blob, stream, duration, error, hasVideo, start, pause, resume, stop, discard }
}

export { getFileExtension, getPreferredMimeType }
