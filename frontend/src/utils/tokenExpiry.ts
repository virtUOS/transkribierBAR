import type { ApiToken } from '../api/types'
import { parseServerDate } from './format'

/** Tokens the server flagged via `expiry_warning`, soonest expiry first. */
export function tokensNeedingAttention(tokens: ApiToken[]): ApiToken[] {
  const time = (t: ApiToken) => (t.expires_at ? parseServerDate(t.expires_at).getTime() : Infinity)
  return tokens.filter((t) => t.expiry_warning).sort((a, b) => time(a) - time(b))
}
