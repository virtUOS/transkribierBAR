import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { ApiToken } from '../../api/types'
import { useStore } from '../../store'
import { formatDateTime } from '../../utils/format'
import { tokensNeedingAttention } from '../../utils/tokenExpiry'
import { tokenErrorMessage } from '../../utils/tokenError'
import { CreateTokenModal } from './CreateTokenModal'

type TokenStatus = 'active' | 'expired' | 'revoked'

function getTokenStatus(token: ApiToken): TokenStatus {
  if (token.revoked_at) return 'revoked'
  if (token.expires_at) {
    const expiry = new Date(token.expires_at.replace(' ', 'T') + 'Z')
    if (expiry < new Date()) return 'expired'
  }
  return 'active'
}

export function ApiTokensSection() {
  const { t, i18n } = useTranslation()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  // The raw error, translated at render time so it follows a language switch.
  const [error, setError] = useState<{ e: unknown; action: 'list' | 'revoke' } | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const attention = tokensNeedingAttention(tokens)

  // The list, and the account menu's reminder of tokens about to expire
  const showTokens = useCallback((result: ApiToken[]) => {
    setTokens(result)
    useStore.getState().setTokenAttention(tokensNeedingAttention(result).length > 0)
  }, [])

  const fetchTokens = useCallback(async () => {
    setError(null)
    try {
      showTokens(await api.listApiTokens())
    } catch (e) {
      setError({ e, action: 'list' })
    }
  }, [showTokens])

  // The first load sets state only once the list has arrived
  useEffect(() => {
    let current = true
    api.listApiTokens().then(
      (result) => { if (current) showTokens(result) },
      (e) => { if (current) setError({ e, action: 'list' }) },
    )
    return () => { current = false }
  }, [showTokens])

  async function handleRevoke(id: string) {
    setRevoking(id)
    setError(null)
    try {
      await api.revokeApiToken(id)
      await fetchTokens()
    } catch (e) {
      setError({ e, action: 'revoke' })
    } finally {
      setRevoking(null)
    }
  }

  function handleCreated() {
    setShowModal(false)
    fetchTokens()
  }

  return (
    <div data-help="tokens" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{t('settings.apiTokens.title')}</h2>
        <button
          type="button"
          data-help="token-create"
          onClick={() => setShowModal(true)}
          className="text-sm bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-1.5"
        >
          {t('settings.apiTokens.createButton')}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">{tokenErrorMessage(error.e, t, error.action)}</p>
      )}

      {attention.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-600 bg-amber-950/40 p-3 text-sm text-amber-200 space-y-1">
          {attention.map((token) => (
            <p key={token.id}>
              {t(token.expiry_warning === 'expired' ? 'settings.apiTokens.expiredTmpl' : 'settings.apiTokens.expiringSoonTmpl', {
                name: token.name,
                date: formatDateTime(token.expires_at ?? '', i18n.language),
              })}
            </p>
          ))}
          <p>{t('settings.apiTokens.expiryNote')}</p>
        </div>
      )}

      {tokens.length === 0 && !error && (
        <p className="text-sm text-gray-500">{t('settings.apiTokens.empty')}</p>
      )}

      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((token) => {
            const status = getTokenStatus(token)
            const isInactive = status !== 'active'
            const statusKey = status === 'active' ? 'statusActive' : status === 'expired' ? 'statusExpired' : 'statusRevoked'
            return (
              <div
                key={token.id}
                className={`bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-start justify-between gap-3 ${isInactive ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-white truncate">{token.name}</p>
                  <p data-help="token-prefix" className="text-xs text-gray-400 font-mono">{token.prefix}{t('settings.apiTokens.prefixSuffix')}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                    <span className={
                      status === 'active' ? 'text-green-400' :
                      status === 'expired' ? 'text-yellow-500' :
                      'text-red-400'
                    }>
                      {t(`settings.apiTokens.${statusKey}`)}
                    </span>
                    {token.expires_at && (
                      <span>{t('settings.apiTokens.expiresOnTmpl', { date: formatDateTime(token.expires_at, i18n.language) })}</span>
                    )}
                    {token.last_used_at && (
                      <span>{t('settings.apiTokens.lastUsedTmpl', { date: formatDateTime(token.last_used_at, i18n.language) })}</span>
                    )}
                  </div>
                </div>
                {/* Expired ones too: revoking clears their notice. */}
                {status !== 'revoked' && (
                  <button
                    type="button"
                    data-help="token-revoke"
                    onClick={() => handleRevoke(token.id)}
                    disabled={revoking === token.id}
                    className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 shrink-0"
                  >
                    {revoking === token.id ? t('settings.apiTokens.revoking') : t('settings.apiTokens.revoke')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <CreateTokenModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
