import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  downloadFile, downloadMarkdown, downloadText, formatFileSize, formatSrtTime, formatTime, formatVttTime,
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
