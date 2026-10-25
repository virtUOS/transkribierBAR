import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../store'
import i18n from '../i18n'
import { TabBar } from './TabBar'

const initialState = useStore.getState()

beforeEach(async () => {
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
})

describe('TabBar', () => {
  function tabNames() {
    return screen.getAllByRole('button').map((b) => b.textContent)
  }

  it('shows the editor and export tabs, without analysis when no LLM is available', () => {
    render(<TabBar />)
    expect(tabNames()).toEqual([i18n.t('editor.subtitles'), 'SRT', 'VTT', 'JSON', 'TXT'])
  })

  it('adds the analysis tab after the editor when an LLM is available', () => {
    useStore.setState({ config: { llm_available: true } as never })
    render(<TabBar />)
    expect(tabNames()).toEqual([i18n.t('editor.subtitles'), i18n.t('editor.analysis'), 'SRT', 'VTT', 'JSON', 'TXT'])
  })

  it('switches the active tab and highlights it', () => {
    render(<TabBar />)
    expect(screen.getByRole('button', { name: i18n.t('editor.subtitles') })).toHaveClass('bg-blue-600')
    fireEvent.click(screen.getByRole('button', { name: 'VTT' }))
    expect(useStore.getState().activeTab).toBe('vtt')
    expect(screen.getByRole('button', { name: 'VTT' })).toHaveClass('bg-blue-600')
    expect(screen.getByRole('button', { name: i18n.t('editor.subtitles') })).not.toHaveClass('bg-blue-600')
  })
})
