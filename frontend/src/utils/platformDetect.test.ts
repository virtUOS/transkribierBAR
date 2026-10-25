import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectPlatform, getSystemAudioSupport, type PlatformProfile, type SystemAudioSupport } from './platformDetect'

interface FakeNavigator {
  userAgent: string
  maxTouchPoints?: number
  userAgentData?: { brands: { brand: string; version: string }[]; mobile: boolean; platform: string }
}

const brands = (...names: string[]) => names.map((brand) => ({ brand, version: '140' }))

const CHROME_UA = (os: string) => `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`
const FIREFOX_UA = (os: string) => `Mozilla/5.0 (${os}; rv:140.0) Gecko/20100101 Firefox/140.0`
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

// Real-world navigator shapes. Chromium exposes userAgentData; Firefox and Safari do not.
const browsers: [string, FakeNavigator, PlatformProfile, SystemAudioSupport][] = [
  ['Chrome on Windows',
    { userAgent: CHROME_UA('Windows NT 10.0; Win64; x64'), userAgentData: { brands: brands('Chromium', 'Google Chrome'), mobile: false, platform: 'Windows' } },
    { engine: 'chromium', os: 'windows' }, 'full'],
  ['Edge on Windows',
    { userAgent: `${CHROME_UA('Windows NT 10.0; Win64; x64')} Edg/140.0.0.0`, userAgentData: { brands: brands('Chromium', 'Microsoft Edge'), mobile: false, platform: 'Windows' } },
    { engine: 'chromium', os: 'windows' }, 'full'],
  ['Chrome on macOS',
    { userAgent: CHROME_UA('Macintosh; Intel Mac OS X 10_15_7'), userAgentData: { brands: brands('Chromium', 'Google Chrome'), mobile: false, platform: 'macOS' } },
    { engine: 'chromium', os: 'macos' }, 'tab-only'],
  ['Chrome on Linux',
    { userAgent: CHROME_UA('X11; Linux x86_64'), userAgentData: { brands: brands('Chromium', 'Google Chrome'), mobile: false, platform: 'Linux' } },
    { engine: 'chromium', os: 'linux' }, 'tab-only'],
  ['an older Chrome on Windows without userAgentData',
    { userAgent: CHROME_UA('Windows NT 10.0; Win64; x64') },
    { engine: 'chromium', os: 'windows' }, 'full'],
  ['Firefox on Windows',
    { userAgent: FIREFOX_UA('Windows NT 10.0; Win64; x64') },
    { engine: 'firefox', os: 'windows' }, 'limited'],
  ['Firefox on macOS',
    { userAgent: FIREFOX_UA('Macintosh; Intel Mac OS X 10.15'), maxTouchPoints: 0 },
    { engine: 'firefox', os: 'macos' }, 'limited'],
  ['Firefox on Linux',
    { userAgent: FIREFOX_UA('X11; Linux x86_64') },
    { engine: 'firefox', os: 'linux' }, 'dual-device'],
  ['Safari on macOS',
    { userAgent: SAFARI_UA, maxTouchPoints: 0 },
    { engine: 'other', os: 'macos' }, 'unsupported'],
  ['Safari on iPadOS, which poses as macOS',
    { userAgent: SAFARI_UA, maxTouchPoints: 5 },
    { engine: 'other', os: 'mobile' }, 'unsupported'],
  ['Safari on iPhone',
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
    { engine: 'other', os: 'mobile' }, 'unsupported'],
  ['Chrome on Android',
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', userAgentData: { brands: brands('Chromium', 'Google Chrome'), mobile: true, platform: 'Android' } },
    { engine: 'chromium', os: 'mobile' }, 'unsupported'],
  ['Firefox on Android',
    { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0' },
    { engine: 'firefox', os: 'mobile' }, 'unsupported'],
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectPlatform and getSystemAudioSupport', () => {
  it.each(browsers)('%s', (_name, nav, profile, support) => {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, ...nav })
    expect(detectPlatform()).toEqual(profile)
    expect(getSystemAudioSupport()).toBe(support)
  })
})

describe('getSystemAudioSupport with a given profile', () => {
  it.each<[PlatformProfile, SystemAudioSupport]>([
    [{ engine: 'chromium', os: 'windows' }, 'full'],
    [{ engine: 'chromium', os: 'macos' }, 'tab-only'],
    [{ engine: 'chromium', os: 'linux' }, 'tab-only'],
    [{ engine: 'chromium', os: 'other' }, 'tab-only'],
    [{ engine: 'firefox', os: 'linux' }, 'dual-device'],
    [{ engine: 'firefox', os: 'windows' }, 'limited'],
    [{ engine: 'firefox', os: 'other' }, 'limited'],
    [{ engine: 'other', os: 'windows' }, 'unsupported'],
    [{ engine: 'chromium', os: 'mobile' }, 'unsupported'],
    [{ engine: 'firefox', os: 'mobile' }, 'unsupported'],
  ])('%o is %s', (profile, support) => {
    expect(getSystemAudioSupport(profile)).toBe(support)
  })
})
