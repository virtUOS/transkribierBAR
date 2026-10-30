import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from 'playwright'
import type { Pad } from './marks.ts'

export interface ShotSpec {
  id: string
  /** Bring the page (already loaded at the app root, language set) into the state to capture. */
  prepare(page: Page, lang: 'de' | 'en'): Promise<void>
  /** CSS selector(s) of the element(s) whose (united) box is the screenshot clip. */
  clip: string | string[]
  /** Extra px around the clip ([top, right, bottom, left] or one value), so marker badges at the edge stay visible. */
  pad?: Pad
  /** CSS selectors of the numbered markers, in marker order; several selectors frame their elements together. */
  marks: (string | string[])[]
}

type Lang = 'de' | 'en'

/** The seeded demo content (backend/scripts/help_demo/fixture.json); each language opens its own interview. */
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../backend/scripts/help_demo/fixture.json'), 'utf8'),
) as Record<Lang, { title: string; refinement_context: string }>

/**
 * Usual space around a clip, so the numbered badges near its edge stay in the image.
 * Specs pad less on a side where neighbouring UI would otherwise show up cut in half.
 */
const PAD = 20

/** Path of a tiny generated audio file; the runner sets it before any spec runs. */
function audioFile(): string {
  const path = process.env.HELP_SHOTS_AUDIO
  if (!path) throw new Error('HELP_SHOTS_AUDIO is not set (the runner provides it)')
  return path
}

/**
 * Select a file in the upload dropzone and wait until the upload has landed:
 * the response arrived and the dropzone (which holds #file-upload) is replaced
 * by the compact file row. The settings panel and start button render earlier,
 * while the spinner dropzone is still tall, so waiting for them is not enough.
 */
export async function uploadFile(page: Page, path: string): Promise<void> {
  const uploaded = page.waitForResponse((r) => r.url().includes('/api/upload') && r.ok())
  await page.locator('#file-upload').setInputFiles(path)
  await uploaded
  await page.locator('#file-upload').waitFor({ state: 'detached' })
}

/**
 * Park the mouse in the empty header corner. Clicks leave the pointer where they
 * happened, and hover styles (or the player's time tooltip) would end up in the shot.
 */
async function rest(page: Page): Promise<void> {
  await page.mouse.move(1, 1)
}

/** Open the demo interview of this language from the overview and wait for the editor. */
async function openDemo(page: Page, lang: Lang): Promise<void> {
  await page.getByText(fixture[lang].title, { exact: true }).click()
  await page.locator('table tbody tr').first().waitFor()
}

/**
 * Wait until the player has its controls and has stopped loading. It preloads only
 * metadata and then idles, but how far it buffers varies from run to run, so the
 * buffer bar (a loading indicator, not a control) is hidden to keep the shot stable.
 */
async function waitForPlayer(page: Page): Promise<void> {
  await page.locator('[data-help="player"] .vjs-control-bar').waitFor()
  await page.addStyleTag({ content: '[data-help="player"] .vjs-load-progress { visibility: hidden; }' })
  const buffered = `(() => {
    const m = document.querySelector('[data-help="player"] video')
    return m && m.readyState >= 1 && m.networkState === 1 && m.buffered.length > 0
      ? m.buffered.end(m.buffered.length - 1) : -1
  })()`
  let last = -1
  for (let i = 0; i < 40; i++) {
    const now = Number(await page.evaluate(buffered))
    if (now >= 0 && now === last) return
    last = now
    await page.waitForTimeout(250)
  }
  throw new Error('the player did not finish loading')
}

/** Answer the first GET of an API path with 404, so the page shows the state before that result existed. */
async function hideOnce(page: Page, pattern: string): Promise<void> {
  await page.route(
    pattern,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not found"}' })
        : route.fallback(),
    { times: 1 },
  )
}

/** Open the transcription upload view with the generated audio file uploaded. */
async function openUpload(page: Page): Promise<void> {
  await page.locator('[data-help="new-upload"]').click()
  await uploadFile(page, audioFile())
  await page.locator('[data-help="transcribe-start"]').waitFor()
  await page.locator('#upload-model-field').waitFor()
}

export const shots: ShotSpec[] = [
  {
    id: 'archive',
    async prepare(page) {
      await page.locator('[data-help="archive-title"]').first().waitFor()
      await rest(page)
    },
    clip: '[data-help="archive"]',
    pad: [12, 20, 20, 20],
    marks: [
      [
        '[data-help="archive-title"] > span',
        '[data-help="archive-title"] > button',
        '[data-help="archive-filename"] > span',
        '[data-help="archive-filename"] > button',
      ],
      '[data-help="archive-meta"]',
    ],
  },
  {
    id: 'upload',
    async prepare(page) {
      await openUpload(page)
      await rest(page)
    },
    clip: ['[data-help="upload-file"]', '[data-help="transcribe-bar"]'],
    pad: [8, PAD, PAD, PAD],
    marks: ['[data-help="settings-panel"]', '[data-help="transcribe-start"]', '[data-help="transcribe-discard"]'],
  },
  {
    id: 'record',
    async prepare(page, lang) {
      // Headless Chromium has no microphone: present one generic device, the way a browser
      // with a single microphone does (the field then shows its name instead of a list).
      const label = lang === 'de' ? 'Integriertes Mikrofon' : 'Built-in Microphone'
      await page.evaluate(`(() => {
        const device = { deviceId: 'default', groupId: 'demo', kind: 'audioinput', label: ${JSON.stringify(label)} }
        navigator.mediaDevices.enumerateDevices = async () => [{ ...device, toJSON: () => device }]
      })()`)
      await page.locator('[data-help="new-recording"]').click()
      await page.locator('[data-help="record-mic-device"] output').waitFor()
      await rest(page)
    },
    clip: '[data-help="recorder"]',
    marks: [
      '[data-help="record-source-mic"]',
      '[data-help="record-mic-device"]',
      '[data-help="record-source-system"]',
      '[data-help="record-source-camera"]',
      '[data-help="record-start"]',
    ],
  },
  {
    id: 'settings',
    async prepare(page) {
      await openUpload(page)
      await page.locator('[data-help="upload-advanced-toggle"]').click()
      await page.locator('[data-help="upload-advanced"]').waitFor()
      await rest(page)
    },
    clip: '[data-help="settings-panel"]',
    marks: [
      '[data-help="upload-presets-group"]',
      '[data-help="upload-transcription-group"]',
      '[data-help="upload-speakers-group"]',
      '[data-help="upload-advanced"]',
    ],
  },
  {
    id: 'editor',
    async prepare(page, lang) {
      await openDemo(page, lang)
      await waitForPlayer(page)
      await rest(page)
    },
    clip: ['[data-help="detail-title"]', 'table tbody tr:nth-child(5)'],
    pad: [6, PAD, 0, PAD],
    marks: [
      '[data-help="player"]',
      '[data-help="editor-search"]',
      '[data-help="editor-views"]',
      'table tbody tr:nth-child(1)',
      'table tbody tr:nth-child(2) [data-help="row-speaker"]',
    ],
  },
  {
    id: 'speakers',
    async prepare(page, lang) {
      await openDemo(page, lang)
      await page.locator('[data-help="speaker-names"]').click()
      await page.locator('[data-help="speaker-panel"]').waitFor()
      await rest(page)
    },
    clip: ['[data-help="editor-search"]', 'table tbody tr:nth-child(1)'],
    pad: [6, PAD, 8, PAD],
    marks: [
      '[data-help="speaker-names"]',
      '[data-help="speaker-panel"] input',
      '[data-help="speaker-apply"]',
      'table tbody tr:nth-child(1) [data-help="row-speaker"]',
    ],
  },
  {
    id: 'analysis-form',
    async prepare(page, lang) {
      await openDemo(page, lang)
      await page.locator('[data-help="tab-analysis"]').click()
      await page.locator('[data-help="analysis-new"]').click()
      await page.locator('[data-help="analysis-prompt"] > button').click()
      await page.locator('[data-help="analysis-prompt"] textarea').waitFor()
      // The form is taller than the panel: scroll the page down, then the panel until
      // Generate sits a little above the panel's bottom edge, so templates to Generate are in view.
      await page.evaluate(`(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        const panel = document.querySelector('[data-help="detail-panel"]')
        const generate = document.querySelector('[data-help="analysis-generate"]')
        panel.scrollTop += generate.getBoundingClientRect().bottom - (panel.getBoundingClientRect().bottom - 24)
      })()`)
      await rest(page)
    },
    clip: ['[data-help="analysis-templates"]', '[data-help="analysis-generate"]'],
    pad: [12, PAD, PAD, PAD],
    marks: [
      '[data-help="analysis-templates"]',
      '[data-help="analysis-chapters"]',
      '[data-help="analysis-prompt"]',
      '[data-help="analysis-language"]',
      '[data-help="analysis-source"]',
      '[data-help="analysis-generate"]',
    ],
  },
  {
    id: 'analysis-result',
    async prepare(page, lang) {
      await openDemo(page, lang)
      await page.locator('[data-help="tab-analysis"]').click()
      await page.locator('[data-help="analysis-header"]').click()
      await page.locator('[data-help="chapter-time"]').first().waitFor()
      // The header's chevron rotates with a CSS transition; let it finish so its pixels do not vary.
      await page.evaluate('Promise.all(document.getAnimations().map((a) => a.finished))')
      await rest(page)
    },
    clip: ['[data-help="analysis-header"]', '[data-help="chapter-card"]:nth-child(2)'],
    pad: [PAD, PAD, 0, PAD],
    marks: [
      '[data-help="analysis-template"]',
      '[data-help="analysis-delete"]',
      ['[data-help="analysis-copy"]', '[data-help="analysis-download-md"]'],
      '[data-help="chapter-time"]',
    ],
  },
  {
    id: 'translate',
    async prepare(page, lang) {
      // The demo interview already has a translation; show the dialog as before the first one.
      await hideOnce(page, '**/api/translate/*')
      await openDemo(page, lang)
      await page.locator('[data-help="translate-open"]').click()
      await page.locator('[data-help="translate-dialog"]').waitFor()
      // A target other than the recording's own language.
      await page.locator('#translation-language-field').selectOption(lang === 'de' ? 'en' : 'de')
      await rest(page)
    },
    clip: '[data-help="translate-dialog"]',
    pad: PAD,
    marks: ['#translation-language-field', '[data-help="translate-source"] > div', '[data-help="translate-submit"]'],
  },
  {
    id: 'refine',
    async prepare(page, lang) {
      // The demo interview is already refined; show the dialog as before the first refinement.
      await hideOnce(page, '**/api/refine/*')
      await openDemo(page, lang)
      await page.locator('[data-help="refine-open"]').click()
      await page.locator('[data-help="refine-context"]').fill(fixture[lang].refinement_context)
      await rest(page)
    },
    clip: '[data-help="refine-dialog"]',
    pad: PAD,
    marks: [
      '[data-help="refine-preset"]',
      ['[data-help="refine-context-label"]', '[data-help="refine-context"]'],
      '[data-help="refine-submit"]',
    ],
  },
  {
    id: 'refined',
    async prepare(page, lang) {
      await openDemo(page, lang)
      await page.locator('[data-help="view-refined"]').click()
      await page.locator('[data-help="refined-summary"]').waitFor()
      // The Compare button of the first changed row opens the side-by-side comparison.
      await page.locator('tr:has([data-help="row-changed-dot"]) [data-help="row-compare"]').first().click()
      await page.locator('[data-help="row-diff"]').waitFor()
      await rest(page)
    },
    clip: ['[data-help="editor-versions"]', '[data-help="row-diff"]'],
    pad: [6, PAD, 8, PAD],
    marks: [
      '[data-help="editor-views"]',
      '[data-help="refined-summary"]',
      'tr:has([data-help="row-changed-dot"]) [data-help="row-compare"]',
    ],
  },
  {
    id: 'formats',
    async prepare(page, lang) {
      await openDemo(page, lang)
      await page.locator('[data-help="tab-srt"]').click()
      await page.locator('[data-help="format-preview"]').waitFor()
      await rest(page)
    },
    clip: ['[data-help="tab-srt"]', '[data-help="format-preview"] + div'],
    pad: [10, PAD, PAD, PAD],
    marks: ['[data-help="tab-srt"]', '[data-help="format-preview"]', '[data-help="format-download"]'],
  },
  {
    id: 'presets',
    async prepare(page) {
      await page.locator('[data-help="nav-presets"]').click()
      await page.locator('[data-help="preset-card"]').first().waitFor()
      await rest(page)
    },
    clip: '[data-help="presets-page"]',
    marks: [
      '[data-help="presets-tabs"]',
      ['[data-help="preset-edit"]', '[data-help="preset-delete"]'],
      '[data-help="preset-new"]',
    ],
  },
  {
    id: 'bundles',
    async prepare(page) {
      await page.locator('[data-help="nav-presets"]').click()
      await page.locator('[data-help="presets-tab-bundles"]').click()
      await page.locator('[data-help="bundle-new"]').click()
      await page.locator('[data-help="bundle-transcription"]').waitFor()
      await rest(page)
    },
    clip: ['[data-help="presets-tabs"]', '[data-help="preset-save"]'],
    pad: [14, PAD, PAD, PAD],
    marks: [
      'div:has(> [data-help="bundle-parts"])',
      ['[data-help="bundle-default"]', '[data-help="bundle-delete"]'],
      '[data-help="bundle-transcription"]',
      '[data-help="bundle-translate"]',
      '[data-help="preset-save"]',
    ],
  },
  {
    id: 'tokens',
    async prepare(page) {
      // The seeded token's prefix is random and its expiry uses the real seeding time;
      // pin both so the shot is the same on every run (expiry: the frozen clock + 90 days).
      const now = Number(await page.evaluate('Date.now()'))
      const expires = new Date(now + 90 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
      await page.route(
        '**/api/tokens',
        async (route) => {
          const response = await route.fetch()
          const tokens = (await response.json()) as { prefix: string; expires_at: string | null }[]
          const json = tokens.map((t) => ({ ...t, prefix: 'tw_3fZq8LkP2', expires_at: expires }))
          await route.fulfill({ response, json })
        },
      )
      await page.locator('[data-help="nav-settings"]').click()
      await page.locator('[data-help="token-prefix"]').waitFor()
      // Every fetch of the list was answered (StrictMode fetches twice); stop stubbing before the shot.
      await page.unrouteAll({ behavior: 'wait' })
      await rest(page)
    },
    clip: '[data-help="tokens"]',
    pad: PAD,
    marks: [
      '[data-help="token-create"]',
      'div:has(> [data-help="token-prefix"])',
      '[data-help="token-revoke"]',
    ],
  },
]
