import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { ChapterCard } from './ChapterCard'
import { ProtocolCard } from '../ProtocolView/ProtocolCard'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

const chapter = { title: 'T', summary: 'S', start_time: 0, end_time: 0 }

describe('remove buttons', () => {
  it('translates the chapter button in German', async () => {
    await i18n.changeLanguage('de')
    render(<ChapterCard chapter={chapter} index={0} onDelete={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Kapitel entfernen' })
    expect(btn).toHaveAttribute('title', 'Kapitel entfernen')
    expect(btn.className).toContain('focus-visible:opacity-100')
  })

  it('translates the protocol item button in German', async () => {
    await i18n.changeLanguage('de')
    render(<ProtocolCard timestamp={null} label="L" description="" onDelete={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Eintrag entfernen' })
    expect(btn).toHaveAttribute('title', 'Eintrag entfernen')
    expect(btn.className).toContain('focus-visible:opacity-100')
  })

  it('keeps the English text', () => {
    render(<ChapterCard chapter={chapter} index={0} onDelete={() => {}} />)
    expect(screen.getByRole('button', { name: 'Remove chapter' })).toBeInTheDocument()
  })
})
