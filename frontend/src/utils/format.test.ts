import { describe, it, expect } from 'vitest'
import { formatDate, formatDateTime, formatFileSize, formatTimeMs, parseServerDate, parseTimestamp } from './format'

describe('formatFileSize', () => {
  it('formats bytes below 1 KB', () => {
    expect(formatFileSize(500)).toBe('500 B')
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
