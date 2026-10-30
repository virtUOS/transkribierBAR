import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalDialog } from '../../hooks/useModalDialog'

interface Props {
  onClose: () => void
  onSubmit: (email: string) => Promise<void>
}

export function CreateInvitationModal({ onClose, onSubmit }: Props) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const titleId = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  useModalDialog(onClose, emailRef)

  async function handleSubmit() {
    const normalised = email.trim().toLowerCase()
    if (!normalised) return
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(normalised)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full space-y-4 mx-4"
      >
        <h2 id={titleId} className="text-lg font-semibold text-white">{t('invitations.create_title')}</h2>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('invitations.email_placeholder')}
            className="w-full bg-gray-800 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700"
            ref={emailRef}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-white px-3 py-1.5"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !email.trim()}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-1.5"
          >
            {submitting ? t('common.submitting') : t('invitations.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
