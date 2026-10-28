import { useTranslation } from 'react-i18next'

interface DetectedLanguageProps {
  /** The language the transcription was requested in; null means Auto-detect. */
  requested: string | null | undefined
  /** The language the speech recognition reported for the result. */
  detected: string | null | undefined
}

// With Auto-detect, a wrong guess gives a transcript in the wrong language and
// no error; naming the guess makes it visible.
export function DetectedLanguage({ requested, detected }: DetectedLanguageProps) {
  const { t } = useTranslation()
  if (requested !== null || !detected) return null
  return (
    <p className="px-6 text-xs text-gray-500">
      {t('transcription.detectedLanguage', { language: t(`languages.${detected}`, detected) })}
    </p>
  )
}
