import { describe, expect, it } from 'vitest'
import { buildAssistantCorpus } from './assistantCorpus.ts'

describe('buildAssistantCorpus', () => {
  it('keeps section order and separates sections with a rule', () => {
    const out = buildAssistantCorpus([
      { id: 'a', markdown: '# First' },
      { id: 'b', markdown: '# Second' },
    ])
    expect(out).toContain('# First\n\n---\n\n# Second')
  })

  it('wraps gated sections in feature markers', () => {
    const out = buildAssistantCorpus([
      { id: 'a', markdown: '# Plain' },
      { id: 'b', markdown: '# Gated', feature: 'llm' },
    ])
    expect(out).toContain('<!--tw-feature:llm-->\n# Gated\n<!--/tw-feature:llm-->')
    expect(out.indexOf('<!--tw-feature:llm-->')).toBeGreaterThan(out.indexOf('# Plain'))
  })

  it('turns placeholders into sentinels', () => {
    const out = buildAssistantCorpus([{ id: 'a', markdown: 'Kept {{retention_days}} days' }])
    expect(out).toContain('__TW_SETTING_retention_days__')
    expect(out).not.toContain('{{')
  })

  it('drops image lines', () => {
    const out = buildAssistantCorpus([
      {
        id: 'a',
        markdown: 'Before\n\n![Upload screen](shots/upload.png)\n\n![Ablauf](./assets/main-flow.svg)\n\nAfter',
      },
    ])
    expect(out).not.toContain('![')
    expect(out).toContain('Before')
    expect(out).toContain('After')
  })

  it('wraps contact paragraphs in the contact feature, except inside gated sections', () => {
    const out = buildAssistantCorpus([
      { id: 'a', markdown: 'Intro\n\nSchreiben Sie an {{contact_email}}.\n\nOutro' },
      { id: 'b', markdown: 'Gated, mail {{contact_email}}', feature: 'llm' },
    ])
    expect(out).toContain(
      '<!--tw-feature:contact-->\nSchreiben Sie an __TW_SETTING_contact_email__.\n<!--/tw-feature:contact-->',
    )
    expect(out).not.toContain('<!--tw-feature:contact-->\nGated')
    expect(out.match(/tw-feature:contact/g)).toHaveLength(2)
    const gated = out.slice(out.indexOf('<!--tw-feature:llm-->'))
    expect(gated).not.toContain('tw-feature:contact')
  })
})
