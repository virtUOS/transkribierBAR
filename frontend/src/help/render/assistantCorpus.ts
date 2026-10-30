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

export function buildAssistantCorpus(sections: readonly CorpusSection[]): string {
  return sections
    .map((s) => {
      const text = dropImages(toSentinels(s.markdown)).trim()
      return s.feature ? `<!--tw-feature:${s.feature}-->\n${text}\n<!--/tw-feature:${s.feature}-->` : text
    })
    .join('\n\n---\n\n')
}
