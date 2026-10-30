import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { useStore } from '../../store'
import type { ConfigResponse } from '../../api/types'
import { ApiError } from '../../api/client'
import { CreateTokenModal } from './CreateTokenModal'

const createApiToken = vi.hoisted(() => vi.fn())

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: { createApiToken },
}))

function setDefaultExpiry(days: number) {
  useStore.setState({ config: { api_token_default_expiry_days: days } as ConfigResponse })
}

beforeEach(async () => {
  createApiToken.mockReset()
  await i18n.changeLanguage('en')
  setDefaultExpiry(90)
})

describe('CreateTokenModal expiry', () => {
  it('offers a configured default that is not a preset, selected and used', async () => {
    setDefaultExpiry(60)
    createApiToken.mockResolvedValue({ id: '1', token: 'tw_x', name: 'a' })
    render(<CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} />)

    const select = screen.getByLabelText('Expires in') as HTMLSelectElement
    expect(select.selectedOptions[0]).toHaveTextContent('60 days')
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['30', '60', '90', '365'])

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my-script' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createApiToken).toHaveBeenCalledWith('my-script', 60))
  })

  it('does not duplicate a default that is already a preset', () => {
    render(<CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} />)
    const select = screen.getByLabelText('Expires in') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['30', '90', '365'])
  })

  it('labels a one-day default in the singular and in German', async () => {
    setDefaultExpiry(1)
    render(<CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByRole('option', { name: '1 day' })).toBeInTheDocument()
    await act(() => i18n.changeLanguage('de'))
    expect(screen.getByRole('option', { name: '1 Tag' })).toBeInTheDocument()
  })
})

describe('CreateTokenModal dialog semantics', () => {
  it('is a labelled modal dialog with a labelled, translated name field', async () => {
    render(<CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Create token' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('placeholder', 'e.g. my-script')
    await act(() => i18n.changeLanguage('de'))
    expect(screen.getByLabelText('Name')).toHaveAttribute('placeholder', 'z. B. mein-skript')
  })

  it('moves focus to the name field and gives it back on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByLabelText('Name')).toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('keeps focus on the name field under StrictMode', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(<StrictMode><CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} /></StrictMode>)
    expect(screen.getByLabelText('Name')).toHaveFocus()
    opener.remove()
  })

  it('closes on Escape in the form state', () => {
    const onClose = vi.fn()
    render(<CreateTokenModal onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape while the create request is running', () => {
    createApiToken.mockReturnValue(new Promise(() => {}))
    const onClose = vi.fn()
    render(<CreateTokenModal onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores Escape while the token secret is shown', async () => {
    createApiToken.mockResolvedValue({ id: '1', token: 'tw_secret', name: 'a' })
    const onClose = vi.fn()
    render(<CreateTokenModal onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByText('tw_secret')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('CreateTokenModal errors', () => {
  it('shows a duplicate-name error in German', async () => {
    await i18n.changeLanguage('de')
    createApiToken.mockRejectedValue(
      new ApiError(409, "An active token named 'a' already exists for this user", 'duplicate_token_name'),
    )
    render(<CreateTokenModal onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ein aktiver Token mit diesem Namen existiert bereits.')
    await act(() => i18n.changeLanguage('en'))
    expect(screen.getByRole('alert')).toHaveTextContent('An active token with this name already exists.')
  })
})
