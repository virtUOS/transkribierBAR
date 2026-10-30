import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { HelpDrawer } from './HelpDrawer'
import { resolveAssetUrl, settingValues } from './helpSections'
import type { ConfigResponse } from '../../api/types'

function buildConfig(overrides: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    asr_backend: 'whisperx',
    whisper_models: ['large-v3'],
    default_model: 'large-v3',
    llm_available: true,
    logout_url: '',
    popular_languages: [],
    enabled_languages: [],
    ...overrides,
  }
}

const initialState = useStore.getState()

beforeEach(async () => {
  useStore.setState(initialState, true)
  await i18n.changeLanguage('de')
})

function openHelp(config: ConfigResponse | null, section: string | null = null) {
  useStore.setState({ config, helpOpen: true, helpInitialSection: section })
  render(<HelpDrawer />)
}

describe('HelpDrawer', () => {
  it('shows no raw placeholders and no analysis entry without config', () => {
    openHelp(null, 'about')
    expect(document.body.textContent).not.toContain('{{')
    expect(screen.queryByRole('button', { name: 'Analyse' })).not.toBeInTheDocument()
  })

  it('hides the analysis entry when the LLM is unavailable', () => {
    openHelp(buildConfig({ llm_available: false }))
    expect(screen.queryByRole('button', { name: 'Analyse' })).not.toBeInTheDocument()
  })

  it('shows the analysis entry when the LLM is available', () => {
    openHelp(buildConfig({ llm_available: true }))
    expect(screen.getByRole('button', { name: 'Analyse' })).toBeInTheDocument()
  })

  it('falls back to getting-started for a gated initial section', () => {
    openHelp(buildConfig({ llm_available: false }), 'analysis')
    expect(screen.getByRole('button', { name: 'Einführung' })).toHaveClass('bg-gray-800')
  })

  it('fills the contact email into the about section', () => {
    openHelp(buildConfig({ contact_email: 'help@example.org' }), 'about')
    const sentence = screen.getByText(/Bei Fragen oder Problemen schreiben Sie an/)
    expect(sentence).toHaveTextContent('help@example.org')
    expect(sentence.querySelector('a[href="mailto:help@example.org"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('{{')
  })

  it('opens every email link in a new tab so the page is not left', () => {
    openHelp(buildConfig({ contact_email: 'help@example.org' }), 'about')
    const links = Array.from(document.querySelectorAll('a[href="mailto:help@example.org"]'))
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('links the university legal pages', () => {
    openHelp(buildConfig())
    const expected = {
      'Datenschutzerklärung der Universität': 'https://www.uni-osnabrueck.de/datenschutzerklaerung',
      Impressum: 'https://www.uni-osnabrueck.de/impressum',
      Barrierefreiheit: 'https://www.uni-osnabrueck.de/barrierefreiheit',
    }
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })
})

describe('HelpDrawer public links', () => {
  it('links each section to the public guide in German', () => {
    openHelp(buildConfig(), 'upload')
    const link = screen.getByRole('link', { name: /Im Handbuch öffnen/ })
    expect(link).toHaveAttribute('href', '/handbuch/#upload')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('links each section to the public guide in English', async () => {
    await i18n.changeLanguage('en')
    openHelp(buildConfig(), 'upload')
    const link = screen.getByRole('link', { name: /Open in the user guide/ })
    expect(link).toHaveAttribute('href', '/handbuch/en/#upload')
  })

  it.each([undefined, false])('hides the privacy notice link when privacy_notice is %s', (value) => {
    openHelp(buildConfig({ privacy_notice: value }), 'upload')
    expect(screen.queryByRole('link', { name: 'Datenschutzhinweise' })).toBeNull()
  })

  it('shows the German privacy notice link when enabled', () => {
    openHelp(buildConfig({ privacy_notice: true }), 'upload')
    const link = screen.getByRole('link', { name: 'Datenschutzhinweise' })
    expect(link).toHaveAttribute('href', '/handbuch/datenschutz/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens the guide link in the about section in a new tab', () => {
    openHelp(buildConfig(), 'about')
    const link = screen.getByRole('link', { name: 'Datenschutzhinweisen' })
    expect(link).toHaveAttribute('href', '/handbuch/datenschutz/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows the English privacy notice link when enabled', async () => {
    await i18n.changeLanguage('en')
    openHelp(buildConfig({ privacy_notice: true }), 'upload')
    const link = screen.getByRole('link', { name: 'Privacy notice' })
    expect(link).toHaveAttribute('href', '/handbuch/en/privacy/')
  })
})

describe('HelpDrawer screenshots', () => {
  it('keeps the drawer open on Escape while a lightbox is open, closes it otherwise', () => {
    openHelp(buildConfig(), 'archive')
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    expect(dialog).not.toBeNull()
    dialog.setAttribute('open', '')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useStore.getState().helpOpen).toBe(true)
    dialog.removeAttribute('open')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useStore.getState().helpOpen).toBe(false)
  })

  it('renders screenshots outside paragraphs', () => {
    openHelp(buildConfig(), 'archive')
    expect(document.querySelector('p figure, p dialog, p button')).toBeNull()
    expect(document.querySelector('figure')).not.toBeNull()
  })
})

describe('HelpDrawer diagrams', () => {
  it.each([
    ['de', 'Hochladen', 'Upload'],
    ['en', 'Upload', 'Hochladen'],
  ])('shows the %s diagram', async (lang, label, other) => {
    await i18n.changeLanguage(lang)
    openHelp(buildConfig(), 'getting-started')
    // Vite inlines small SVGs as data URIs, so check the decoded labels.
    const svgs = [...document.querySelectorAll('img')]
      .map((i) => i.getAttribute('src') ?? '')
      .filter((src) => src.startsWith('data:image/svg+xml;base64,'))
      .map((src) => decodeURIComponent(escape(atob(src.split(',')[1]))))
    expect(svgs.length).toBeGreaterThan(0)
    expect(svgs[0]).toContain(`>${label}<`)
    expect(svgs[0]).not.toContain(`>${other}<`)
  })

  it('fails loudly for a diagram without a version in the language', () => {
    expect(() => resolveAssetUrl('./assets/nope.svg', 'de')).toThrow(/nope\.svg.*de/)
  })
})

describe('settingValues', () => {
  it('converts expiry hours to days', () => {
    const values = settingValues(
      buildConfig({ default_expiry_hours: 72, archive_expiry_hours: 4320 }),
      'de',
    )
    expect(values.retention_days).toBe('3')
    expect(values.archive_retention_days).toBe('180')
  })

  it('formats fractional days per language', () => {
    expect(settingValues(buildConfig({ default_expiry_hours: 36 }), 'de').retention_days).toBe('1,5')
    expect(settingValues(buildConfig({ default_expiry_hours: 36 }), 'en').retention_days).toBe('1.5')
  })

  it('passes the default model and token expiry through', () => {
    const values = settingValues(
      buildConfig({ default_model: 'large-v3', api_token_default_expiry_days: 90 }),
      'en',
    )
    expect(values.default_model).toBe('large-v3')
    expect(values.api_token_expiry_days).toBe('90')
  })

  it('returns an empty object without config', () => {
    expect(settingValues(null, 'de')).toEqual({})
  })

  it('hides the tab switch when the assistant is disabled', () => {
    openHelp(buildConfig({ support_assistant_enabled: false }))
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('shows the tabs and switches to the assistant', () => {
    openHelp(buildConfig({ support_assistant_enabled: true }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Einführung' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Assistent' }))
    expect(screen.getByText('Fragen Sie mich, wie etwas in transkribierBAR funktioniert.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Einführung' })).not.toBeInTheDocument()
  })

  it('renders the manual when the assistant becomes disabled', () => {
    useStore.setState({ helpTab: 'assistant' })
    openHelp(buildConfig({ support_assistant_enabled: false }))
    expect(screen.getByRole('button', { name: 'Einführung' })).toBeInTheDocument()
  })
})
