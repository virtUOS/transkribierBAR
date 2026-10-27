import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { useStore } from '../store'
import { allowNextUnload } from '../hooks/useBeforeUnloadWarning'
import { tokensNeedingAttention } from '../utils/tokenExpiry'
import { leaveMessages } from '../utils/leaveMessages'

export function Header() {
  const { t, i18n } = useTranslation()
  const config = useStore((s) => s.config)
  const tokenAttention = useStore((s) => s.tokenAttention)
  const tokensEnabled = !!config?.api_tokens_enabled
  const [burgerOpen, setBurgerOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // The logo sets "BAR" in the accent colour; keep the heading in step.
  const title = t('title')
  const titleAccent = title.endsWith('BAR') ? 'BAR' : ''
  const titleStem = title.slice(0, title.length - titleAccent.length)

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'de' ? 'en' : 'de')
  }

  const openHelp = () => {
    useStore.getState().setHelpOpen(true)
    setBurgerOpen(false)
  }

  const openPresets = () => {
    const state = useStore.getState()
    if (!state.confirmLeave(leaveMessages(t))) return
    state.setCurrentView('presets')
    setBurgerOpen(false)
  }

  const openSettings = () => {
    const state = useStore.getState()
    if (!state.confirmLeave(leaveMessages(t))) return
    state.setCurrentView('settings')
    setBurgerOpen(false)
  }

  const handleToggleLanguage = () => {
    toggleLanguage()
    setBurgerOpen(false)
  }

  const handleLogout = () => {
    if (!useStore.getState().confirmLeave(leaveMessages(t))) return
    if (config?.logout_url) {
      allowNextUnload()
      window.location.href = config.logout_url
    }
  }

  useEffect(() => {
    if (!tokensEnabled) return
    let cancelled = false
    api.listApiTokens().then(
      (tokens) => {
        if (!cancelled) useStore.getState().setTokenAttention(tokensNeedingAttention(tokens).length > 0)
      },
      () => {},
    )
    return () => { cancelled = true }
  }, [tokensEnabled])

  useEffect(() => {
    if (!burgerOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setBurgerOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBurgerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [burgerOpen])

  const buttonClass = 'text-sm text-gray-300 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500'
  const logoutButtonClass = 'text-sm text-red-400 hover:text-red-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500'

  const settingsLabel = (
    <>
      {t('nav.settings')}
      {tokenAttention && (
        <>
          <span aria-hidden="true" className="ml-1.5 inline-block h-2 w-2 rounded-full bg-orange-400" />
          <span className="sr-only">{t('nav.settingsAttention')}</span>
        </>
      )}
    </>
  )
  const settingsTitle = tokenAttention ? t('nav.settingsAttention') : undefined

  return (
    <header className="relative flex items-center justify-between gap-2 px-6 py-3 bg-gray-900 border-b border-gray-700">
      <div className="flex items-center gap-3 min-w-0">
        <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt={t('title')} className="h-9 w-auto shrink-0" />
        <h1 className="text-lg font-semibold text-white truncate">
          {titleStem}
          {titleAccent && <span className="text-orange-400">{titleAccent}</span>}
        </h1>
      </div>

      {/* Desktop: inline button row */}
      <div className="hidden md:flex items-center gap-4">
        <button
          type="button"
          onClick={openHelp}
          aria-label={t('help.open')}
          title={t('help.open')}
          className={buttonClass}
        >
          ?
        </button>
        <button data-help="nav-presets" onClick={openPresets} className={buttonClass}>
          {t('nav.presets')}
        </button>
        {config?.api_tokens_enabled && (
          <button data-help="nav-settings" onClick={openSettings} title={settingsTitle} className={buttonClass}>
            {settingsLabel}
          </button>
        )}
        <button
          onClick={handleToggleLanguage}
          className={buttonClass}
          title={i18n.language === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
          aria-label={i18n.language === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
        >
          {(i18n.language === 'de' ? 'en' : 'de').toUpperCase()}
        </button>
        {config?.logout_url && (
          <button onClick={handleLogout} className={logoutButtonClass}>
            {t('common.logout')}
          </button>
        )}
      </div>

      {/* Mobile: burger trigger + dropdown */}
      <div className="md:hidden" ref={containerRef}>
        {/* The Settings item is inside the closed menu, so this button carries the mark
            too. Named by its text, not aria-label, so screen readers hear the mark. */}
        <button
          type="button"
          onClick={() => setBurgerOpen((open) => !open)}
          title={settingsTitle}
          aria-expanded={burgerOpen}
          aria-haspopup="menu"
          aria-controls="header-mobile-menu"
          className={`${buttonClass} relative`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="sr-only">{t('nav.menu')}</span>
          {tokenAttention && (
            <>
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-orange-400" />
              <span className="sr-only">{t('nav.settingsAttention')}</span>
            </>
          )}
        </button>
        {burgerOpen && (
          <div
            id="header-mobile-menu"
            role="menu"
            className="absolute right-0 top-full mt-1 w-48 bg-gray-900 border border-gray-700 rounded-md shadow-lg z-40 flex flex-col py-2"
          >
            <button
              type="button"
              role="menuitem"
              onClick={openHelp}
              className={`${buttonClass} text-left px-4 py-2`}
            >
              {t('help.open')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={openPresets}
              className={`${buttonClass} text-left px-4 py-2`}
            >
              {t('nav.presets')}
            </button>
            {config?.api_tokens_enabled && (
              <button
                type="button"
                role="menuitem"
                onClick={openSettings}
                title={settingsTitle}
                className={`${buttonClass} text-left px-4 py-2`}
              >
                {settingsLabel}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={handleToggleLanguage}
              className={`${buttonClass} text-left px-4 py-2`}
            >
              {i18n.language === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
            </button>
            {config?.logout_url && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setBurgerOpen(false); handleLogout() }}
                className={`${logoutButtonClass} text-left px-4 py-2`}
              >
                {t('common.logout')}
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
