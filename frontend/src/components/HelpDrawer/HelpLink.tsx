import type { ComponentProps } from 'react'

type LinkProps = ComponentProps<'a'> & { node?: unknown }

// Guide pages (/handbuch/...) are separate documents: opening them in place would
// navigate the SPA away and lose a running upload or recording. mailto: links fire
// beforeunload in Chromium, which would show a false "Leave site?" prompt.
export function HelpLink({ href, children, node: _node, ...props }: LinkProps) {
  void _node
  const opensInNewTab =
    !!href &&
    (href.startsWith('http://') ||
      href.startsWith('mailto:') ||
      href.startsWith('https://') ||
      href.startsWith('/handbuch/') ||
      href.startsWith(`${import.meta.env.BASE_URL}handbuch/`))
  if (opensInNewTab) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline" {...props}>
        {children}
      </a>
    )
  }
  return (
    <a href={href} className="text-blue-400 hover:text-blue-300 underline" {...props}>
      {children}
    </a>
  )
}
