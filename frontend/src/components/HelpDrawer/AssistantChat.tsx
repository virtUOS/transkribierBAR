import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { useStore } from '../../store'
import { HelpLink } from './HelpLink'

const STARTER_COUNT = 3
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

const answerComponents: Components = {
  a: HelpLink,
  p: ({ node: _node, ...props }) => {
    void _node
    return <p className="mb-2 last:mb-0 leading-relaxed" {...props} />
  },
  ul: ({ node: _node, ...props }) => {
    void _node
    return <ul className="list-disc list-inside mb-2 space-y-1" {...props} />
  },
  ol: ({ node: _node, ...props }) => {
    void _node
    return <ol className="list-decimal list-inside mb-2 space-y-1" {...props} />
  },
  code: ({ node: _node, ...props }) => {
    void _node
    return <code className="bg-gray-900 text-amber-300 px-1 py-0.5 rounded text-sm" {...props} />
  },
  pre: ({ node: _node, ...props }) => {
    void _node
    return <pre className="bg-gray-900 text-gray-200 p-3 rounded text-sm overflow-x-auto mb-2" {...props} />
  },
}

export function AssistantChat() {
  const { t } = useTranslation()
  const messages = useStore((s) => s.assistantMessages)
  const status = useStore((s) => s.assistantStatus)
  const error = useStore((s) => s.assistantError)
  const send = useStore((s) => s.sendAssistantMessage)
  const retry = useStore((s) => s.retryAssistant)
  const reset = useStore((s) => s.resetAssistant)
  const [draft, setDraft] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [prevStatus, setPrevStatus] = useState(status)
  const streaming = status === 'streaming'
  const last = messages[messages.length - 1]
  const waitingForFirstDelta = streaming && last?.role === 'assistant' && last.content === ''

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, error])

  // Announce once when a stream ends without an error (state adjusted during render).
  if (prevStatus !== status) {
    setPrevStatus(status)
    const finished = prevStatus === 'streaming' && !error && last?.role === 'assistant' && last.content !== ''
    setAnnouncement(finished ? t('help.assistant.answerReady') : '')
  }

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setDraft('')
    inputRef.current?.focus()
    void send(trimmed)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-end px-6 pt-3">
        <button
          type="button"
          onClick={reset}
          disabled={messages.length === 0 && !error}
          className={`text-sm text-blue-400 hover:text-blue-300 underline disabled:opacity-40 disabled:no-underline rounded ${FOCUS_RING}`}
        >
          {t('help.assistant.newConversation')}
        </button>
      </div>
      <div ref={listRef} aria-busy={streaming} className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
        {messages.length === 0 ? (
          <div>
            <p className="text-gray-300 mb-3">{t('help.assistant.greeting')}</p>
            <div className="flex flex-col items-start gap-2">
              {Array.from({ length: STARTER_COUNT }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => submit(t(`help.assistant.starters.${i}`))}
                  className={`text-left text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded px-3 py-2 ${FOCUS_RING}`}
                >
                  {t(`help.assistant.starters.${i}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words bg-blue-600 text-white rounded-lg px-3 py-2 text-sm">
                  {m.content}
                </p>
              </div>
            ) : m.content === '' ? null : (
              <div key={i} className="max-w-[90%] bg-gray-800 text-gray-300 rounded-lg px-3 py-2 text-sm break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerComponents}>
                  {m.content}
                </ReactMarkdown>
              </div>
            ),
          )
        )}
        {waitingForFirstDelta && <p className="text-sm text-gray-400 italic">{t('help.assistant.thinking')}</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-400">
            <span>{t(`help.assistant.errors.${error}`)}</span>
            <button
              type="button"
              onClick={() => void retry()}
              className={`text-blue-400 hover:text-blue-300 underline rounded ${FOCUS_RING}`}
            >
              {t('help.assistant.retry')}
            </button>
          </div>
        )}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <form
        className="px-6 py-3 border-t border-gray-700 space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit(draft)
              }
            }}
            maxLength={4000}
            rows={2}
            ref={inputRef}
            readOnly={streaming}
            aria-disabled={streaming}
            placeholder={t('help.assistant.placeholder')}
            aria-label={t('help.assistant.placeholder')}
            className={`flex-1 resize-none bg-gray-800 text-white text-sm rounded border border-gray-700 px-3 py-2 aria-disabled:opacity-50 ${FOCUS_RING}`}
          />
          <button
            type="submit"
            disabled={streaming || draft.trim() === ''}
            className={`bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-4 py-2 disabled:opacity-50 ${FOCUS_RING}`}
          >
            {t('help.assistant.send')}
          </button>
        </div>
        <div className="text-xs text-gray-400">
          <p>{t('help.assistant.noteModel')}</p>
          <p>{t('help.assistant.noteStorage')}</p>
        </div>
      </form>
    </div>
  )
}
