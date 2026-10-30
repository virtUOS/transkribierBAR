import { expect, test, uploadFile } from './fixtures.ts'

test('a failed transcription tells the user instead of hanging', async ({ page, audioFile }) => {
  await uploadFile(page, audioFile)

  // An initial prompt containing "fake:fail" makes the fake ASR report a failure.
  await page.locator('[data-help="upload-advanced-toggle"]').click()
  await page.locator('[data-help="upload-advanced"] textarea').first().fill('fake:fail')
  await page.locator('[data-help="transcribe-start"]').click()

  // The backend files it under the asr_failed code, which the UI shows in the
  // user's language instead of the server's text (src/utils/transcriptionError.ts).
  await expect(page.getByText('Transcription failed', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('The speech recognition reported an error for this transcription.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(0)
})
