import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { formatDateTime, parseServerDate } from '../../utils/format'
import { useStore } from '../../store'
import { ApiTokensSection } from './ApiTokensSection'

const token = {
  id: 't1', name: 'script', prefix: 'tw_abcd', created_at: '2026-01-01 00:00:00',
  expires_at: null, last_used_at: null, revoked_at: null,
}

const datedToken = {
  id: 'k1',
  name: 'ci',
  prefix: 'tw_abcd',
  created_at: '2026-10-01 08:00:00',
  expires_at: '2027-01-22 09:15:03',
  last_used_at: '2026-10-20 14:30:00',
  revoked_at: null,
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn()
let listed: unknown[] = [token]

beforeEach(async () => {
  await i18n.changeLanguage('en')
  listed = [token]
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'DELETE'
      ? jsonResponse(404, { detail: 'Token not found', code: 'token_not_found' })
      : jsonResponse(200, listed))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

describe('ApiTokensSection dates', () => {
  it.each(['en', 'de'])('shows locale-formatted local dates in %s', async (lang) => {
    listed = [datedToken]
    await i18n.changeLanguage(lang)
    render(<ApiTokensSection />)
    const exp = formatDateTime(parseServerDate(datedToken.expires_at), lang)
    const used = formatDateTime(parseServerDate(datedToken.last_used_at), lang)
    expect(await screen.findByText(new RegExp(exp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(used.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByText(/2027-01-22 09:15:03/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2026-10-20 14:30:00/)).not.toBeInTheDocument()
  })
})

describe('ApiTokensSection revoke errors', () => {
  it('shows the translated message for a token that no longer exists', async () => {
    render(<ApiTokensSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This token no longer exists.')
  })

  it('re-translates a shown error on a language switch without reloading the list', async () => {
    render(<ApiTokensSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    await screen.findByRole('alert')
    const calls = fetchMock.mock.calls.length
    await act(() => i18n.changeLanguage('de'))
    expect(screen.getByRole('alert')).toHaveTextContent('Dieser Token existiert nicht mehr.')
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})

describe('ApiTokensSection expiry notice', () => {
  beforeEach(() => useStore.setState({ tokenAttention: false }))

  it('names expiring and expired tokens above the list', async () => {
    listed = [
      { ...datedToken, id: 'a', name: 'soon-one', expires_at: '2026-11-02 09:00:00', expiry_warning: 'soon' },
      { ...datedToken, id: 'b', name: 'gone-one', expires_at: '2026-10-20 09:00:00', expiry_warning: 'expired' },
      { ...datedToken, id: 'c', name: 'fine-one', expiry_warning: null },
    ]
    render(<ApiTokensSection />)
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(`"soon-one" expires on ${formatDateTime('2026-11-02 09:00:00', 'en')}.`)
    expect(status).toHaveTextContent(`"gone-one" expired on ${formatDateTime('2026-10-20 09:00:00', 'en')}.`)
    expect(status).toHaveTextContent('Tokens cannot be extended. Create a new token and replace the old one in your scripts.')
    expect(status).not.toHaveTextContent('fine-one')
    expect(useStore.getState().tokenAttention).toBe(true)
  })

  it('lets the owner revoke an expired token, which clears its notice', async () => {
    const expired = { ...datedToken, id: 'b', name: 'gone-one', expires_at: '2026-10-20 09:00:00', expiry_warning: 'expired' }
    const revoked = { ...datedToken, id: 'r', name: 'old-one', revoked_at: '2026-10-21 09:00:00', expiry_warning: null }
    listed = [expired, revoked]
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        listed = [{ ...expired, revoked_at: '2026-10-27 10:00:00', expiry_warning: null }, revoked]
        return new Response(null, { status: 204 })
      }
      return jsonResponse(200, listed)
    })
    render(<ApiTokensSection />)
    expect(await screen.findByRole('status')).toHaveTextContent('"gone-one" expired on')
    expect(useStore.getState().tokenAttention).toBe(true)
    // One button: the expired token has one, the revoked token offers nothing to revoke.
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' })
    expect(revokeButtons).toHaveLength(1)

    fireEvent.click(revokeButtons[0])

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(useStore.getState().tokenAttention).toBe(false)
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/tokens\/b$/), { method: 'DELETE' })
  })

  it('shows no notice when no token needs attention', async () => {
    listed = [{ ...datedToken, expiry_warning: null }]
    render(<ApiTokensSection />)
    await screen.findByText('ci')
    expect(screen.queryByRole('status')).toBeNull()
    expect(useStore.getState().tokenAttention).toBe(false)
  })
})
