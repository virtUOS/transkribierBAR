import { useTranslation } from 'react-i18next'
import type { PromptBudget } from '../../api/types'

export function PromptBudgetNote({ budget }: { budget: PromptBudget | null }) {
  const { t } = useTranslation()
  if (!budget) return null
  // Rounded up, so a prompt just over the limit never reads as 100 %.
  const percent = Math.ceil((budget.tokens / budget.limit) * 100)
  if (budget.tokens > budget.limit) {
    return <p role="status" className="text-xs text-red-400">{t('settings.promptBudget.tooLong', { percent })}</p>
  }
  return <p className="text-xs text-gray-500">{t('settings.promptBudget.usage', { percent })}</p>
}
