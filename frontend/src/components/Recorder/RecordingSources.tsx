import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSystemAudioSupport } from '../../utils/platformDetect'
import { useDevicePermission } from '../../utils/devicePermissions'
import { getSecondDeviceCandidates } from '../../utils/secondDeviceCandidates'
import { SourceCard } from './SourceCard'

const systemAudioSupport = getSystemAudioSupport()

const warningKey: Record<string, string> = {
  full: 'recorder.systemAudioWarningFull',
  'tab-only': 'recorder.systemAudioWarningTabOnly',
  'dual-device': 'recorder.systemAudioWarningDualDevice',
  limited: 'recorder.systemAudioWarningLimited',
}

// Device labels are empty until the permission is granted: ask for it, then list the devices
async function devicesWithPermission(kind: 'audio' | 'video'): Promise<MediaDeviceInfo[] | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { video: true })
    stream.getTracks().forEach((tr) => tr.stop())
    return await navigator.mediaDevices.enumerateDevices()
  } catch {
    // Permission denied — the permission hook picks this up via onchange or the next refresh.
    return null
  }
}

interface RecordingSourcesProps {
  useMicrophone: boolean
  onUseMicrophoneChange: (use: boolean) => void
  audioDeviceId: string
  onAudioDeviceChange: (id: string) => void
  captureSystemAudio: boolean
  onCaptureSystemAudioChange: (capture: boolean) => void
  secondAudioDeviceId: string
  onSecondAudioDeviceChange: (id: string) => void
  useCamera: boolean
  onUseCameraChange: (use: boolean) => void
  videoDeviceId: string
  onVideoDeviceChange: (id: string) => void
  recording?: boolean
  onValidityChange?: (valid: boolean) => void
}

export function RecordingSources(props: RecordingSourcesProps) {
  const {
    useMicrophone, onUseMicrophoneChange,
    audioDeviceId, onAudioDeviceChange,
    captureSystemAudio, onCaptureSystemAudioChange,
    secondAudioDeviceId, onSecondAudioDeviceChange,
    useCamera, onUseCameraChange,
    videoDeviceId, onVideoDeviceChange,
    recording = false,
    onValidityChange,
  } = props
  const { t } = useTranslation()
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const micId = useId()
  const secondDeviceId = useId()
  const cameraId = useId()

  const micPermission = useDevicePermission('mic')
  const cameraPermission = useDevicePermission('camera')

  const cameraDisabled = captureSystemAudio
  const validMic = useMicrophone && micPermission.state !== 'denied'
  // A recording needs an audio source; the camera only adds video.
  const valid = validMic || captureSystemAudio

  useEffect(() => {
    onValidityChange?.(valid)
  }, [valid, onValidityChange])

  const showDevices = (devices: MediaDeviceInfo[] | null) => {
    if (!devices) return
    setAudioDevices(devices.filter((d) => d.kind === 'audioinput'))
    setVideoDevices(devices.filter((d) => d.kind === 'videoinput'))
  }

  useEffect(() => {
    async function enumerate() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const hasAudioLabels = devices.some((d) => d.kind === 'audioinput' && d.label)
        showDevices(hasAudioLabels ? devices : await devicesWithPermission('audio'))
      } catch {
        // Permission denied — show empty list
      }
    }
    enumerate()
    navigator.mediaDevices.addEventListener('devicechange', enumerate)
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
  }, [])

  useEffect(() => {
    if (!useCamera || cameraDisabled) return
    const hasVideoLabels = videoDevices.some((d) => d.label)
    if (!hasVideoLabels) {
      devicesWithPermission('video').then(showDevices)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per camera toggle, not on every device list change
  }, [useCamera, cameraDisabled])

  // Keep the second device a valid candidate: select the first one when unset, stale, or equal to the microphone
  useEffect(() => {
    if (systemAudioSupport !== 'dual-device' || !captureSystemAudio) return
    // Device list not enumerated yet: nothing to validate the choice against.
    if (audioDevices.length === 0) return
    const available = getSecondDeviceCandidates(audioDevices, audioDeviceId)
    if (available.some((d) => d.deviceId === secondAudioDeviceId)) return
    const next = available.length > 0 ? available[0].deviceId : ''
    if (next !== secondAudioDeviceId) onSecondAudioDeviceChange(next)
  }, [captureSystemAudio, audioDevices, audioDeviceId, secondAudioDeviceId, onSecondAudioDeviceChange])

  const makeDeniedBanner = (sourceLabel: string, onRetry: () => void) => (
    <div role="alert" className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-xs flex items-start gap-3">
      <span className="text-red-400 text-sm" aria-hidden="true">!</span>
      <div className="flex-1 min-w-0">
        <p className="text-red-200">{t('recorder.permissionDenied', { source: sourceLabel })}</p>
        <p className="text-red-400/80 mt-1">{t('recorder.permissionRecovery')}</p>
      </div>
      <button
        onClick={onRetry}
        className="shrink-0 px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs"
      >
        {t('recorder.permissionRetry')}
      </button>
    </div>
  )

  return (
    <div data-help="record-sources" className="flex flex-col gap-3">
      <SourceCard
        icon="🎤"
        helpId="record-source-mic"
        label={t('recorder.sourceMicrophone')}
        enabled={useMicrophone}
        onToggle={onUseMicrophoneChange}
        recording={recording}
        permission={micPermission.state}
        deniedBanner={makeDeniedBanner(t('recorder.sourceMicrophone'), micPermission.refresh)}
      >
        <div data-help="record-mic-device" className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor={micId} className="text-xs text-gray-400 sm:min-w-24 sm:shrink-0">{t('recorder.selectMic')}</label>
          {audioDevices.length === 1 ? (
            <output id={micId} className="flex-1 min-w-0 bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
              {audioDevices[0].label || `Microphone ${audioDevices[0].deviceId.slice(0, 8)}`}
            </output>
          ) : (
            <select
              id={micId}
              value={audioDeviceId}
              onChange={(e) => onAudioDeviceChange(e.target.value)}
              disabled={recording}
              className="flex-1 min-w-0 bg-gray-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
              {audioDevices.length === 0 && <option value="">—</option>}
            </select>
          )}
        </div>
      </SourceCard>

      {systemAudioSupport !== 'unsupported' && (
        <SourceCard
          icon="🔊"
          helpId="record-source-system"
          label={t('recorder.sourceSystemAudio')}
          enabled={captureSystemAudio}
          onToggle={onCaptureSystemAudioChange}
          recording={recording}
        >
          <div className="flex flex-col gap-2">
            {warningKey[systemAudioSupport] && (
              <div className="bg-amber-900/40 border border-amber-700 rounded px-3 py-2 text-xs text-amber-200">
                {t(warningKey[systemAudioSupport])}
              </div>
            )}
            {systemAudioSupport === 'dual-device' && (() => {
              const secondDeviceCandidates = getSecondDeviceCandidates(audioDevices, audioDeviceId)
              return (
                <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-3">
                  <label htmlFor={secondDeviceId} className="text-xs text-gray-400 sm:min-w-24 sm:shrink-0">{t('recorder.selectSecondDevice')}</label>
                  {secondDeviceCandidates.length === 1 ? (
                    <output id={secondDeviceId} className="flex-1 min-w-0 bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
                      {secondDeviceCandidates[0].label || `Device ${secondDeviceCandidates[0].deviceId.slice(0, 8)}`}
                    </output>
                  ) : (
                    <select
                      id={secondDeviceId}
                      value={secondAudioDeviceId}
                      onChange={(e) => onSecondAudioDeviceChange(e.target.value)}
                      disabled={recording}
                      className="flex-1 min-w-0 bg-gray-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {secondDeviceCandidates.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Device ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                      {secondDeviceCandidates.length === 0 && <option value="">—</option>}
                    </select>
                  )}
                </div>
              )
            })()}
          </div>
        </SourceCard>
      )}

      <SourceCard
        icon="📷"
        helpId="record-source-camera"
        label={t('recorder.sourceCamera')}
        enabled={useCamera}
        onToggle={onUseCameraChange}
        disabled={cameraDisabled}
        disabledReason={t('recorder.sourcesCameraDisabledBySystemAudio')}
        recording={recording}
        permission={cameraPermission.state}
        deniedBanner={makeDeniedBanner(t('recorder.sourceCamera'), cameraPermission.refresh)}
      >
        {videoDevices.length === 0 ? (
          <p className="text-xs text-gray-400">{t('recorder.noCameraDetected')}</p>
        ) : (
          <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-3">
            <label htmlFor={cameraId} className="text-xs text-gray-400 sm:min-w-24 sm:shrink-0">{t('recorder.selectCamera')}</label>
            {videoDevices.length === 1 ? (
              <output id={cameraId} className="flex-1 min-w-0 bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
                {videoDevices[0].label || `Camera ${videoDevices[0].deviceId.slice(0, 8)}`}
              </output>
            ) : (
              <select
                id={cameraId}
                value={videoDeviceId}
                onChange={(e) => onVideoDeviceChange(e.target.value)}
                disabled={recording}
                className="flex-1 min-w-0 bg-gray-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {videoDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </SourceCard>

      {!useMicrophone && !captureSystemAudio && (
        <p className="text-xs text-amber-400">{t('recorder.sourcesNeedAudio')}</p>
      )}
    </div>
  )
}
