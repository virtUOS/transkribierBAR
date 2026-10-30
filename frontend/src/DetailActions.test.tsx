import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore } from './store'
import { api } from './api/client'
import './i18n'
import { DetailActions } from './App'
import type { TranscriptionListItem } from './api/types'

vi.mock('./api/client', () => ({
  api: {
    archiveTranscription: vi.fn(),
    listTranscriptions: vi.fn(),
  },
}))

const item: TranscriptionListItem = {
  id: 't1',
  file_id: 'f1',
  original_filename: 't1.mp3',
  status: 'completed',
  language: 'en',
  model: 'm',
  created_at: '2026-01-01 00:00:00',
  file_size: 1,
  expires_at: '2026-04-01 00:00:00',
  archived: false,
  title: null,
  has_video: false,
}

describe('DetailActions optimistic archive expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.getState().reset()
    useStore.setState({ transcriptionId: 't1', transcriptionHistory: [item] })
    // Never resolves, so the optimistic value stays on screen.
    vi.mocked(api.archiveTranscription).mockReturnValue(new Promise(() => {}))
  })

  it('renders a valid date right after archiving', () => {
    render(<DetailActions />)
    fireEvent.click(screen.getByTitle(/archive/i))
    expect(screen.getByText(/Expires|Läuft|Gültig/i).textContent).not.toMatch(/Invalid/)
  })

  it('uses the configured archive period', () => {
    useStore.setState({ config: { archive_expiry_hours: 24 } as never })
    render(<DetailActions />)
    fireEvent.click(screen.getByTitle(/archive/i))
    const stored = useStore.getState().transcriptionHistory[0].expires_at
    const diff = new Date(stored).getTime() - Date.now()
    expect(Math.abs(diff - 24 * 3600 * 1000)).toBeLessThan(5000)
  })
})
