import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemAudioSupport } from '../../utils/platformDetect'

// RecordingSources reads the system-audio support once, when the module loads,
// so each test sets the platform and then imports the component afresh, along
// with React, Testing Library and i18n so that all of them are the same copies.
const platform = vi.hoisted(() => ({ support: 'full' as SystemAudioSupport }))

vi.mock('../../utils/platformDetect', () => ({
  getSystemAudioSupport: () => platform.support,
}))

vi.mock('../../utils/devicePermissions', () => ({
  useDevicePermission: () => ({ state: 'granted', refresh: vi.fn() }),
}))

const mic = { kind: 'audioinput', deviceId: 'mic1', label: 'Mic' }
const monitor = { kind: 'audioinput', deviceId: 'mon1', label: 'Monitor of Speakers' }
const otherMonitor = { kind: 'audioinput', deviceId: 'mon2', label: 'Monitor of Headset' }

let cleanup = () => {}

function useDevices(devices: object[]) {
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

async function renderOn(support: SystemAudioSupport, props: { captureSystemAudio?: boolean; secondAudioDeviceId?: string } = {}) {
  platform.support = support
  vi.resetModules()
  const rtl = await import('@testing-library/react')
  const i18n = (await import('../../i18n')).default
  const { RecordingSources } = await import('./RecordingSources')
  await i18n.changeLanguage('en')
  cleanup = rtl.cleanup

  const onSecondAudioDeviceChange = vi.fn()
  rtl.render(
    <RecordingSources
      useMicrophone
      onUseMicrophoneChange={vi.fn()}
      audioDeviceId="mic1"
      onAudioDeviceChange={vi.fn()}
      captureSystemAudio={props.captureSystemAudio ?? true}
      onCaptureSystemAudioChange={vi.fn()}
      secondAudioDeviceId={props.secondAudioDeviceId ?? ''}
      onSecondAudioDeviceChange={onSecondAudioDeviceChange}
      useCamera={false}
      onUseCameraChange={vi.fn()}
      videoDeviceId=""
      onVideoDeviceChange={vi.fn()}
    />,
  )
  /** The "System audio source" field of the dual-device mode. */
  const secondDeviceField = () => rtl.within(rtl.screen.getByText('System audio source').parentElement!)
  return { screen: rtl.screen, waitFor: rtl.waitFor, secondDeviceField, onSecondAudioDeviceChange }
}

beforeEach(() => {
  useDevices([mic, monitor])
})

afterEach(() => {
  cleanup()
})

describe('RecordingSources on each platform', () => {
  it.each<[SystemAudioSupport, string]>([
    ['full', 'Select an entire screen to capture all system audio'],
    ['tab-only', 'system audio capture is limited to browser tab audio'],
    ['dual-device', 'Select a second audio input device below'],
    ['limited', 'System audio capture has limited support in Firefox'],
  ])('%s: offers system audio with the matching hint', async (support, hint) => {
    const { screen } = await renderOn(support)
    expect(screen.getByRole('switch', { name: 'System audio' })).toBeInTheDocument()
    expect(screen.getByText(hint, { exact: false })).toBeInTheDocument()
  })

  it('unsupported: does not offer system audio at all', async () => {
    const { screen } = await renderOn('unsupported')
    expect(screen.queryByRole('switch', { name: 'System audio' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Microphone' })).toBeInTheDocument()
  })

  it.each<SystemAudioSupport>(['full', 'tab-only', 'limited'])('%s: asks for no second device', async (support) => {
    const { screen, onSecondAudioDeviceChange } = await renderOn(support)
    await screen.findByText('Mic')
    expect(screen.queryByText('System audio source')).toBeNull()
    expect(onSecondAudioDeviceChange).not.toHaveBeenCalled()
  })

  describe('dual-device (Firefox on Linux)', () => {
    it('picks the only other input as the system audio source', async () => {
      const { waitFor, secondDeviceField, onSecondAudioDeviceChange } = await renderOn('dual-device')
      expect(await secondDeviceField().findByText('Monitor of Speakers')).toBeInTheDocument()
      await waitFor(() => expect(onSecondAudioDeviceChange).toHaveBeenCalledWith('mon1'))
    })

    it('offers every input except the microphone in use, and keeps a chosen one', async () => {
      useDevices([mic, monitor, otherMonitor])
      const { secondDeviceField, onSecondAudioDeviceChange } = await renderOn('dual-device', { secondAudioDeviceId: 'mon2' })
      await secondDeviceField().findByRole('option', { name: 'Monitor of Headset' })
      const options = secondDeviceField().getAllByRole('option').map((o) => o.textContent)
      expect(options).toEqual(['Monitor of Speakers', 'Monitor of Headset'])
      expect(secondDeviceField().getByRole('combobox')).toHaveValue('mon2')
      expect(onSecondAudioDeviceChange).not.toHaveBeenCalled()
    })

    it('leaves the second device alone while system audio is off', async () => {
      const { screen, onSecondAudioDeviceChange } = await renderOn('dual-device', { captureSystemAudio: false })
      await screen.findByText('Mic')
      expect(onSecondAudioDeviceChange).not.toHaveBeenCalled()
    })
  })
})
