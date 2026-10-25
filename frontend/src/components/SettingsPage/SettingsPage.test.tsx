import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api } from '../../api/client'
import { SettingsPage } from './index'
import { ApiTokensSection } from './ApiTokensSection'
import { CreateTokenModal } from './CreateTokenModal'
import type { ApiToken, ApiTokenCreated } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: {
    listApiTokens: vi.fn(),
    createApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
    listInvitations: vi.fn(),
  },
}))

function token(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'tok1',
    name: 'ci-script',
    prefix: 'tw_abc',
    created_at: '2026-01-01 00:00:00',
    expires_at: '2999-01-01 00:00:00',
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  }
}

const created: ApiTokenCreated = { ...token({ id: 'new', name: 'my-script' }), token: 'tw_SECRET_once' }

const initialState = useStore.getState()

beforeEach(async () => {
  vi.clearAllMocks()
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
  vi.mocked(api.listInvitations).mockResolvedValue([])
})

describe('SettingsPage', () => {
  it('shows the API token section', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([])
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(await screen.findByText('No API tokens yet. Create one to get started.')).toBeInTheDocument()
    expect(api.listInvitations).not.toHaveBeenCalled()
  })

  it('shows invitations only for admins in invitation mode', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([])
    useStore.setState({ config: { is_admin: true, invitation_mode: true } as never })
    render(<SettingsPage />)
    await waitFor(() => expect(api.listInvitations).toHaveBeenCalled())
  })
})

// The token name field is found by its placeholder because its label is not tied
// to it (https://github.com/virtUOS/transkribierBAR/issues/250); switch to
// getByLabelText('Name') once that is fixed.
describe('ApiTokensSection', () => {
  it('lists tokens with prefix, status and dates', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([
      token({ last_used_at: '2026-02-02 10:00:00' }),
      token({ id: 'tok2', name: 'old', expires_at: '2000-01-01 00:00:00' }),
      token({ id: 'tok3', name: 'gone', revoked_at: '2026-01-02 00:00:00' }),
    ])
    render(<ApiTokensSection />)
    expect(await screen.findByText('ci-script')).toBeInTheDocument()
    expect(screen.getAllByText('tw_abc…')).toHaveLength(3)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getByText('last used 2026-02-02 10:00:00')).toBeInTheDocument()
    // Only the active token can be revoked.
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
  })

  it('treats a token without expiry as active', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([token({ expires_at: null })])
    render(<ApiTokensSection />)
    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(screen.queryByText(/^expires/)).not.toBeInTheDocument()
  })

  it('shows the load error instead of the empty hint', async () => {
    vi.mocked(api.listApiTokens).mockRejectedValue(new Error('Server down'))
    render(<ApiTokensSection />)
    expect(await screen.findByText('Server down')).toBeInTheDocument()
    expect(screen.queryByText(/No API tokens yet/)).not.toBeInTheDocument()
  })

  it('revokes a token and reloads the list', async () => {
    vi.mocked(api.listApiTokens)
      .mockResolvedValueOnce([token()])
      .mockResolvedValueOnce([token({ revoked_at: '2026-03-03 00:00:00' })])
    vi.mocked(api.revokeApiToken).mockResolvedValue()
    render(<ApiTokensSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(api.revokeApiToken).toHaveBeenCalledWith('tok1')
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  })

  it('shows the error when revoking fails', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([token()])
    vi.mocked(api.revokeApiToken).mockRejectedValue(new Error('Not Found'))
    render(<ApiTokensSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(await screen.findByText('Not Found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled()
  })

  it('creates a token through the modal and refreshes the list after Done', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValueOnce([]).mockResolvedValueOnce([token({ name: 'my-script' })])
    vi.mocked(api.createApiToken).mockResolvedValue(created)
    render(<ApiTokensSection />)
    await screen.findByText(/No API tokens yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: 'my-script' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('tw_SECRET_once')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('tw_SECRET_once')).not.toBeInTheDocument()
    expect(await screen.findByText('my-script')).toBeInTheDocument()
    expect(api.listApiTokens).toHaveBeenCalledTimes(2)
  })

  it('closes the modal on Cancel without creating anything', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([])
    render(<ApiTokensSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    expect(screen.getByPlaceholderText('e.g. my-script')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('e.g. my-script')).not.toBeInTheDocument()
    expect(api.createApiToken).not.toHaveBeenCalled()
  })
})

describe('CreateTokenModal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function renderModal() {
    const onClose = vi.fn()
    const onCreated = vi.fn()
    render(<CreateTokenModal onClose={onClose} onCreated={onCreated} />)
    return { onClose, onCreated }
  }

  it('cannot be submitted without a name (whitespace does not count)', () => {
    renderModal()
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: '   ' } })
    expect(create).toBeDisabled()
  })

  it('defaults to the configured expiry and sends the trimmed name', async () => {
    useStore.setState({ config: { api_token_default_expiry_days: 30 } as never })
    vi.mocked(api.createApiToken).mockResolvedValue(created)
    renderModal()
    expect(screen.getByLabelText('Expires in')).toHaveValue('30')
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: '  deploy  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledWith('deploy', 30))
  })

  it('falls back to 90 days without config and sends the chosen expiry', async () => {
    vi.mocked(api.createApiToken).mockResolvedValue(created)
    renderModal()
    expect(screen.getByLabelText('Expires in')).toHaveValue('90')
    fireEvent.change(screen.getByLabelText('Expires in'), { target: { value: '365' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledWith('x', 365))
  })

  it.todo(
    'shows the expiry that will actually be sent when API_TOKEN_DEFAULT_EXPIRY_DAYS is not 30/90/365 '
    + '(bug https://github.com/virtUOS/transkribierBAR/issues/244: with e.g. 60 the select displays "30 days" but 60 is submitted — CreateTokenModal.tsx:16,125)',
  )

  it('shows the secret once with a warning, and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.mocked(api.createApiToken).mockResolvedValue(created)
    const { onCreated } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Token created' })).toBeInTheDocument()
    expect(screen.getByText("Save this now — you won't see it again.")).toBeInTheDocument()
    expect(screen.getByText('tw_SECRET_once')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('tw_SECRET_once')

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onCreated).toHaveBeenCalledOnce()
    expect(screen.queryByText('tw_SECRET_once')).not.toBeInTheDocument()
  })

  it('resets the Copied! label after two seconds', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    vi.mocked(api.createApiToken).mockResolvedValue(created)
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('shows the server error and stays on the form', async () => {
    vi.mocked(api.createApiToken).mockRejectedValue(new Error('Too many tokens'))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Too many tokens')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('shows a busy label while creating', async () => {
    let resolve!: (v: ApiTokenCreated) => void
    vi.mocked(api.createApiToken).mockReturnValue(new Promise((r) => { resolve = r }))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('e.g. my-script'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled()
    await act(async () => resolve(created))
    expect(within(document.body).getByText('tw_SECRET_once')).toBeInTheDocument()
  })
})
