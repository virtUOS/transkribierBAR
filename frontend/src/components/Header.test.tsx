import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../store'
import { useBeforeUnloadWarning } from '../hooks/useBeforeUnloadWarning'
import i18n from '../i18n'
import { api } from '../api/client'
import type { ConfigResponse } from '../api/types'
import { Header } from './Header'

describe('Header', () => {
  afterEach(() => {
    i18n.addResource(i18n.language, 'translation', 'title', 'transkribierBAR')
  })

  it('sets the trailing "BAR" of the title in the accent colour', () => {
    render(<Header />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/^transkribierBAR$/)
    const accent = heading.querySelector('span')
    expect(accent).toHaveTextContent(/^BAR$/)
    expect(accent).toHaveClass('text-orange-400')
  })

  it('renders a title without the "BAR" ending as plain text', () => {
    i18n.addResource(i18n.language, 'translation', 'title', 'Something else')
    render(<Header />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/^Something else$/)
    expect(heading.querySelector('span')).toBeNull()
  })
})

describe('Header logout with something at stake', () => {
  function Harness() {
    useBeforeUnloadWarning()
    return <Header />
  }

  function setup(confirmAnswer: boolean) {
    const unloadEvents: BeforeUnloadEvent[] = []
    // Chromium fires beforeunload synchronously inside the href assignment; mimic that.
    vi.stubGlobal('location', {
      set href(_url: string) {
        const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
        window.dispatchEvent(e)
        unloadEvents.push(e)
      },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(confirmAnswer)
    useStore.getState().reset()
    useStore.setState({ config: { logout_url: '/logout' } as never })
    // An uploaded recording that was not submitted: confirmLeave changes no state, so the
    // guard stays armed and only allowNextUnload keeps the browser quiet.
    useStore.setState({
      currentView: 'record',
      file: { id: 'f1', original_filename: 'r.webm', file_size: 1 } as never,
    })
    render(<Harness />)
    return unloadEvents
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useStore.getState().reset()
  })

  it('does not show the browser prompt after the user confirmed the logout', () => {
    const events = setup(true)
    fireEvent.click(screen.getAllByText(/log ?out|abmelden/i)[0])
    expect(events).toHaveLength(1)
    expect(events[0].defaultPrevented).toBe(false)
  })

  it('keeps the guard armed when the logout is declined', () => {
    const events = setup(false)
    fireEvent.click(screen.getAllByText(/log ?out|abmelden/i)[0])
    expect(events).toHaveLength(0)
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })
})

describe('Header token attention mark', () => {
  const enabled = { api_tokens_enabled: true } as ConfigResponse
  const tokenRow = {
    id: 't', name: 'n', prefix: 'tw_x', created_at: '2026-01-01 00:00:00',
    expires_at: '2026-11-01 00:00:00', last_used_at: null, revoked_at: null,
  }

  afterEach(() => {
    vi.restoreAllMocks()
    useStore.setState({ config: null, tokenAttention: false })
  })

  const attention = 'An API token expires soon or has expired'

  it('marks the Settings button while a token needs attention', async () => {
    vi.spyOn(api, 'listApiTokens').mockResolvedValue([{ ...tokenRow, expiry_warning: 'soon' }])
    useStore.setState({ config: enabled, tokenAttention: false })
    render(<Header />)
    const button = await screen.findByRole('button', { name: new RegExp(`Settings.*${attention}`) })
    expect(button).toHaveAttribute('title', attention)
    expect(button.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('marks the menu button and its Settings item on small screens', async () => {
    vi.spyOn(api, 'listApiTokens').mockResolvedValue([{ ...tokenRow, expiry_warning: 'expired' }])
    useStore.setState({ config: enabled, tokenAttention: false })
    render(<Header />)
    // The Settings item sits inside the closed menu, so the menu button carries the mark too.
    const burger = await screen.findByRole('button', { name: new RegExp(`Menu.*${attention}`) })
    expect(burger).toHaveAttribute('title', attention)
    expect(burger).toHaveAttribute('aria-expanded', 'false')
    expect(burger.querySelector('span[aria-hidden="true"]')).not.toBeNull()

    fireEvent.click(burger)
    const item = screen.getByRole('menuitem', { name: new RegExp(`Settings.*${attention}`) })
    expect(item).toHaveAttribute('title', attention)
    expect(item.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('leaves the menu button plain while no token needs attention', async () => {
    const spy = vi.spyOn(api, 'listApiTokens').mockResolvedValue([{ ...tokenRow, expiry_warning: null }])
    useStore.setState({ config: enabled, tokenAttention: false })
    render(<Header />)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await Promise.resolve()
    const burger = screen.getByRole('button', { name: 'Menu' })
    expect(burger).not.toHaveAttribute('title')
    expect(burger.querySelector('span[aria-hidden="true"]')).toBeNull()
    fireEvent.click(burger)
    expect(screen.getByRole('menuitem', { name: 'Settings' })).not.toHaveAttribute('title')
  })

  it('shows no mark when the token list fails to load', async () => {
    const spy = vi.spyOn(api, 'listApiTokens').mockRejectedValue(new Error('boom'))
    useStore.setState({ config: enabled, tokenAttention: false })
    render(<Header />)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByRole('button', { name: /An API token expires soon/ })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not fetch tokens when API tokens are disabled', () => {
    const spy = vi.spyOn(api, 'listApiTokens').mockResolvedValue([])
    useStore.setState({ config: { api_tokens_enabled: false } as ConfigResponse })
    render(<Header />)
    expect(spy).not.toHaveBeenCalled()
  })
})
