import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { transcriptionErrorMessage } from './transcriptionError'

const t = i18n.t.bind(i18n)

describe('transcriptionErrorMessage', () => {
  // The server stores its reason in English, for API clients, with a stable
  // code next to it. The user hears a known reason in their own language.
  it('translates every known code, in every UI language', async () => {
    for (const lng of ['en', 'de']) {
      await i18n.changeLanguage(lng)
      for (const code of ['server_restarted', 'timeout', 'asr_unreachable', 'asr_failed']) {
        const key = `transcription.errors.${code}`
        const message = transcriptionErrorMessage(code, 'English server text', t)
        expect(message).not.toBe(key)
        expect(message).not.toBe('English server text')
        expect(message).toBe(i18n.getResource(lng, 'translation', key))
      }
    }
  })

  it('shows the server text for an unknown failure', async () => {
    await i18n.changeLanguage('de')
    expect(transcriptionErrorMessage('unknown', 'asr exploded', t)).toBe('asr exploded')
  })

  it('shows the server text for a code it does not know', async () => {
    await i18n.changeLanguage('de')
    expect(transcriptionErrorMessage('something_new', 'Something new failed', t)).toBe('Something new failed')
  })

  it('shows the server text when there is no code', async () => {
    await i18n.changeLanguage('de')
    expect(transcriptionErrorMessage(null, 'Old failure', t)).toBe('Old failure')
    expect(transcriptionErrorMessage(undefined, 'Old failure', t)).toBe('Old failure')
  })

  it('has nothing to show without a code or a text', () => {
    expect(transcriptionErrorMessage(null, null, t)).toBeNull()
  })
})
