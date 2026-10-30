import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaRecorder, getFileExtension, getPreferredMimeType } from './useMediaRecorder'
import { RecorderControls } from './RecorderControls'
import { AudioLevelMeter } from './AudioLevelMeter'
import { RecordingSources } from './RecordingSources'
import { api } from '../../api/client'
import { useStore } from '../../store'
import { formatFileSize } from '../../utils/format'

export function RecorderPanel() {
  const { t } = useTranslation()
  const file = useStore((s) => s.file)
  const setFile = useStore((s) => s.setFile)
  const transcriptionTitle = useStore((s) => s.transcriptionTitle)

  const [audioDeviceId, setAudioDeviceId] = useState('')
  const [videoDeviceId, setVideoDeviceId] = useState('')
  const [useCamera, setUseCamera] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false)
  const [secondAudioDeviceId, setSecondAudioDeviceId] = useState('')
  const [useMicrophone, setUseMicrophone] = useState(true)
  const [sourcesValid, setSourcesValid] = useState(true)

  const handleCaptureSystemAudioChange = useCallback((capture: boolean) => {
    setCaptureSystemAudio(capture)
    if (!capture) setSecondAudioDeviceId('')
    // Camera and system audio are mutually exclusive — turn camera off so the UI
    // doesn't show a stale "on" toggle or a black video preview rectangle while
    // the recording itself silently drops the video track.
    if (capture) setUseCamera(false)
  }, [])

  const { state, blob, stream, duration, error, hasVideo, start, pause, resume, stop, discard } =
    useMediaRecorder({ audioDeviceId, videoDeviceId, useCamera, captureSystemAudio, secondAudioDeviceId, useMicrophone })

  const videoPreviewRef = useRef<HTMLVideoElement>(null)

  // Webcam preview, only when the stream really carries video (the camera can
  // be denied and fall back to audio only while the toggle stays on)
  useEffect(() => {
    if (videoPreviewRef.current && stream && hasVideo) {
      videoPreviewRef.current.srcObject = stream
    }
  }, [stream, hasVideo])

  // Tell the store a recording is at stake so every leave path asks first.
  const setRecordingActive = useStore((s) => s.setRecordingActive)
  useEffect(() => {
    setRecordingActive(state === 'recording' || state === 'paused' || (state === 'stopped' && !!blob))
  }, [state, blob, setRecordingActive])
  useEffect(() => () => setRecordingActive(false), [setRecordingActive])

  const handleUseRecording = useCallback(async () => {
    if (!blob) return
    setUploading(true)
    setUploadError(null)

    try {
      const mimeType = blob.type || getPreferredMimeType(hasVideo)
      const ext = getFileExtension(mimeType)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `recording-${timestamp}.${ext}`
      const file = new File([blob], filename, { type: mimeType })

      // Upload the video flag the recording actually carries, not the camera
      // toggle: when the camera was denied the stream fell back to audio only
      // and the file must be stored has_video=false (see #200).
      const fileInfo = await api.uploadRecording(file, hasVideo)
      setFile(fileInfo)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('recorder.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }, [blob, hasVideo, setFile, t])

  // Auto-upload once the recording is captured — avoids a second "Transcribe"
  // press on an intermediate page. The settings panel + Transcribe / Discard
  // buttons take over once `file` is set.
  const autoUploadedRef = useRef(false)
  useEffect(() => {
    if (state === 'stopped' && blob && !uploading && !uploadError && !file && !autoUploadedRef.current) {
      autoUploadedRef.current = true
      handleUseRecording()
    }
    if (state !== 'stopped' || !blob) {
      autoUploadedRef.current = false
    }
  }, [state, blob, uploading, uploadError, file, handleUseRecording])

  const handleStart = useCallback(async () => {
    // Play a short beep tone to signal recording start. Detached: resume() never
    // settles in Firefox without an audio output device, and must not block start().
    void (async () => {
      try {
        const ctx = new AudioContext()
        await ctx.resume()
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.frequency.value = 880
        gain.gain.value = 0.3
        oscillator.start()
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
        oscillator.stop(ctx.currentTime + 0.3)
        setTimeout(() => ctx.close(), 500)
      } catch {
        // Audio cue is best-effort
      }
    })()
    await start()
  }, [start])

  const isActive = state === 'recording' || state === 'paused'

  if (file) {
    return (
      <div className="flex items-center gap-4 px-6 py-2 bg-gray-800 border-b border-gray-700 text-sm text-gray-300">
        <span>
          {transcriptionTitle ? <>{transcriptionTitle} <span className="text-gray-500">[{file.original_filename}]</span></> : file.original_filename}
        </span>
        <span className="text-gray-500">({formatFileSize(file.file_size)})</span>
      </div>
    )
  }

  return (
    <div data-help="recorder" className="border-2 border-dashed border-gray-600 rounded-lg p-6 space-y-4">
      {/* Recording sources — only while idle, since toggles have no effect once recording begins */}
      {state === 'idle' && (
        <RecordingSources
          useMicrophone={useMicrophone}
          onUseMicrophoneChange={setUseMicrophone}
          audioDeviceId={audioDeviceId}
          onAudioDeviceChange={setAudioDeviceId}
          captureSystemAudio={captureSystemAudio}
          onCaptureSystemAudioChange={handleCaptureSystemAudioChange}
          secondAudioDeviceId={secondAudioDeviceId}
          onSecondAudioDeviceChange={setSecondAudioDeviceId}
          useCamera={useCamera}
          onUseCameraChange={setUseCamera}
          videoDeviceId={videoDeviceId}
          onVideoDeviceChange={setVideoDeviceId}
          recording={isActive}
          onValidityChange={setSourcesValid}
        />
      )}

      {/* Video preview or audio level meter */}
      {state !== 'stopped' && (
        <div className="flex justify-center">
          {hasVideo && stream ? (
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className="w-full max-w-md rounded-lg bg-black"
              style={{ maxHeight: '240px' }}
            />
          ) : (
            <div className="w-full max-w-md">
              <AudioLevelMeter stream={stream} />
            </div>
          )}
        </div>
      )}

      {/* Consent reminder */}
      {state === 'idle' && (
        <p className="text-xs text-gray-400 text-center">
          {t('recorder.consentReminder')}
        </p>
      )}

      {/* Controls */}
      <RecorderControls
        state={state}
        duration={duration}
        onStart={handleStart}
        onPause={pause}
        onResume={resume}
        onStop={stop}
        onDiscard={discard}
        startDisabled={!sourcesValid}
        startDisabledReason={!sourcesValid && !useMicrophone && !captureSystemAudio ? t('recorder.sourcesNeedAudio') : undefined}
      />

      {/* Error messages */}
      {error && (
        <p className="text-red-400 text-sm text-center">{t(`recorder.${error}`)}</p>
      )}
      {uploadError && (
        <div className="p-4 bg-red-900/30 rounded-lg border border-red-700">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-red-400 text-lg" aria-hidden="true">!</span>
            <span className="text-red-300 text-sm flex-1">{uploadError}</span>
            <button
              onClick={() => { setUploadError(null); autoUploadedRef.current = false }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
            >
              {t('recorder.permissionRetry')}
            </button>
            <button
              onClick={discard}
              className="px-3 py-1 border border-gray-600 hover:border-red-500 text-red-400 text-xs rounded"
            >
              {t('recorder.discard')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
