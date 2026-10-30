import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { SubmittedSummaryCard } from './SubmittedSummaryCard'

const base = {
  filename: 'a.mp3',
  fileSize: 1024,
  model: 'large-v3',
  language: null,
  detectSpeakers: true,
  bundleName: undefined,
}

function renderCard(count: number) {
  render(<SubmittedSummaryCard summary={{ ...base, minSpeakers: count, maxSpeakers: count }} />)
}

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('SubmittedSummaryCard speaker count', () => {
  it.each([
    ['en', 1, '1 speaker'],
    ['en', 3, '3 speakers'],
    ['de', 1, '1 Person'],
    ['de', 3, '3 Personen'],
  ])('%s with %i', async (lang, count, expected) => {
    await i18n.changeLanguage(lang)
    renderCard(count)
    const text = screen.getByText(new RegExp(expected))
    expect(text.textContent).toMatch(new RegExp(`${expected}(?!\\w)`))
  })
})
