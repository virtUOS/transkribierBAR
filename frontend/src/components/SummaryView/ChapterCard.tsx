import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { formatTime } from '../../utils/format'
import type { SummaryChapter } from '../../api/types'

interface Props {
  chapter: SummaryChapter
  index: number
  onDelete?: () => void
}

export function ChapterCard({ chapter, index, onDelete }: Props) {
  const { t } = useTranslation()
  const setSeekTo = useStore((s) => s.setSeekTo)
  const hasTimestamp = chapter.start_time !== 0 || chapter.end_time !== 0

  return (
    <div data-help="chapter-card" className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-blue-500 transition-colors group">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-medium text-white">
          {index + 1}. {chapter.title}
        </h3>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {hasTimestamp ? (
            <button
              data-help="chapter-time"
              onClick={() => setSeekTo(chapter.start_time)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {formatTime(chapter.start_time)} — {formatTime(chapter.end_time)}
            </button>
          ) : (
            <span className="text-xs text-gray-500 italic">—</span>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              title={t('analysis.removeChapter')}
              aria-label={t('analysis.removeChapter')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-400">{chapter.summary}</p>
    </div>
  )
}
