/**
 * Telling monitor sources from microphones (#284). Firefox on Linux lists
 * PulseAudio/PipeWire monitor sources (what an output device plays) among the
 * microphones. Both servers hard-code the label prefix "Monitor of " without
 * translating it (PulseAudio `sink.c`, PipeWire `pulse-server.c`), so the label
 * is the only signal the browser gives.
 *
 * - `isMonitorDevice`: whether a device is such a monitor source.
 * - `getMicrophoneCandidates`: the inputs the microphone selector offers, i.e.
 *   without monitors, unless nothing else exists (a lone monitor stays usable).
 * - `getSecondDeviceCandidates`: the inputs that may serve as the second
 *   (system-audio) device in the Firefox/Linux dual-device mode: every input
 *   except the one the microphone records from, monitors first because they are
 *   what the user most likely wants. An empty `audioDeviceId` means the
 *   browser's default microphone, which the list shows as a "default" entry
 *   and/or as the first real microphone, so both are excluded then. Firefox
 *   lists the default input first, so a leading monitor is the default input;
 *   the component then pins a listed microphone (see RecordingSources).
 */
export function isMonitorDevice(device: { label: string }): boolean {
  return /^Monitor of /.test(device.label)
}

export function getMicrophoneCandidates<T extends { label: string }>(audioInputs: T[]): T[] {
  const microphones = audioInputs.filter((d) => !isMonitorDevice(d))
  return microphones.length > 0 ? microphones : audioInputs
}

export function getSecondDeviceCandidates<T extends { deviceId: string; label: string }>(
  audioInputs: T[],
  audioDeviceId: string,
): T[] {
  let candidates: T[]
  if (audioDeviceId) {
    candidates = audioInputs.filter((d) => d.deviceId !== audioDeviceId)
  } else {
    const firstInput = getMicrophoneCandidates(audioInputs).find((d) => d.deviceId !== 'default')
    candidates = audioInputs.filter((d) => d.deviceId !== 'default' && d !== firstInput)
  }
  return [...candidates.filter(isMonitorDevice), ...candidates.filter((d) => !isMonitorDevice(d))]
}
