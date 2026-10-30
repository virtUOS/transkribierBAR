import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ApiError } from '../api/client'
import { tokenErrorMessage } from './tokenError'

const t = i18n.t.bind(i18n)

describe('tokenErrorMessage', () => {
  // Each stable code gets its own text in the UI language, never the server's
  // English detail (which can also carry the account name).
  it.each([
    [409, 'duplicate_token_name', 'settings.apiTokens.errors.duplicateName'],
    [429, 'token_limit_reached', 'settings.apiTokens.errors.limitReached'],
    [404, 'token_not_found', 'settings.apiTokens.errors.notFound'],
  ])('translates %i %s in every UI language', async (status, code, key) => {
    for (const lng of ['en', 'de']) {
      await i18n.changeLanguage(lng)
      const message = tokenErrorMessage(new ApiError(status, 'User jdoe has reached the maximum', code), t, 'create')
      expect(message).not.toBe(key)
      expect(message).not.toContain('jdoe')
      expect(message).toBe(i18n.getResource(lng, 'translation', key))
    }
  })

  it('shows the server text for an ApiError without a known code', () => {
    expect(tokenErrorMessage(new ApiError(500, 'Boom'), t, 'create')).toBe('Boom')
  })

  it('falls back to a translated generic text per action', async () => {
    await i18n.changeLanguage('en')
    expect(tokenErrorMessage('x', t, 'create')).toBe('Creating the token failed.')
    expect(tokenErrorMessage('x', t, 'revoke')).toBe('Revoking the token failed.')
    expect(tokenErrorMessage('x', t, 'list')).toBe('Loading the tokens failed.')
    await i18n.changeLanguage('de')
    expect(tokenErrorMessage('x', t, 'create')).toBe('Der Token konnte nicht erstellt werden.')
  })
})
