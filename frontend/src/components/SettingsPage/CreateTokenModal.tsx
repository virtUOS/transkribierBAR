import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { ApiTokenCreated } from '../../api/types'
import { useStore } from '../../store'
import { tokenErrorMessage } from '../../utils/tokenError'
import { useModalDialog } from '../../hooks/useModalDialog'

interface Props {
  onClose: () => void
  onCreated: () => void
}

export function CreateTokenModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const defaultDays = useStore((s) => s.config?.api_token_default_expiry_days) ?? 90
  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState<number>(defaultDays)
  const [created, setCreated] = useState<ApiTokenCreated | null>(null)
  // The raw error, translated at render time so it follows a language switch.
  const [error, setError] = useState<{ e: unknown } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const titleId = useId()
  const nameId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  // Escape must not dismiss the dialog while the request runs or the secret,
  // which is shown only once, is on screen.
  useModalDialog(created || submitting ? undefined : onClose, nameRef)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  // The configured default is always one of the options, so the select shows
  // the value the token is created with.
  const expiryOptions = [...new Set([30, 90, 365, defaultDays])]
    .sort((a, b) => a - b)
    .map((days) => ({ label: t('settings.apiTokens.expiryDays', { count: days }), days }))

  async function handleCreate() {
    setError(null)
    setSubmitting(true)
    try {
      const result = await api.createApiToken(name.trim(), expiryDays)
      setCreated(result)
    } catch (e) {
      setError({ e })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!created) return
    await navigator.clipboard.writeText(created.token)
    setCopied(true)
  }

  function handleDone() {
    setCreated(null)
    onCreated()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full space-y-4 mx-4"
      >
        {created ? (
          <>
            <h2 id={titleId} className="text-lg font-semibold text-white">{t('settings.apiTokens.createdHeader')}</h2>
            <p className="text-sm text-yellow-400">
              {t('settings.apiTokens.saveNowWarning')}
            </p>
            <div className="bg-gray-800 rounded px-3 py-2 font-mono text-sm text-green-400 break-all select-all">
              {created.token}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleCopy}
                aria-live="polite"
                className={`text-sm rounded px-4 py-1.5 text-white transition-colors ${
                  copied ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {copied ? t('settings.apiTokens.copied') : t('settings.apiTokens.copy')}
              </button>
              <button
                type="button"
                onClick={handleDone}
                className="text-sm bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-1.5"
              >
                {t('settings.apiTokens.done')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId} className="text-lg font-semibold text-white">{t('settings.apiTokens.createButton')}</h2>

            {error && (
              <p role="alert" className="text-sm text-red-400">{tokenErrorMessage(error.e, t, 'create')}</p>
            )}

            <div>
              <label htmlFor={nameId} className="block text-xs text-gray-400 mb-1">{t('settings.apiTokens.nameLabel')}</label>
              <input
                id={nameId}
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                placeholder={t('settings.apiTokens.namePlaceholder')}
                className="w-full bg-gray-800 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700"
              />
            </div>

            <div>
              <label htmlFor="token-expiry-select" className="block text-xs text-gray-400 mb-1">{t('settings.apiTokens.expiresLabel')}</label>
              <select
                id="token-expiry-select"
                value={String(expiryDays)}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="w-full bg-gray-800 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700"
              >
                {expiryOptions.map((opt) => (
                  <option key={opt.label} value={String(opt.days)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5"
              >
                {t('settings.apiTokens.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !name.trim()}
                className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-1.5"
              >
                {submitting ? t('settings.apiTokens.creating') : t('settings.apiTokens.createCta')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
