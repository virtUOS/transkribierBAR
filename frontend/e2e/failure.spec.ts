import { expect, test, uploadFile } from './fixtures.ts'

test('a failed transcription tells the user instead of hanging', async ({ page, audioFile }) => {
  await uploadFile(page, audioFile)

  // An initial prompt containing "fake:fail" makes the fake ASR report a failure.
  await page.locator('[data-help="upload-advanced-toggle"]').click()
  await page.locator('[data-help="upload-advanced"] textarea').first().fill('fake:fail')
  await page.locator('[data-help="transcribe-start"]').click()

  await expect(page.getByText('Fake ASR failure')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('table tbody tr')).toHaveCount(0)
})
