import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PromptBudget } from '../api/types'

const COUNT_DELAY_MS = 300

export function isOverPromptBudget(budget: PromptBudget | null): boolean {
  return budget !== null && budget.tokens > budget.limit
}

/**
 * How much of Whisper's prompt space the initial prompt and hotwords take together, counted by
 * the backend once typing has paused. null while both are empty, before the first count, and
 * when counting fails; the backend checks again when the settings are submitted.
 */
export function usePromptBudget(
  initialPrompt: string | null | undefined,
  hotwords: string | null | undefined,
): PromptBudget | null {
  const [budget, setBudget] = useState<PromptBudget | null>(null)
  const empty = !initialPrompt && !hotwords

  useEffect(() => {
    if (empty) return
    let current = true
    const timer = setTimeout(() => {
      api.promptBudget({ initial_prompt: initialPrompt || null, hotwords: hotwords || null })
        .then((b) => { if (current) setBudget(b) })
        .catch(() => { if (current) setBudget(null) })
    }, COUNT_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [empty, initialPrompt, hotwords])

  return empty ? null : budget
}
