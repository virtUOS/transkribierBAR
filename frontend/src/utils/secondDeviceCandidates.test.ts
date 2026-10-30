import { describe, expect, it } from 'vitest'
import { getSecondDeviceCandidates } from './secondDeviceCandidates'

const ids = (devices: { deviceId: string }[]) => devices.map((d) => d.deviceId)
const inputs = (...deviceIds: string[]) => deviceIds.map((deviceId) => ({ deviceId }))

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
