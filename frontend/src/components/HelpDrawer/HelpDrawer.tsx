import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { HelpSidebar } from './HelpSidebar'
import { HelpContent } from './HelpContent'
import { AssistantChat } from './AssistantChat'
import { visibleSections, viewToSection } from './helpSections'
import type { HelpSectionId } from './helpSections'

const LEGAL_LINKS = [
  { key: 'privacyUniversity', href: 'https://www.uni-osnabrueck.de/datenschutzerklaerung' },
  { key: 'imprint', href: 'https://www.uni-osnabrueck.de/impressum' },
  { key: 'accessibility', href: 'https://www.uni-osnabrueck.de/barrierefreiheit' },
] as const

export function HelpDrawer() {
  const { t, i18n } = useTranslation()
  const open = useStore((s) => s.helpOpen)
  const initialSection = useStore((s) => s.helpInitialSection)
  const closeHelp = useStore((s) => s.closeHelp)
  const currentView = useStore((s) => s.currentView)
  const config = useStore((s) => s.config)
  const privacyHref = `${import.meta.env.BASE_URL}handbuch/${i18n.language === 'de' ? 'datenschutz/' : 'en/privacy/'}`
  const contactEmail = config?.contact_email
  const helpTab = useStore((s) => s.helpTab)
  const setHelpTab = useStore((s) => s.setHelpTab)
  const assistantEnabled = !!config?.support_assistant_enabled
  const showAssistant = assistantEnabled && helpTab === 'assistant'
  const visible = useMemo(() => visibleSections(config), [config])

  // Compute the section to land on when opening.
  // Because the component unmounts when !open, useState(derivedSection) will
  // always receive the correct value on the next mount.
  const derivedSection = useMemo<HelpSectionId>(() => {
    if (initialSection && visible.some((s) => s.id === initialSection)) {
      return initialSection as HelpSectionId
    }
    const fromView = viewToSection[currentView]
    return fromView && visible.some((s) => s.id === fromView) ? fromView : 'getting-started'
  }, [initialSection, currentView, visible])

  const [activeId, setActiveId] = useState<HelpSectionId>(derivedSection)
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Focus management: trap focus inside the drawer and restore on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      // Defer focus to next frame so the drawer is mounted.
      requestAnimationFrame(() => {
        closeButtonRef.current?.focus()
      })
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [open])

  // Keyboard handling: Escape closes, Tab stays trapped inside the drawer.
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // An open screenshot lightbox consumes Escape itself; keep the drawer open.
        if (drawerRef.current?.querySelector('dialog[open]')) return
        e.stopPropagation()
        closeHelp()
        return
      }
      if (e.key !== 'Tab' || !drawerRef.current) return
      const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, closeHelp])

  const handleTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = helpTab === 'manual' ? 'assistant' : 'manual'
    setHelpTab(next)
    document.getElementById(`help-tab-${next}`)?.focus()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-drawer-title"
    >
      <button
        type="button"
        aria-label={t('help.close')}
        onClick={closeHelp}
        className="absolute inset-0 bg-black/50 cursor-default"
        tabIndex={-1}
      />
      <div
        ref={drawerRef}
        className="relative flex flex-col bg-gray-900 border-l border-gray-700 w-full md:w-[50vw] md:min-w-[640px] max-w-[900px] shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700">
          <h2 id="help-drawer-title" className="text-lg font-semibold text-white">
            {t('help.title')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeHelp}
            aria-label={t('help.close')}
            className="text-gray-400 hover:text-white text-xl leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
          >
            ✕
          </button>
        </div>
        {assistantEnabled && (
          <div role="tablist" aria-label={t('help.title')} className="flex gap-1 px-6 pt-2 border-b border-gray-700">
            {(['manual', 'assistant'] as const).map((tab) => {
              const selected = (tab === 'assistant') === showAssistant
              return (
                <button
                  key={tab}
                  id={`help-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setHelpTab(tab)}
                  onKeyDown={handleTabKey}
                  className={`px-4 py-2 text-sm rounded-t border-b-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
                    selected ? 'border-blue-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {t(tab === 'manual' ? 'help.assistant.tabManual' : 'help.assistant.tabAssistant')}
                </button>
              )
            })}
          </div>
        )}
        {showAssistant ? (
          <AssistantChat />
        ) : (
          <>
        <div className="md:hidden px-4 py-2 border-b border-gray-700">
          <select
            value={activeId}
            onChange={(e) => setActiveId(e.target.value as HelpSectionId)}
            aria-label={t('help.title')}
            className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2"
          >
            {visible.map((section) => (
              <option key={section.id} value={section.id}>
                {t(`help.sections.${section.id}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 min-h-0">
          <HelpSidebar activeId={activeId} onSelect={setActiveId} />
          <HelpContent sectionId={activeId} />
        </div>
          </>
        )}
        <div className="px-6 py-3 border-t border-gray-700 text-sm text-gray-400 space-y-1">
          {contactEmail && (
            <div>
              {t('help.contact')}{' '}
              <a
                href={`mailto:${contactEmail}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
              >
                {contactEmail}
              </a>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {config?.privacy_notice && (
              <a
                href={privacyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
              >
                {t('help.legal.privacyNotice')}
              </a>
            )}
            {LEGAL_LINKS.map(({ key, href }) => (
              <a
                key={key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
              >
                {t(`help.legal.${key}`)}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default HelpDrawer
