import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PromptBudget } from '../api/types'

const COUNT_DELAY_MS = 300

interface Count {
  initialPrompt: string
  hotwords: string
  budget: PromptBudget
}

export function isOverPromptBudget(budget: PromptBudget | null): boolean {
  return budget !== null && budget.tokens > budget.limit
}

/**
 * How much of Whisper's prompt space the initial prompt and hotwords take together, counted by
 * the backend once typing has paused. null while both are empty, while the current text is not
 * counted yet, and when counting fails; the backend checks again when the settings are submitted.
 */
export function usePromptBudget(
  initialPrompt: string | null | undefined,
  hotwords: string | null | undefined,
): PromptBudget | null {
  const [count, setCount] = useState<Count | null>(null)
  const prompt = initialPrompt ?? ''
  const words = hotwords ?? ''

  useEffect(() => {
    if (!prompt && !words) return
    let current = true
    const timer = setTimeout(() => {
      api.promptBudget({ initial_prompt: prompt || null, hotwords: words || null })
        .then((budget) => { if (current) setCount({ initialPrompt: prompt, hotwords: words, budget }) })
        .catch(() => { if (current) setCount(null) })
    }, COUNT_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [prompt, words])

  // A count belongs to the text it was made for, never to the text typed since
  if (!count || count.initialPrompt !== prompt || count.hotwords !== words) return null
  return count.budget
}
