import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../i18n'
import { DetectedLanguage } from './DetectedLanguage'

describe('DetectedLanguage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('names the detected language when the language was set to Auto-detect', () => {
    render(<DetectedLanguage requested={null} detected="yo" />)

    expect(screen.getByText('Erkannte Sprache: Yoruba')).toBeInTheDocument()
  })

  it('shows nothing when the language was chosen', () => {
    const { container } = render(<DetectedLanguage requested="de" detected="de" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when no language was recorded', () => {
    const { container } = render(<DetectedLanguage requested={null} detected={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing before the transcription is loaded', () => {
    const { container } = render(<DetectedLanguage requested={undefined} detected={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })
})
