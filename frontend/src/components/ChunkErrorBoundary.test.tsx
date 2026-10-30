import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChunkErrorBoundary } from './ChunkErrorBoundary'

function Boom(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

describe('ChunkErrorBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders its children when nothing fails', () => {
    render(
      <ChunkErrorBoundary errorMessage="broken" reloadLabel="Reload">
        <p>content</p>
      </ChunkErrorBoundary>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByText('broken')).not.toBeInTheDocument()
  })

  it('shows the message and reloads the page from the button when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    render(
      <ChunkErrorBoundary errorMessage="Could not load this part" reloadLabel="Reload">
        <Boom />
      </ChunkErrorBoundary>,
    )
    expect(screen.getByText('Could not load this part')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
