import { expect, test, transcribe } from './fixtures.ts'
import { API_PORT } from './ports.ts'

test('a token created in the settings reaches the API, and stops working once revoked', async ({ page, playwright, audioFile }) => {
  await transcribe(page, audioFile)

  await page.goto('/')
  await page.locator('[data-help="nav-settings"]').click()
  await page.locator('[data-help="token-create"]').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('e2e')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const secret = (await dialog.getByText(/^tw_/).textContent())!.trim()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-help="token-prefix"]')).toHaveCount(1)
  expect(secret.startsWith((await page.locator('[data-help="token-prefix"]').textContent())!.replace(/\W*$/, ''))).toBe(true)

  // A client without the proxy headers, straight to the backend: only the token identifies the user.
  const api = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${API_PORT}` })
  const listed = await api.get('/api/transcriptions', { headers: { Authorization: `Bearer ${secret}` } })
  expect(listed.status()).toBe(200)
  expect(JSON.stringify(await listed.json())).toContain('sample.mp3')

  // A token must not manage tokens.
  const minted = await api.post('/api/tokens', { headers: { Authorization: `Bearer ${secret}` }, data: { name: 'x' } })
  expect(minted.status()).toBe(403)

  await page.locator('[data-help="token-revoke"]').click()
  await expect(page.locator('[data-help="token-revoke"]')).toHaveCount(0)

  const after = await api.get('/api/transcriptions', { headers: { Authorization: `Bearer ${secret}` } })
  expect(after.status()).toBe(401)
  await api.dispose()
})
