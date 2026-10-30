export interface SseEvent {
  event: string
  data: string
}

/** Incremental parser for a `text/event-stream` body: feed it decoded chunks, get complete events. */
export class SseParser {
  private buffer = ''

  push(text: string): SseEvent[] {
    this.buffer = (this.buffer + text).replace(/\r\n?/g, '\n')
    const events: SseEvent[] = []
    let end: number
    while ((end = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of frame.split('\n')) {
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length > 0) events.push({ event, data: data.join('\n') })
    }
    return events
  }
}
