import { spawnSync } from 'node:child_process'
import { test as base, expect, type Page } from '@playwright/test'

/**
 * Every test signs in as its own user, through the headers the reverse proxy
 * sets in production, so tests can run in parallel against one backend without
 * seeing each other's transcriptions, presets or tokens.
 */
export const test = base.extend<{ user: string; audioFile: string }>({
  user: async ({}, use, testInfo) => {
    await use(`e2e-${testInfo.workerIndex}-${testInfo.testId}-${testInfo.retry}`)
  },
  extraHTTPHeaders: async ({ user }, use) => {
    await use({ 'X-Auth-Request-User': user, 'X-Auth-Request-Email': `${user}@example.org` })
  },
  audioFile: async ({}, use, testInfo) => {
    // A short generated tone; the fake ASR ignores the content, but the backend
    // converts and probes it with ffmpeg like any upload.
    const path = testInfo.outputPath('sample.mp3')
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path])
    if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr?.toString() ?? ff.error?.message}`)
    await use(path)
  },
})

export { expect }

/** Upload a file from the start page and wait until the upload has landed. */
export async function uploadFile(page: Page, path: string): Promise<void> {
  await page.goto('/')
  await page.locator('[data-help="new-upload"]').click()
  const uploaded = page.waitForResponse((r) => r.url().includes('/api/upload') && r.ok())
  await page.locator('#file-upload').setInputFiles(path)
  await uploaded
  await page.locator('#file-upload').waitFor({ state: 'detached' })
}

/** Upload, start the transcription with default settings and wait for the editor. */
export async function transcribe(page: Page, path: string): Promise<void> {
  await uploadFile(page, path)
  await page.locator('[data-help="transcribe-start"]').click()
  await expect(page.locator('table tbody tr')).toHaveCount(4, { timeout: 20_000 })
}
