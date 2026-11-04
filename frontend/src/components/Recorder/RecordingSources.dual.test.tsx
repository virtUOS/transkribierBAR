import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../i18n'
import { RecordingSources } from './RecordingSources'

vi.mock('../../utils/devicePermissions', () => ({
  useDevicePermission: () => ({ state: 'granted', refresh: vi.fn() }),
}))

vi.mock('../../utils/platformDetect', () => ({
  getSystemAudioSupport: () => 'dual-device',
}))

const mic1 = { kind: 'audioinput', deviceId: 'mic1', label: 'Mic 1' }
const mic2 = { kind: 'audioinput', deviceId: 'mic2', label: 'Mic 2' }
const mon1 = { kind: 'audioinput', deviceId: 'mon1', label: 'Monitor 1' }
const defaultMic = { kind: 'audioinput', deviceId: 'default', label: 'Default' }

function stubDevices(devices: object[]) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue(devices),
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
}

function renderSources(overrides: Partial<React.ComponentProps<typeof RecordingSources>>) {
  const onSecondAudioDeviceChange = vi.fn()
  render(
    <RecordingSources
      useMicrophone
      onUseMicrophoneChange={vi.fn()}
      audioDeviceId="mic1"
      onAudioDeviceChange={vi.fn()}
      captureSystemAudio
      onCaptureSystemAudioChange={vi.fn()}
      secondAudioDeviceId=""
      onSecondAudioDeviceChange={onSecondAudioDeviceChange}
      useCamera={false}
      onUseCameraChange={vi.fn()}
      videoDeviceId=""
      onVideoDeviceChange={vi.fn()}
      {...overrides}
    />,
  )
  return onSecondAudioDeviceChange
}

const PICKER = { selector: 'select, output' }

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('RecordingSources second device auto-select', () => {
  it('replaces a second device that equals the microphone', async () => {
    stubDevices([mic1, mic2])
    const onChange = renderSources({ secondAudioDeviceId: 'mic1' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('mic2'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('clears a second device that equals the microphone when no other device exists', async () => {
    stubDevices([mic1])
    const onChange = renderSources({ secondAudioDeviceId: 'mic1' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps a valid second device', async () => {
    stubDevices([mic1, mic2, { kind: 'audioinput', deviceId: 'mic3', label: 'Mic 3' }])
    const onChange = renderSources({ secondAudioDeviceId: 'mic3' })
    await new Promise((r) => setTimeout(r, 20))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('RecordingSources default microphone', () => {
  it('does not auto-pick or offer the first input while the microphone is the default', async () => {
    stubDevices([mic1, mon1])
    const onChange = renderSources({ audioDeviceId: '' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('mon1'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('System audio source')).toHaveTextContent(/^Monitor 1$/)
  })

  it('also skips the "default" entry', async () => {
    stubDevices([defaultMic, mic1, mon1])
    const onChange = renderSources({ audioDeviceId: '' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('mon1'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('replaces a second device that is the default microphone', async () => {
    stubDevices([mic1, mon1])
    const onChange = renderSources({ audioDeviceId: '', secondAudioDeviceId: 'mic1' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('mon1'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('excludes only the chosen microphone once one is chosen', async () => {
    stubDevices([mic1, mon1])
    const onChange = renderSources({ audioDeviceId: 'mon1' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('mic1'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('RecordingSources labels', () => {
  // The source cards' toggle buttons carry the same accessible names.
  const cam1 = { kind: 'videoinput', deviceId: 'cam1', label: 'Cam 1' }
  const cam2 = { kind: 'videoinput', deviceId: 'cam2', label: 'Cam 2' }

  it('labels the microphone and second-device selects', async () => {
    stubDevices([mic1, mic2, { kind: 'audioinput', deviceId: 'mic3', label: 'Mic 3' }])
    renderSources({ secondAudioDeviceId: 'mic2' })
    const micSelect = await screen.findByLabelText('Microphone', PICKER)
    expect(micSelect.tagName).toBe('SELECT')
    const second = screen.getByLabelText('System audio source')
    expect(second.tagName).toBe('SELECT')
    expect(second).not.toBe(micSelect)
  })

  it('labels the single-device outputs', async () => {
    stubDevices([mic1, mic2])
    renderSources({ secondAudioDeviceId: 'mic2' })
    await waitFor(() => expect(screen.getByLabelText('System audio source').tagName).toBe('OUTPUT'))
  })

  it('labels the camera select and output', async () => {
    stubDevices([mic1, cam1, cam2])
    const { unmount } = render(<Camera />)
    expect((await screen.findByLabelText('Camera', PICKER)).tagName).toBe('SELECT')
    unmount()
    stubDevices([mic1, cam1])
    render(<Camera />)
    await waitFor(() => expect(screen.getByLabelText('Camera', PICKER).tagName).toBe('OUTPUT'))
  })
})

function Camera() {
  return (
    <RecordingSources
      useMicrophone
      onUseMicrophoneChange={vi.fn()}
      audioDeviceId="mic1"
      onAudioDeviceChange={vi.fn()}
      captureSystemAudio={false}
      onCaptureSystemAudioChange={vi.fn()}
      secondAudioDeviceId=""
      onSecondAudioDeviceChange={vi.fn()}
      useCamera
      onUseCameraChange={vi.fn()}
      videoDeviceId="cam1"
      onVideoDeviceChange={vi.fn()}
    />
  )
}

const monitor = { kind: 'audioinput', deviceId: 'monA', label: 'Monitor of Speakers' }
const monitor2 = { kind: 'audioinput', deviceId: 'monB', label: 'Monitor of Headset' }
const optionsOf = (field: HTMLElement) => within(field).getAllByRole('option').map((o) => o.textContent)

describe('RecordingSources monitor devices (#284)', () => {
  it('leaves monitors out of the microphone list while another device remains', async () => {
    stubDevices([monitor, mic1, mic2])
    renderSources({})
    const micSelect = await screen.findByLabelText('Microphone', PICKER)
    expect(optionsOf(micSelect)).toEqual(['Mic 1', 'Mic 2'])
  })

  it('shows a lone monitor as the microphone', async () => {
    stubDevices([monitor])
    renderSources({ audioDeviceId: 'monA', captureSystemAudio: false })
    await waitFor(() => expect(screen.getByLabelText('Microphone', PICKER)).toHaveTextContent(/^Monitor of Speakers$/))
  })

  it('lists monitors first as system audio and preselects the first one', async () => {
    stubDevices([mic1, mic2, monitor, monitor2])
    const onChange = renderSources({})
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('monA'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(optionsOf(screen.getByLabelText('System audio source'))).toEqual(['Monitor of Speakers', 'Monitor of Headset', 'Mic 2'])
  })

  it('still offers a leading monitor while the default microphone is in use', async () => {
    stubDevices([monitor, mic1, mic2])
    const onChange = renderSources({ audioDeviceId: '' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('monA'))
    expect(optionsOf(screen.getByLabelText('System audio source'))).toEqual(['Monitor of Speakers', 'Mic 2'])
  })

  it('keeps a chosen non-monitor second device', async () => {
    stubDevices([mic1, mic2, monitor])
    const onChange = renderSources({ secondAudioDeviceId: 'mic2' })
    await screen.findByLabelText('System audio source')
    await new Promise((r) => setTimeout(r, 20))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('System audio source')).toHaveValue('mic2')
  })
})
