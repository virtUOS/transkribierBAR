import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { api } from '../../api/client'
import { transcriptionErrorMessage } from '../../utils/transcriptionError'

// The detail header shows transcriptionTitle and the archive the history entry.
// The user may have opened another transcription by the time the title comes.
function applyGeneratedTitle(id: string, title: string) {
  const { transcriptionHistory, setTranscriptionHistory, transcriptionId, setTranscriptionTitle } = useStore.getState()
  setTranscriptionHistory(transcriptionHistory.map((h) => (h.id === id ? { ...h, title } : h)))
  if (transcriptionId === id) setTranscriptionTitle(title)
}

interface TranscriptionProgressCardProps {
  pendingTranscription?: boolean
  submitError?: string | null
  onTryAgain?: () => void
  /** The language was set to Auto-detect; a failure the speech recognition reported then suggests choosing it. */
  autoLanguage?: boolean
}

export function TranscriptionProgressCard({
  pendingTranscription = false,
  submitError = null,
  onTryAgain,
  autoLanguage = false,
}: TranscriptionProgressCardProps) {
  const { t } = useTranslation()
  const transcriptionId = useStore((s) => s.transcriptionId)
  const status = useStore((s) => s.transcriptionStatus)
  const setStatus = useStore((s) => s.setTranscriptionStatus)
  const setResult = useStore((s) => s.setTranscriptionResult)
  const file = useStore((s) => s.file)
  const uploading = useStore((s) => s.uploading)
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneRef = useRef(false)
  // Kept as received and translated when rendered, so a language switch applies.
  const [failure, setFailure] = useState<{ code?: string | null; message?: string | null } | null>(null)

  useEffect(() => {
    if (!transcriptionId || status === 'completed' || status === 'failed') return

    doneRef.current = false
    retriesRef.current = 0

    const markDone = () => {
      doneRef.current = true
      wsRef.current?.close()
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    const handleCompleted = async () => {
      markDone()
      setStatus('completed')
      const result = await api.getTranscription(transcriptionId)
      setResult(result)
    }

    // The server asks the LLM for the title only after completion and sends it
    // on this socket, then closes it, also when no title comes. The socket is
    // handed off so it outlives this card, which unmounts once the editor opens.
    const awaitTitle = (ws: WebSocket) => {
      wsRef.current = null
      ws.onclose = null
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type !== 'title') return
        applyGeneratedTitle(transcriptionId, data.title)
        ws.close()
      }
    }

    const handleFailed = (code?: string | null, message?: string | null) => {
      markDone()
      setStatus('failed')
      setFailure({ code, message })
    }

    const connect = () => {
      if (doneRef.current) return
      const ws = api.connectWebSocket(transcriptionId)
      wsRef.current = ws

      ws.onmessage = (event) => {
        if (doneRef.current) return
        const data = JSON.parse(event.data)
        if (data.type === 'status') {
          if (data.status === 'completed') {
            if (data.title) applyGeneratedTitle(transcriptionId, data.title)
            else awaitTitle(ws)
            handleCompleted()
          } else if (data.status === 'failed') {
            handleFailed(data.error_code, data.error)
          } else {
            setStatus(data.status)
          }
        }
      }

      ws.onclose = () => {
        if (doneRef.current) return
        if (retriesRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 30000)
          retriesRef.current++
          setTimeout(connect, delay)
        } else {
          pollRef.current = setInterval(async () => {
            if (doneRef.current) return
            try {
              const s = await api.getStatus(transcriptionId)
              if (s.status === 'completed') {
                handleCompleted()
              } else if (s.status === 'failed') {
                handleFailed(s.error_code, s.error)
              }
            } catch { /* ignore */ }
          }, 10000)
        }
      }
    }

    connect()
    return () => {
      doneRef.current = true
      // The close event comes after the next run has reset doneRef, so the
      // socket must not reconnect from it.
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null
        ws.onmessage = null
        ws.close()
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [transcriptionId, status, setStatus, setResult])

  // Variant: pending upload (clicked Transcribe before upload finished)
  if (pendingTranscription && uploading && !file) {
    return (
      <div className="mx-6 my-4 p-5 bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          <span className="text-gray-200">{t('transcription.progress.pendingUpload')}</span>
        </div>
      </div>
    )
  }

  // Variant: upload failed while pending
  if (pendingTranscription && !uploading && !file) {
    return (
      <div className="mx-6 my-4 p-5 bg-red-900/30 rounded-lg border border-red-700">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-red-400 text-lg" aria-hidden="true">!</span>
            <span className="text-red-200">{t('transcription.progress.uploadFailed')}</span>
          </div>
          {onTryAgain && (
            <button
              onClick={onTryAgain}
              className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-sm"
            >
              {t('transcription.progress.editSettings')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // Variant: startTranscription rejected (no transcriptionId yet)
  if (submitError) {
    return (
      <div className="mx-6 my-4 p-5 bg-red-900/30 rounded-lg border border-red-700">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-red-400 text-lg" aria-hidden="true">!</span>
            <div className="min-w-0">
              <p className="text-red-200">{t('transcription.failed')}</p>
              <p className="text-red-400/80 text-xs mt-1 break-words">{submitError}</p>
            </div>
          </div>
          {onTryAgain && (
            <button
              onClick={onTryAgain}
              className="shrink-0 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-sm"
            >
              {t('transcription.progress.tryAgain')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!transcriptionId || status === 'completed') return null

  if (status === 'failed') {
    const errorMessage = failure && transcriptionErrorMessage(failure.code, failure.message, t)
    return (
      <div className="mx-6 my-4 p-5 bg-red-900/30 rounded-lg border border-red-700">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-red-400 text-lg" aria-hidden="true">!</span>
            <div className="min-w-0">
              <p className="text-red-200">{t('transcription.failed')}</p>
              {errorMessage && (
                <p className="text-red-400/80 text-xs mt-1 break-words">
                  {t('transcription.failedDetail', { message: errorMessage })}
                </p>
              )}
              {autoLanguage && failure?.code === 'asr_failed' && (
                <p className="text-red-400/80 text-xs mt-1">{t('transcription.autoLanguageHint')}</p>
              )}
            </div>
          </div>
          {onTryAgain && (
            <button
              onClick={onTryAgain}
              className="shrink-0 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-sm"
            >
              {t('transcription.progress.tryAgain')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // In-progress (queued / processing)
  const label =
    status === 'pending'
      ? t('transcription.progress.queued')
      : t('transcription.progress.processing')

  return (
    <div className="mx-6 my-4 p-5 bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex items-center gap-3">
        <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="text-gray-200">{label}</span>
      </div>
      <p className="text-gray-500 text-xs mt-2">
        {t('transcription.progress.youCanLeave')}
      </p>
    </div>
  )
}
