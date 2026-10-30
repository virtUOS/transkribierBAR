/**
 * Builds the support assistant's manual corpus from the help markdown. Imported by
 * Node scripts, so: no Vite APIs, no non-erasable TypeScript syntax, explicit `.ts`
 * extensions on local imports.
 *
 * Contract with the backend: gated sections are wrapped in
 * `<!--tw-feature:X-->…<!--/tw-feature:X-->` and placeholders become
 * `__TW_SETTING_key__` sentinels.
 */
import { toSentinels } from '../helpText.ts'
import type { HelpFeature } from '../sectionList.ts'

export interface CorpusSection {
  id: string
  markdown: string
  feature?: HelpFeature
}

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/

function dropImages(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !IMAGE_LINE.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

const CONTACT_SENTINEL = '__TW_SETTING_contact_email__'

// Mirrors the guide: a paragraph showing the contact address is dropped when none is
// configured. Gated sections are skipped because feature markers must never nest.
function wrapContactParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block.includes(CONTACT_SENTINEL) ? `<!--tw-feature:contact-->\n${block}\n<!--/tw-feature:contact-->` : block,
    )
    .join('\n\n')
}

export function buildAssistantCorpus(sections: readonly CorpusSection[]): string {
  return sections
    .map((s) => {
      const text = dropImages(toSentinels(s.markdown)).trim()
      return s.feature
        ? `<!--tw-feature:${s.feature}-->\n${text}\n<!--/tw-feature:${s.feature}-->`
        : wrapContactParagraphs(text)
    })
    .join('\n\n---\n\n')
}
