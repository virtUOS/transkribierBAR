import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { formatTime } from '../../utils/format'

interface Props {
  timestamp: number | null
  label: string
  description: string
  onDelete?: () => void
}

export function ProtocolCard({ timestamp, label, description, onDelete }: Props) {
  const { t } = useTranslation()
  const setSeekTo = useStore((s) => s.setSeekTo)

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-blue-500 transition-colors group">
      <div className="flex items-start justify-between mb-1">
        <span className="text-sm font-medium text-white">{label}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {timestamp !== null && (
            <button
              onClick={() => setSeekTo(timestamp)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {formatTime(timestamp)}
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              title={t('analysis.removeItem')}
              aria-label={t('analysis.removeItem')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {description && <p className="text-xs text-gray-400">{description}</p>}
    </div>
  )
}
