import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// The recorder adapts to the browser and OS (src/utils/platformDetect.ts), so
// this spec runs in Chromium and Firefox (see playwright.config.ts). Both
// browsers are started with fake media devices: a generated tone instead of a
// microphone, and no permission prompt. Which system-audio path the app offers
// depends on the OS as well, so the tests expect what the app's own rules give
// for the OS they run on: in CI (Linux) Chromium takes the "tab-only" path and
// Firefox the "dual-device" one; on macOS Firefox takes "limited".

/** A phrase from the hint the system-audio card shows for each kind of support. */
const SYSTEM_AUDIO_HINT: Record<string, string> = {
  full: 'Select an entire screen to capture all system audio',
  'tab-only': 'system audio capture is limited to browser tab audio',
  'dual-device': 'Select a second audio input device below',
  limited: 'System audio capture has limited support in Firefox',
}

const HOST_OS: Record<string, string> = { linux: 'linux', darwin: 'macos', win32: 'windows' }

/**
 * The system-audio support the app should offer here: its own rules
 * (getSystemAudioSupport, loaded from the Vite dev server) applied to the
 * browser Playwright started and the OS this test runs on. The page detects
 * both from its user agent, so a wrong detection shows up as a wrong hint.
 * Needs a page on the app's origin.
 */
async function expectedSystemAudioSupport(page: Page, browserName: string): Promise<string> {
  const profile = JSON.stringify({ engine: browserName, os: HOST_OS[process.platform] ?? 'other' })
  // A string, as it runs in the page and imports a path only the dev server knows.
  return page.evaluate<string>(`import('/src/utils/platformDetect.ts').then((m) => m.getSystemAudioSupport(${profile}))`)
}

async function openRecorder(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-help="new-recording"]').click()
  await expect(page.locator('[data-help="record-mic-device"]')).toBeVisible()
}

/** Record for a moment, stop, and wait until the recording is uploaded and ready to transcribe. */
async function recordAndUpload(page: Page): Promise<{ id: string; original_filename: string }> {
  const uploaded = page.waitForResponse((r) => r.url().includes('/api/upload') && r.ok())
  await page.locator('[data-help="record-start"]').click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop' }).click()
  const file = (await (await uploaded).json()) as { id: string; original_filename: string }
  await expect(page.locator('[data-help="transcribe-start"]')).toBeVisible()
  return file
}

/**
 * The loudest moment of an uploaded recording, in dB (ffmpeg's volumedetect),
 * or -Infinity when it has no audio. The fake ASR ignores the audio, so this
 * is what shows that the microphone's tone made it into the file.
 */
async function recordedPeakDb(page: Page, fileId: string): Promise<number> {
  const media = await page.request.get(`/api/media/${fileId}`)
  expect(media.ok()).toBe(true)
  const path = test.info().outputPath('recording.webm')
  writeFileSync(path, await media.body())
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'])
  const peak = /max_volume: (-?[\d.]+|-inf) dB/.exec(ff.stderr?.toString() ?? '')
  return peak && peak[1] !== '-inf' ? Number(peak[1]) : -Infinity
}

test('a microphone recording is uploaded and transcribed', async ({ page }) => {
  await openRecorder(page)
  const file = await recordAndUpload(page)
  // Both browsers record WebM/Opus; the backend converts it like any upload.
  expect(file.original_filename).toMatch(/^recording-.*\.webm$/)
  expect(await recordedPeakDb(page, file.id)).toBeGreaterThan(-50)

  await page.locator('[data-help="transcribe-start"]').click()
  await expect(page.locator('table tbody tr')).toHaveCount(4, { timeout: 20_000 })
})

test('the system-audio option explains what this browser can capture', async ({ page, browserName }) => {
  await openRecorder(page)
  const support = await expectedSystemAudioSupport(page, browserName)
  await page.locator('[data-help="record-source-system"]').click()
  await expect(page.getByText(SYSTEM_AUDIO_HINT[support])).toBeVisible()
  // Only the dual-device mode asks for a second input device.
  await expect(page.getByText('System audio source')).toBeVisible({ visible: support === 'dual-device' })
})

test('Firefox on Linux mixes a second input device in as system audio', async ({ page, browserName }) => {
  await page.goto('/')
  test.skip(
    (await expectedSystemAudioSupport(page, browserName)) !== 'dual-device',
    'the app offers the dual-device mode only in Firefox on Linux',
  )

  // Firefox offers a single fake microphone, so a second input (standing in for
  // a PulseAudio/PipeWire monitor source) is added to the device list and
  // answered with the same fake stream. Everything after that is the app's own
  // code: the device dropdown, the second getUserMedia call and the mixing.
  // A string, as it runs in the page, where the DOM types live.
  await page.addInitScript(`(() => {
    const devices = navigator.mediaDevices
    const enumerate = devices.enumerateDevices.bind(devices)
    const getUserMedia = devices.getUserMedia.bind(devices)
    const monitor = { deviceId: 'e2e-monitor', groupId: 'e2e', kind: 'audioinput', label: 'Monitor of e2e output' }
    devices.enumerateDevices = async () => [...(await enumerate()), { ...monitor, toJSON: () => monitor }]
    devices.getUserMedia = (constraints) => {
      if (constraints?.audio?.deviceId?.exact !== monitor.deviceId) return getUserMedia(constraints)
      window.e2eMonitorOpened = true
      return getUserMedia({ audio: true })
    }
  })()`)

  await openRecorder(page)
  await page.locator('[data-help="record-source-system"]').click()
  // The only other input is picked automatically.
  await expect(page.locator('output').filter({ hasText: 'Monitor of e2e output' })).toBeVisible()

  const file = await recordAndUpload(page)
  expect(file.original_filename).toMatch(/\.webm$/)
  expect(await page.evaluate('window.e2eMonitorOpened')).toBe(true)
  // The two inputs are mixed in an AudioContext, which Firefox does not run
  // without an audio output: the recording then holds only silence. CI gives
  // Firefox a PulseAudio null sink for this (.github/workflows/e2e-tests.yaml).
  expect(await recordedPeakDb(page, file.id)).toBeGreaterThan(-50)
  await page.locator('[data-help="transcribe-start"]').click()
  await expect(page.locator('table tbody tr')).toHaveCount(4, { timeout: 20_000 })
})
