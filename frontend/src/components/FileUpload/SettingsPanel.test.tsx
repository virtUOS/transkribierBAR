import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { SettingsPanel, type SettingsPanelValues } from './SettingsPanel'
import type { ConfigResponse, PromptBudget } from '../../api/types'

function buildValues(overrides: Partial<SettingsPanelValues> = {}): SettingsPanelValues {
  return {
    language: 'auto',
    model: 'large-v3-turbo',
    detectSpeakers: false,
    minSpeakers: 1,
    maxSpeakers: 2,
    initialPrompt: '',
    hotwords: '',
    selectedPresetId: null,
    showAdvanced: false,
    ...overrides,
  }
}

function buildConfig(whisper_models: string[]): ConfigResponse {
  return {
    asr_backend: 'whisperx',
    whisper_models,
    default_model: whisper_models[0] ?? '',
    llm_available: false,
    logout_url: '',
    popular_languages: [],
    enabled_languages: [],
  }
}

// Sets the store's model list and renders the panel with those models
// (plus any values that vary for a given test). Returns the onChange spy.
function renderPanel(
  models: string[], overrides: Partial<SettingsPanelValues> = {}, promptBudget: PromptBudget | null = null,
) {
  const onChange = vi.fn()
  useStore.setState({ config: buildConfig(models) })
  render(<SettingsPanel values={buildValues(overrides)} onChange={onChange} promptBudget={promptBudget} />)
  return onChange
}

const initialState = useStore.getState()

beforeEach(async () => {
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
})

describe('SettingsPanel — model field', () => {
  it('shows the bare model name with a "Model" label when exactly one model is configured', () => {
    renderPanel(['large-v3-turbo'])

    const field = screen.getByRole('status', { name: 'Model' })
    expect(field.textContent).toBe('large-v3-turbo')
    expect(screen.queryByRole('combobox', { name: 'Quality' })).not.toBeInTheDocument()
  })

  it('shows the "Modell" label in German, still with the bare model name', async () => {
    await i18n.changeLanguage('de')

    renderPanel(['large-v3-turbo'])

    const field = screen.getByRole('status', { name: 'Modell' })
    expect(field.textContent).toBe('large-v3-turbo')
  })

  it('shows a "Quality" combobox with labeled options when several models are configured', () => {
    renderPanel(['base', 'large-v3-turbo', 'large-v3'], { model: 'large-v3-turbo' })

    const combobox = screen.getByRole('combobox', { name: 'Quality' })
    const options = within(combobox).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Standard (base)', 'Balanced (large-v3-turbo)', 'Best quality (large-v3)'])
    expect(combobox).toHaveValue('large-v3-turbo')
  })

  it('calls onChange with the selected model when a different option is picked', () => {
    const onChange = renderPanel(['base', 'large-v3-turbo', 'large-v3'], { model: 'large-v3-turbo' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Quality' }), { target: { value: 'large-v3' } })

    expect(onChange).toHaveBeenCalledWith({ model: 'large-v3' })
  })
})

describe('SettingsPanel — prompt budget', () => {
  const tooLong = 'Initial prompt and hotwords together are too long (135% of the available space). Please shorten them.'

  it('shows the share used under the advanced options', () => {
    renderPanel(['large-v3-turbo'], { showAdvanced: true, initialPrompt: 'Sitzung' }, { tokens: 100, limit: 223 })

    expect(screen.getByText('Initial prompt and hotwords use 45% of the available space.')).toBeInTheDocument()
  })

  it('says they are too long even while the advanced options are closed', () => {
    renderPanel(['large-v3-turbo'], { initialPrompt: 'Sitzung' }, { tokens: 300, limit: 223 })

    expect(screen.getByText(tooLong)).toBeInTheDocument()
  })

  it('says nothing while closed and within the limit', () => {
    renderPanel(['large-v3-turbo'], { initialPrompt: 'Sitzung' }, { tokens: 100, limit: 223 })

    expect(screen.queryByText(/of the available space/)).not.toBeInTheDocument()
  })

  it('shows the percentage in German', async () => {
    await i18n.changeLanguage('de')
    renderPanel(['large-v3-turbo'], { showAdvanced: true, initialPrompt: 'Sitzung' }, { tokens: 100, limit: 223 })

    expect(screen.getByText('Anfangs-Prompt und Schlüsselwörter belegen 45 % des verfügbaren Platzes.')).toBeInTheDocument()
  })
})
