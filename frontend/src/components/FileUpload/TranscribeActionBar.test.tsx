import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TranscribeActionBar } from './TranscribeActionBar'

describe('TranscribeActionBar', () => {
  it('calls onClick when enabled', () => {
    const onClick = vi.fn()
    render(<TranscribeActionBar onClick={onClick} disabled={false} label="Transcribe" />)
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('explains why it is disabled', () => {
    const onClick = vi.fn()
    render(<TranscribeActionBar onClick={onClick} disabled disabledReason="Upload a file first" label="Transcribe" />)
    const button = screen.getByRole('button', { name: 'Transcribe' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Upload a file first')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('has no tooltip when enabled', () => {
    render(<TranscribeActionBar onClick={() => {}} disabled={false} disabledReason="nope" label="Transcribe" />)
    expect(screen.getByRole('button', { name: 'Transcribe' })).not.toHaveAttribute('title')
  })

  it('disables both buttons while submitting', () => {
    render(<TranscribeActionBar onClick={() => {}} disabled={false} submitting label="Transcribe" onDiscard={() => {}} discardLabel="Discard" />)
    expect(screen.getByRole('button', { name: 'Transcribe' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()
  })

  it('shows a discard button only when a handler is given', () => {
    const onDiscard = vi.fn()
    const { rerender } = render(<TranscribeActionBar onClick={() => {}} disabled={false} label="Transcribe" />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    rerender(<TranscribeActionBar onClick={() => {}} disabled={false} label="Transcribe" onDiscard={onDiscard} discardLabel="Discard" />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('uses the amber colour for the pending variant', () => {
    render(<TranscribeActionBar onClick={() => {}} disabled={false} label="Waiting" variant="pending" />)
    expect(screen.getByRole('button', { name: 'Waiting' })).toHaveClass('bg-amber-600')
  })
})
