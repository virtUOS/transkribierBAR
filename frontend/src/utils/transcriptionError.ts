import type { TFunction } from 'i18next'

const knownCodes = new Set(['server_restarted', 'timeout', 'asr_unreachable', 'asr_failed'])

/**
 * The reason to show when a transcription failed.
 *
 * The server stores its reason in English, because API clients may rely on
 * that text, with a stable code next to it. A code the UI knows is shown in
 * the user's language. Any other code, including "unknown", and a failure
 * without a code show the server's text, or nothing when there is none.
 */
export function transcriptionErrorMessage(
  code: string | null | undefined,
  message: string | null | undefined,
  t: TFunction,
): string | null {
  if (code && knownCodes.has(code)) return t(`transcription.errors.${code}`)
  return message || null
}
