import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import type { Components } from 'react-markdown'
import type { HelpSectionId } from './helpSections'
import { loadContent, resolveAssetUrl, settingValues, fillSettings, shotFor } from './helpSections'
import { HelpShot } from './HelpShot'
import { HelpLink } from './HelpLink'
import { useStore } from '../../store'

interface HelpContentProps {
  sectionId: HelpSectionId
}

function LightboxImage({ src, alt, lang, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { lang: 'de' | 'en' }) {
  const resolved = resolveAssetUrl(typeof src === 'string' ? src : undefined, lang)
  const dialogRef = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        type="button"
        className="my-4 block w-full cursor-pointer rounded border border-gray-700 bg-gray-800/40 p-2 transition-colors hover:border-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => dialogRef.current?.showModal()}
      >
        <img src={resolved} alt={alt ?? ''} className="block w-full" {...props} />
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === e.currentTarget) dialogRef.current?.close() }}
        className="backdrop:bg-black/70 bg-transparent p-4 w-[90vw] max-h-[90vh] m-auto"
      >
        <img src={resolved} alt={alt ?? ''} className="w-full object-contain rounded bg-gray-800 p-6" />
      </dialog>
    </>
  )
}

const components: Components = {
  a: HelpLink,
  code: ({ children, ...props }) => (
    <code className="bg-gray-800 text-amber-300 px-1 py-0.5 rounded text-sm" {...props}>
      {children}
    </code>
  ),
  pre: ({ children, ...props }) => (
    <pre className="bg-gray-800 text-gray-200 p-3 rounded text-sm overflow-x-auto" {...props}>
      {children}
    </pre>
  ),
  h1: ({ children, ...props }) => (
    <h1 className="text-2xl font-semibold text-white mt-0 mb-4" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-lg font-semibold text-white mt-6 mb-2" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-base font-semibold text-gray-200 mt-4 mb-2" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }) => (
    <p className="text-gray-300 leading-relaxed mb-3" {...props}>{children}</p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-inside text-gray-300 mb-3 space-y-1" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-inside text-gray-300 mb-3 space-y-1" {...props}>{children}</ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-gray-300" {...props}>{children}</li>
  ),
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-3">
      <table className="text-sm text-gray-300 border-collapse" {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th className="border border-gray-700 px-3 py-1 bg-gray-800 text-left font-semibold" {...props}>{children}</th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-gray-700 px-3 py-1" {...props}>{children}</td>
  ),
}

function makeComponents(lang: 'de' | 'en'): Components {
  return {
    ...components,
    // A paragraph holding only an image renders figure/dialog markup, which is not allowed inside <p>.
    p: ({ node, children, ...props }) => {
      const kids = node?.children ?? []
      if (kids.length === 1 && kids[0].type === 'element' && kids[0].tagName === 'img') return <>{children}</>
      return <p className="text-gray-300 leading-relaxed mb-3" {...props}>{children}</p>
    },
    img: (props) => {
      const src = typeof props.src === 'string' ? props.src : ''
      const shot = shotFor(lang, src)
      return shot ? <HelpShot url={shot.url} alt={props.alt ?? ''} meta={shot.meta} /> : <LightboxImage {...props} lang={lang} />
    },
  }
}

const componentsByLang = { de: makeComponents('de'), en: makeComponents('en') }

export function HelpContent({ sectionId }: HelpContentProps) {
  const { i18n, t } = useTranslation()
  const lang: 'en' | 'de' = i18n.language === 'de' ? 'de' : 'en'
  const config = useStore((s) => s.config)
  const raw = loadContent(sectionId, lang)
  const markdown = raw === null ? null : fillSettings(raw, settingValues(config, lang))
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to top whenever the section changes so users land at the section heading.
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
    }
  }, [sectionId, lang])

  if (!markdown) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto p-6">
        <p className="text-gray-400 italic">{t('help.missingContent')}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={componentsByLang[lang]}>
        {markdown}
      </ReactMarkdown>
      <p className="mt-8 pt-4 border-t border-gray-700 text-sm">
        <a
          href={`${import.meta.env.BASE_URL}handbuch/${lang === 'en' ? 'en/' : ''}#${sectionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
        >
          {t('help.openInGuide')} <span aria-hidden="true">↗</span>
        </a>
      </p>
    </div>
  )
}
