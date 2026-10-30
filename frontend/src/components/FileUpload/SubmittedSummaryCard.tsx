import { useTranslation } from 'react-i18next'
import { formatFileSize } from '../../utils/format'

export interface SubmittedSummary {
  filename: string
  fileSize: number
  model: string
  language: string | null
  detectSpeakers: boolean
  minSpeakers: number
  maxSpeakers: number
  bundleName?: string
}

interface SubmittedSummaryCardProps {
  summary: SubmittedSummary
}

export function SubmittedSummaryCard({ summary }: SubmittedSummaryCardProps) {
  const { t } = useTranslation()

  const languageLabel = summary.language
    ? t(`languages.${summary.language}`, summary.language)
    : t('transcription.summary.noLanguage')

  let speakersLabel: string
  if (!summary.detectSpeakers) {
    speakersLabel = t('transcription.summary.speakersOff')
  } else if (summary.minSpeakers === summary.maxSpeakers) {
    speakersLabel = t('transcription.summary.speakers', { count: summary.minSpeakers })
  } else {
    speakersLabel = t('transcription.summary.speakersRange', {
      min: summary.minSpeakers,
      max: summary.maxSpeakers,
    })
  }

  const line = t('transcription.summary.line', {
    size: formatFileSize(summary.fileSize),
    model: summary.model,
    language: languageLabel,
    speakers: speakersLabel,
  })

  return (
    <div className="mx-6 my-3 px-4 py-2.5 bg-gray-800/60 border border-gray-700 rounded-lg flex items-center gap-2 text-sm min-w-0">
      <span className="font-medium text-gray-100 truncate min-w-0">{summary.filename}</span>
      <span className="text-gray-500 shrink-0">·</span>
      <span className="text-gray-400 truncate min-w-0">{line}</span>
      {summary.bundleName && (
        <>
          <span className="text-gray-500 shrink-0">·</span>
          <span className="text-gray-400 italic shrink-0">
            {t('transcription.summary.viaBundle', { name: summary.bundleName })}
          </span>
        </>
      )}
    </div>
  )
}
