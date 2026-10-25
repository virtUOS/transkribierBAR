import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { SubmittedSummaryCard, type SubmittedSummary } from './SubmittedSummaryCard'

function summary(overrides: Partial<SubmittedSummary> = {}): SubmittedSummary {
  return {
    filename: 'interview.mp3',
    fileSize: 3 * 1024 * 1024,
    model: 'large-v3',
    language: null,
    detectSpeakers: false,
    minSpeakers: 1,
    maxSpeakers: 2,
    ...overrides,
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('SubmittedSummaryCard', () => {
  it('summarises size, model, auto language and disabled speaker detection', () => {
    render(<SubmittedSummaryCard summary={summary()} />)
    expect(screen.getByText('interview.mp3')).toBeInTheDocument()
    expect(screen.getByText('3.0 MB · large-v3 · auto · no speakers')).toBeInTheDocument()
    expect(screen.queryByText(/bundle/)).not.toBeInTheDocument()
  })

  it('names the language and a speaker range', () => {
    render(<SubmittedSummaryCard summary={summary({ language: 'de', detectSpeakers: true, minSpeakers: 2, maxSpeakers: 4 })} />)
    expect(screen.getByText('3.0 MB · large-v3 · German · 2–4 speakers')).toBeInTheDocument()
  })

  it('falls back to the language code when it has no translation', () => {
    render(<SubmittedSummaryCard summary={summary({ language: 'xx' })} />)
    expect(screen.getByText('3.0 MB · large-v3 · xx · no speakers')).toBeInTheDocument()
  })

  it('shows a single speaker count when min equals max', () => {
    render(<SubmittedSummaryCard summary={summary({ detectSpeakers: true, minSpeakers: 1, maxSpeakers: 1 })} />)
    expect(screen.getByText('3.0 MB · large-v3 · auto · 1 speaker')).toBeInTheDocument()
  })

  it.todo(
    'pluralises an exact speaker count above one (bug https://github.com/virtUOS/transkribierBAR/issues/249: min=max=3 renders "3 speaker" / "3 Person"; '
    + 'transcription.summary.speakersOne has no _other plural form — SubmittedSummaryCard.tsx:30, en.json/de.json:88)',
  )

  it('names the bundle the settings came from', () => {
    render(<SubmittedSummaryCard summary={summary({ bundleName: 'Lecture' })} />)
    expect(screen.getByText('via "Lecture" bundle')).toBeInTheDocument()
  })
})
