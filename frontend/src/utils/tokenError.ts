import type { TFunction } from 'i18next'
import { ApiError } from '../api/client'

type TokenAction = 'create' | 'revoke' | 'list'

const codeKeys: Record<string, string> = {
  duplicate_token_name: 'settings.apiTokens.errors.duplicateName',
  token_limit_reached: 'settings.apiTokens.errors.limitReached',
  token_not_found: 'settings.apiTokens.errors.notFound',
}

const fallbackKeys: Record<TokenAction, string> = {
  create: 'settings.apiTokens.errors.createFailed',
  revoke: 'settings.apiTokens.errors.revokeFailed',
  list: 'settings.apiTokens.errors.listFailed',
}

/**
 * The message to show when a token request fails.
 *
 * The server sends a stable code for the errors a user can act on, and its
 * detail is English (and names the account), so those are shown as translated
 * text without the detail. Any other API error shows the server's text.
 */
export function tokenErrorMessage(e: unknown, t: TFunction, action: TokenAction): string {
  if (e instanceof ApiError && e.code && codeKeys[e.code]) return t(codeKeys[e.code])
  if (e instanceof ApiError) return e.message
  return t(fallbackKeys[action])
}
