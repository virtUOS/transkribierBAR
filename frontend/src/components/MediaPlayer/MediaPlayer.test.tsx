import { afterEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import i18n from '../../i18n'
import { MediaPlayer } from './MediaPlayer'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('MediaPlayer labels', () => {
  it('names its controls in the interface language and follows a switch', async () => {
    await i18n.changeLanguage('de')
    const { container, unmount } = render(<MediaPlayer fileId="f1" mediaType="mp4" hasVideo />)
    const playLabel = () => container.querySelector('.vjs-play-control .vjs-control-text')?.textContent

    expect(playLabel()).toBe('Wiedergabe')

    await act(async () => { await i18n.changeLanguage('en') })
    expect(playLabel()).toBe('Play')
    unmount()
  })
})
