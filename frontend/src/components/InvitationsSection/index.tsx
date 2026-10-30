import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { Invitation } from '../../api/types'
import { CreateInvitationModal } from './CreateInvitationModal'

export function InvitationsSection() {
  const { t } = useTranslation()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const fetchInvitations = useCallback(async () => {
    setError(null)
    try {
      const result = await api.listInvitations()
      setInvitations(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // The first load sets state only once the list has arrived
  useEffect(() => {
    let current = true
    api.listInvitations()
      .then((result) => { if (current) setInvitations(result) })
      .catch((e) => { if (current) setError((e as Error).message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  async function handleCreate(email: string) {
    await api.createInvitation(email)
    await fetchInvitations()
  }

  async function handleRevoke(id: string) {
    if (!confirm(t('invitations.confirm_revoke'))) return
    setRevoking(id)
    setError(null)
    try {
      await api.revokeInvitation(id)
      await fetchInvitations()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{t('invitations.title')}</h2>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="text-sm bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-1.5"
        >
          {t('invitations.create_button')}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {loading && !error && (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      )}

      {!loading && invitations.length === 0 && !error && (
        <p className="text-sm text-gray-500">{t('invitations.empty')}</p>
      )}

      {invitations.length > 0 && (
        <div className="space-y-2">
          {invitations.map((invitation) => {
            const status = invitation.status
            const isInactive = status !== 'pending'
            const statusColor =
              status === 'pending' ? 'text-green-400' :
              status === 'accepted' ? 'text-blue-400' :
              status === 'expired' ? 'text-yellow-500' :
              'text-red-400'
            return (
              <div
                key={invitation.id}
                className={`bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-start justify-between gap-3 ${isInactive ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-white truncate">{invitation.email}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                    <span className={statusColor}>
                      {t(`invitations.status.${status}`)}
                    </span>
                    <span>{invitation.created_at}</span>
                  </div>
                </div>
                {status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(invitation.id)}
                    disabled={revoking === invitation.id}
                    className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 shrink-0"
                  >
                    {t('invitations.revoke')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <CreateInvitationModal
          onClose={() => setShowModal(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  )
}
