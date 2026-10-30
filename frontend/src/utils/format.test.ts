import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  downloadFile, downloadMarkdown, downloadText, formatDate, formatDateTime, formatFileSize, formatSrtTime,
  formatTime, formatTimeMs, formatVttTime, parseServerDate, parseTimestamp,
} from './format'

describe('formatFileSize', () => {
  it('formats bytes below 1 KB', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('formats kilobytes with one decimal place', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes with one decimal place', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('treats exactly 1024 bytes as the KB boundary', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
  })

  it('treats exactly 1 MB as the MB boundary, not KB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('keeps large files in MB (no GB unit)', () => {
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3072.0 MB')
  })
})

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('00:00:00')
  })

  it('drops the milliseconds rather than rounding', () => {
    expect(formatTime(59_999)).toBe('00:00:59')
  })

  it('rolls seconds into minutes and minutes into hours', () => {
    expect(formatTime(61_000)).toBe('00:01:01')
    expect(formatTime(3_600_000)).toBe('01:00:00')
    expect(formatTime((2 * 3600 + 3 * 60 + 4) * 1000)).toBe('02:03:04')
  })

  it('does not wrap hours past a day', () => {
    expect(formatTime(100 * 3_600_000)).toBe('100:00:00')
  })
})

describe('formatTimeMs', () => {
  it('shows hours, minutes, seconds and milliseconds', () => {
    expect(formatTimeMs(0)).toBe('00:00:00.000')
    expect(formatTimeMs(1500)).toBe('00:00:01.500')
    expect(formatTimeMs(3723004)).toBe('01:02:03.004')
  })
})

describe('parseTimestamp', () => {
  it.each([
    ['01:02:03', 3723000],
    ['00:00:01.500', 1500],
    ['01:02:03,25', 3723250],
    ['01:30', 90000],
    ['01:30.5', 90500],
    ['12', 12000],
    ['90', 90000],
    ['12.5', 12500],
    ['12,5', 12500],
    ['0.001', 1],
    ['  01:30  ', 90000],
  ])('reads %j as %d ms', (input, ms) => {
    expect(parseTimestamp(input)).toBe(ms)
  })

  it.each(['', '   ', 'abc', '1:2a', '-5', '-00:01', '1:2:3:4', '01::30', '1.5.5'])(
    'rejects %j',
    (input) => {
      expect(parseTimestamp(input)).toBeNull()
    },
  )
})

describe('formatSrtTime', () => {
  it('formats zero with a comma before the milliseconds', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000')
  })

  it('pads milliseconds to three digits', () => {
    expect(formatSrtTime(1_005)).toBe('00:00:01,005')
    expect(formatSrtTime(1_050)).toBe('00:00:01,050')
  })

  it('formats hours, minutes, seconds and milliseconds', () => {
    expect(formatSrtTime((1 * 3600 + 2 * 60 + 3) * 1000 + 456)).toBe('01:02:03,456')
  })

  it('handles the last millisecond before a minute boundary', () => {
    expect(formatSrtTime(59_999)).toBe('00:00:59,999')
    expect(formatSrtTime(60_000)).toBe('00:01:00,000')
  })
})

describe('formatVttTime', () => {
  it('uses a dot instead of the SRT comma', () => {
    expect(formatVttTime((1 * 3600 + 2 * 60 + 3) * 1000 + 456)).toBe('01:02:03.456')
    expect(formatVttTime(0)).toBe('00:00:00.000')
  })
})

describe('parseServerDate', () => {
  it('treats the server format as UTC', () => {
    expect(parseServerDate('2027-01-22 09:15:03').toISOString()).toBe('2027-01-22T09:15:03.000Z')
  })

  it('treats a T-separated value without designator as UTC', () => {
    expect(parseServerDate('2027-01-22T09:15:03').toISOString()).toBe('2027-01-22T09:15:03.000Z')
  })

  it('leaves an ISO string with Z alone', () => {
    expect(parseServerDate('2027-01-22T09:15:03.000Z').toISOString()).toBe('2027-01-22T09:15:03.000Z')
  })

  it('leaves an ISO string with an offset alone', () => {
    expect(parseServerDate('2027-01-22T09:15:03+02:00').toISOString()).toBe('2027-01-22T07:15:03.000Z')
  })
})

describe('formatDate / formatDateTime', () => {
  const iso = '2027-01-22T09:15:03Z'
  const d = new Date(iso)

  it('formats a date in the given locale', () => {
    expect(formatDate(iso, 'en')).toBe(d.toLocaleDateString('en'))
    expect(formatDate(iso, 'de')).toBe(d.toLocaleDateString('de'))
    expect(formatDate(iso, 'en')).not.toBe(formatDate(iso, 'de'))
  })

  it('formats date and time in the given locale', () => {
    expect(formatDateTime(iso, 'en')).toBe(d.toLocaleString('en'))
    expect(formatDateTime(iso, 'de')).toBe(d.toLocaleString('de'))
  })

  it('reads designator-less server strings as UTC and accepts Date objects', () => {
    expect(formatDate('2027-01-22 09:15:03', 'en')).toBe(d.toLocaleDateString('en'))
    expect(formatDate(d, 'en')).toBe(d.toLocaleDateString('en'))
  })
})

describe('download helpers', () => {
  const { createObjectURL: origCreate, revokeObjectURL: origRevoke } = URL

  afterEach(() => {
    vi.restoreAllMocks()
    Object.assign(URL, { createObjectURL: origCreate, revokeObjectURL: origRevoke })
  })

  function setup() {
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:mock'
    })
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clicked: { href: string | null; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href'), download: this.download })
    })
    return { blobs, revokeObjectURL, clicked }
  }

  it('downloadFile clicks a link to a blob URL with the filename, then revokes the URL', async () => {
    const { blobs, revokeObjectURL, clicked } = setup()
    downloadFile('a,b', 'data.csv', 'text/csv')
    expect(clicked).toEqual([{ href: 'blob:mock', download: 'data.csv' }])
    expect(blobs[0].type).toBe('text/csv')
    expect(await blobs[0].text()).toBe('a,b')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('downloadText uses text/plain', () => {
    const { blobs, clicked } = setup()
    downloadText('hello', 'a.txt')
    expect(blobs[0].type).toBe('text/plain')
    expect(clicked[0].download).toBe('a.txt')
  })

  it('downloadMarkdown uses text/markdown', () => {
    const { blobs, clicked } = setup()
    downloadMarkdown('# hi', 'a.md')
    expect(blobs[0].type).toBe('text/markdown')
    expect(clicked[0].download).toBe('a.md')
  })
})
