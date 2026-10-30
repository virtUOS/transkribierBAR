export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}`
}

/** `formatTime` with milliseconds, `hh:mm:ss.mmm`, for editing a time precisely. */
export function formatTimeMs(ms: number): string {
  return `${formatTime(ms)}.${(Math.floor(ms) % 1000).toString().padStart(3, '0')}`
}

/**
 * Reads a time typed into the editor: `hh:mm:ss`, `mm:ss` or plain seconds,
 * each with an optional fraction after `.` or `,`. Returns milliseconds, or
 * null when the input is not such a time.
 */
export function parseTimestamp(input: string): number | null {
  const match = /^(\d+(?::\d+){0,2})(?:[.,](\d+))?$/.exec(input.trim())
  if (!match) return null
  const seconds = match[1].split(':').reduce((total, part) => total * 60 + Number(part), 0)
  return Math.round((seconds + Number(`0.${match[2] ?? 0}`)) * 1000)
}

export function formatSrtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const millis = ms % 1000
  const pad = (n: number, digits = 2) => n.toString().padStart(digits, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(millis, 3)}`
}

export function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(',', '.')
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Parse a timestamp from the server. The backend sends `YYYY-MM-DD HH:MM:SS`
 * in UTC without a designator; such values are read as UTC. Strings that
 * already carry `Z` or an offset are left alone.
 */
export function parseServerDate(value: string): Date {
  const iso = value.replace(' ', 'T')
  const hasZone = /T.*(Z|[+-]\d{2}(:?\d{2})?)$/i.test(iso)
  return new Date(hasZone ? iso : iso + 'Z')
}

export function formatDate(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? parseServerDate(value) : value
  return date.toLocaleDateString(locale)
}

export function formatDateTime(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? parseServerDate(value) : value
  return date.toLocaleString(locale)
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadText(content: string, filename: string) {
  downloadFile(content, filename, 'text/plain')
}

export function downloadMarkdown(content: string, filename: string) {
  downloadFile(content, filename, 'text/markdown')
}
