import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { CreateInvitationModal } from './CreateInvitationModal'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('CreateInvitationModal dialog semantics', () => {
  it('is a labelled modal dialog that closes on Escape', () => {
    const onClose = vi.fn()
    render(<CreateInvitationModal onClose={onClose} onSubmit={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Invite a user' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus in and returns it to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<CreateInvitationModal onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
