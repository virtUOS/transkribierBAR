import { expect, test, transcribe } from './fixtures.ts'

test("another user sees neither the transcription nor its media", async ({ page, browser, audioFile }) => {
  const created = page.waitForResponse((r) => r.url().endsWith('/api/transcribe') && r.ok())
  await transcribe(page, audioFile)
  const { id } = (await (await created).json()) as { id: string }

  const other = await browser.newContext({
    extraHTTPHeaders: { 'X-Auth-Request-User': `${test.info().testId}-other`, 'X-Auth-Request-Email': 'other@example.org' },
  })
  const otherPage = await other.newPage()
  await otherPage.goto('/')
  await expect(otherPage.locator('[data-help="new-upload"]')).toBeVisible()
  await expect(otherPage.locator('[data-help="archive-title"]')).toHaveCount(0)

  for (const path of [`/api/transcription/${id}`, `/api/status/${id}`, `/api/transcription/${id}/export/srt`]) {
    expect((await other.request.get(path)).status(), path).toBe(404)
  }
  expect((await other.request.delete(`/api/transcription/${id}`)).status()).toBe(404)
  expect((await page.request.get(`/api/transcription/${id}`)).status()).toBe(200)
  await other.close()
})
