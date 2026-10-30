import { useEffect, useState, type RefObject } from 'react'

/**
 * Behavior shared by the modal dialogs: remember the element that had focus
 * when the dialog mounted and give focus back to it on unmount, and call
 * `onEscape` when Escape is pressed. Pass `undefined` to ignore Escape.
 *
 * Focus moves to `initialFocus` in the effect rather than through `autoFocus`,
 * so it survives StrictMode's mount, cleanup, mount cycle: the cleanup hands
 * focus back to the opener and the second mount takes it again. The opener is
 * read during the first render, before any focus has moved.
 */
export function useModalDialog(
  onEscape: (() => void) | undefined,
  initialFocus: RefObject<HTMLElement | null>,
) {
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    initialFocus.current?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [opener, initialFocus])

  useEffect(() => {
    if (!onEscape) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onEscape])
}
