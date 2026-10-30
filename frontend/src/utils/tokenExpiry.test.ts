import { describe, expect, it } from 'vitest'
import type { ApiToken } from '../api/types'
import { tokensNeedingAttention } from './tokenExpiry'

function make(id: string, expires_at: string | null, expiry_warning: ApiToken['expiry_warning']): ApiToken {
  return { id, name: id, prefix: 'tw_x', created_at: '2026-01-01 00:00:00', expires_at, last_used_at: null, revoked_at: null, expiry_warning }
}

describe('tokensNeedingAttention', () => {
  it('keeps only tokens with a warning, soonest first', () => {
    const tokens = [
      make('later', '2026-11-20 10:00:00', 'soon'),
      make('fine', '2027-01-01 10:00:00', null),
      make('old', '2026-10-20 10:00:00', 'expired'),
      make('unset', null, undefined),
    ]
    expect(tokensNeedingAttention(tokens).map((t) => t.id)).toEqual(['old', 'later'])
  })
})
