/**
 * The audio inputs that may serve as the second (system-audio) device in the
 * Firefox/Linux dual-device mode: every input except the one the microphone
 * records from. An empty `audioDeviceId` means the browser's default
 * microphone, which the list shows as a "default" entry and/or as the first
 * real input, so both are excluded then.
 */
export function getSecondDeviceCandidates<T extends { deviceId: string }>(
  audioInputs: T[],
  audioDeviceId: string,
): T[] {
  if (audioDeviceId) return audioInputs.filter((d) => d.deviceId !== audioDeviceId)
  const firstInput = audioInputs.find((d) => d.deviceId !== 'default')
  return audioInputs.filter((d) => d.deviceId !== 'default' && d !== firstInput)
}
