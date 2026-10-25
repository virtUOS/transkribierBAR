import { expect, test, transcribe } from './fixtures.ts'

test('an edited utterance is saved and survives reopening', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  const first = page.locator('table tbody tr').first()
  await first.getByTitle('Edit text').click()
  await first.locator('textarea').fill('Welcome to the edited meeting.')
  await first.locator('textarea').blur()

  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/transcription\/[^/]+$/.test(r.url()))
  await page.getByRole('button', { name: 'Save changes' }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden()

  await page.goto('/')
  await page.locator('[data-help="archive-title"]').first().click()
  await expect(page.locator('table tbody tr').first()).toContainText('Welcome to the edited meeting.')
})

test('speaker names apply to every utterance of that speaker', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  await page.locator('[data-help="speaker-names"]').click()
  const panel = page.locator('[data-help="speaker-panel"]')
  await panel.locator('input').first().fill('Alice')
  await page.locator('[data-help="speaker-apply"]').click()

  // The fake ASR alternates SPEAKER_00 and SPEAKER_01, starting with SPEAKER_00.
  const speakers = page.locator('table tbody tr [data-help="row-speaker"]')
  await expect(speakers.nth(0)).toContainText('Alice')
  await expect(speakers.nth(2)).toContainText('Alice')
  await expect(speakers.nth(1)).not.toContainText('Alice')
})
