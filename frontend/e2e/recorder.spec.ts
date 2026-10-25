import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// The recorder adapts to the browser (src/utils/platformDetect.ts), so this spec
// runs in Chromium and Firefox (see playwright.config.ts). Both browsers are
// started with fake media devices: a generated tone instead of a microphone,
// and no permission prompt. CI runs on Linux, so Chromium takes the "tab-only"
// system-audio path and Firefox the "dual-device" one.

const SYSTEM_AUDIO_HINT = {
  chromium: 'system audio capture is limited to browser tab audio',
  firefox: 'Select a second audio input device below',
}

async function openRecorder(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-help="new-recording"]').click()
  await expect(page.locator('[data-help="record-mic-device"]')).toBeVisible()
}

/** Record for a moment, stop, and wait until the recording is uploaded and ready to transcribe. */
async function recordAndUpload(page: Page): Promise<string> {
  const uploaded = page.waitForResponse((r) => r.url().includes('/api/upload') && r.ok())
  await page.locator('[data-help="record-start"]').click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop' }).click()
  const file = (await (await uploaded).json()) as { original_filename: string }
  await expect(page.locator('[data-help="transcribe-start"]')).toBeVisible()
  return file.original_filename
}

test('a microphone recording is uploaded and transcribed', async ({ page }) => {
  await openRecorder(page)
  const filename = await recordAndUpload(page)
  // Both browsers record WebM/Opus; the backend converts it like any upload.
  expect(filename).toMatch(/^recording-.*\.webm$/)

  await page.locator('[data-help="transcribe-start"]').click()
  await expect(page.locator('table tbody tr')).toHaveCount(4, { timeout: 20_000 })
})

test('the system-audio option explains what this browser can capture', async ({ page, browserName }) => {
  await openRecorder(page)
  await page.locator('[data-help="record-source-system"]').click()
  await expect(page.getByText(SYSTEM_AUDIO_HINT[browserName as keyof typeof SYSTEM_AUDIO_HINT])).toBeVisible()
  await expect(page.getByText('System audio source')).toBeVisible({ visible: browserName === 'firefox' })
})

test('Firefox on Linux mixes a second input device in as system audio', async ({ page, browserName }) => {
  test.skip(browserName !== 'firefox', 'the dual-device mode is Firefox on Linux only')

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

  const filename = await recordAndUpload(page)
  expect(filename).toMatch(/\.webm$/)
  expect(await page.evaluate('window.e2eMonitorOpened')).toBe(true)
  await page.locator('[data-help="transcribe-start"]').click()
  await expect(page.locator('table tbody tr')).toHaveCount(4, { timeout: 20_000 })
})
