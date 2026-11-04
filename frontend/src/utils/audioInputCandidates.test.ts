import { describe, expect, it } from 'vitest'
import { getMicrophoneCandidates, getSecondDeviceCandidates, isMonitorDevice } from './audioInputCandidates'

const ids = (devices: { deviceId: string }[]) => devices.map((d) => d.deviceId)
const inputs = (...deviceIds: string[]) => deviceIds.map((deviceId) => ({ deviceId, label: deviceId }))

describe('getSecondDeviceCandidates', () => {
  it('excludes exactly the chosen microphone', () => {
    expect(ids(getSecondDeviceCandidates(inputs('mic1', 'mon1', 'mic2'), 'mon1'))).toEqual(['mic1', 'mic2'])
    expect(ids(getSecondDeviceCandidates(inputs('default', 'mic1', 'mon1'), 'mon1'))).toEqual(['default', 'mic1'])
  })

  it('excludes the first input for the default microphone', () => {
    expect(ids(getSecondDeviceCandidates(inputs('mic1', 'mon1', 'mon2'), ''))).toEqual(['mon1', 'mon2'])
  })

  it('excludes the "default" entries and the first real input for the default microphone', () => {
    expect(ids(getSecondDeviceCandidates(inputs('default', 'mic1', 'mon1'), ''))).toEqual(['mon1'])
  })

  it('returns nothing when only the default microphone exists', () => {
    expect(getSecondDeviceCandidates(inputs('mic1'), '')).toEqual([])
    expect(getSecondDeviceCandidates(inputs('default', 'mic1'), '')).toEqual([])
    expect(getSecondDeviceCandidates([], '')).toEqual([])
  })
})

const mon = (deviceId: string) => ({ deviceId, label: `Monitor of ${deviceId}` })
const mic = (deviceId: string) => ({ deviceId, label: deviceId })

describe('isMonitorDevice', () => {
  it('matches the untranslated PulseAudio/PipeWire prefix, case-sensitively', () => {
    expect(isMonitorDevice({ label: 'Monitor of Internes Audio Analog Stereo' })).toBe(true)
    expect(isMonitorDevice({ label: 'monitor of X' })).toBe(false)
    expect(isMonitorDevice({ label: 'Default - Monitor of X' })).toBe(false)
    expect(isMonitorDevice({ label: '' })).toBe(false)
  })
})

describe('getMicrophoneCandidates', () => {
  it('leaves monitors out while another device remains', () => {
    expect(ids(getMicrophoneCandidates([mon('mon1'), mic('mic1'), mon('mon2')]))).toEqual(['mic1'])
  })
  it('keeps a lone monitor', () => {
    expect(ids(getMicrophoneCandidates([mon('mon1')]))).toEqual(['mon1'])
    expect(ids(getMicrophoneCandidates([mon('mon1'), mon('mon2')]))).toEqual(['mon1', 'mon2'])
  })
  it('treats unlabeled devices as microphones', () => {
    expect(ids(getMicrophoneCandidates([{ deviceId: 'a', label: '' }, mon('mon1')]))).toEqual(['a'])
  })
})

describe('getSecondDeviceCandidates with monitors', () => {
  it('lists monitors first, each group in input order', () => {
    expect(ids(getSecondDeviceCandidates([mic('mic1'), mic('mic2'), mon('mon1'), mon('mon2')], 'mic1'))).toEqual(['mon1', 'mon2', 'mic2'])
  })
  it('takes the default microphone from the filtered list, so a leading monitor stays offered', () => {
    expect(ids(getSecondDeviceCandidates([mon('mon1'), mic('mic1'), mic('mic2')], ''))).toEqual(['mon1', 'mic2'])
    expect(ids(getSecondDeviceCandidates([{ deviceId: 'default', label: 'Default' }, mon('mon1'), mic('mic1')], ''))).toEqual(['mon1'])
  })
  it('offers nothing when a lone monitor is the default microphone', () => {
    expect(getSecondDeviceCandidates([mon('mon1')], '')).toEqual([])
  })
})
