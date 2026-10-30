import { expect, test, transcribe } from './fixtures.ts'

// The fake LLM (backend/scripts/fake_services.py) answers with canned content,
// so these check the whole round trip: UI → backend → LLM client → stored result → UI.

test('a summary analysis shows its chapters', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  await page.locator('[data-help="tab-analysis"]').click()
  await page.locator('[data-help="analysis-generate"]').click()
  await page.locator('[data-help="analysis-header"]').click()

  await expect(page.getByText('The team agreed to add end-to-end tests.')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-help="chapter-card"]')).toHaveCount(2)
  await expect(page.locator('[data-help="chapter-card"]').first()).toContainText('Opening')
})

test('a translation adds a translated view', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  await page.locator('[data-help="translate-open"]').click()
  const dialog = page.locator('[data-help="translate-dialog"]')
  await dialog.locator('select').first().selectOption('de')
  await page.locator('[data-help="translate-submit"]').click()

  await expect(page.locator('table tbody tr').first()).toContainText('[German] Welcome to the weekly project meeting.', { timeout: 20_000 })
})

test('a refinement adds a refined view next to the original', async ({ page, audioFile }) => {
  await transcribe(page, audioFile)

  await page.locator('[data-help="refine-open"]').click()
  await page.locator('[data-help="refine-submit"]').click()

  await expect(page.locator('[data-help="view-refined"]')).toBeVisible({ timeout: 20_000 })
  await page.locator('[data-help="view-refined"]').click()
  await expect(page.locator('table tbody tr').nth(3)).toContainText("let's write them this week")
  await expect(page.locator('[data-help="refined-summary"]')).toContainText('Fixed punctuation.')
})
