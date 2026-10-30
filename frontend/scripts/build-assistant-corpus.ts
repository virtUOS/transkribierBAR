// Builds the support assistant's manual corpus into dist/assistant/<lang>.md.
// Runs after `vite build` (see the "build" script): node scripts/build-assistant-corpus.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sections } from '../src/help/sectionList.ts'
import { buildAssistantCorpus } from '../src/help/render/assistantCorpus.ts'

const frontendDir = resolve(import.meta.dirname, '..')
const helpDir = join(frontendDir, 'src/help')
const outDir = join(frontendDir, 'dist/assistant')

mkdirSync(outDir, { recursive: true })
for (const lang of ['de', 'en'] as const) {
  const input = sections.map((s) => ({
    id: s.id,
    markdown: readFileSync(join(helpDir, lang, s.filename), 'utf8'),
    feature: s.feature,
  }))
  writeFileSync(join(outDir, `${lang}.md`), buildAssistantCorpus(input))
}

console.log('[build-assistant-corpus] wrote dist/assistant/{de,en}.md')
