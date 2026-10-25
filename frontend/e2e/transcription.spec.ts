import { readFileSync } from 'node:fs'
import { expect, test, transcribe } from './fixtures.ts'

test('upload, transcribe and see the transcript in the editor', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  const rows = page.locator('table tbody tr')
  await expect(rows.first()).toContainText('Welcome to the weekly project meeting.')
  await expect(rows.nth(3)).toContainText('let us write them this week')
})

test('a transcription shows up in the archive and can be reopened', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  // The fake LLM titles the transcription right after it completes, which the
  // editor already open does not pick up; the archive does. Once
  // https://github.com/virtUOS/transkribierBAR/issues/248 is fixed, check the editor header instead.
  await expect(async () => {
    await page.goto('/')
    await expect(page.locator('[data-help="archive-title"]')).toHaveText(['Weekly project meeting'], { timeout: 1000 })
  }).toPass()
  await page.locator('[data-help="archive-title"]').getByText('Weekly project meeting').click()
  await expect(page.locator('table tbody tr').first()).toContainText('Welcome to the weekly project meeting.')
})

test('the SRT export contains the transcript', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  await page.locator('[data-help="tab-srt"]').click()
  const download = page.waitForEvent('download')
  await page.locator('[data-help="format-download"]').first().click()
  const srt = readFileSync(await (await download).path(), 'utf8')
  expect(srt).toContain('00:00:00,000 --> 00:00:02,400')
  expect(srt).toContain('Welcome to the weekly project meeting.')
})
