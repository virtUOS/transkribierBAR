import { describe, expect, it } from 'vitest'
import { SseParser } from './sse'

describe('SseParser', () => {
  it('parses one frame per push', () => {
    const p = new SseParser()
    expect(p.push('data: {"delta": "Hi"}\n\n')).toEqual([{ event: 'message', data: '{"delta": "Hi"}' }])
  })

  it('parses a frame split mid-JSON across three pushes', () => {
    const p = new SseParser()
    expect(p.push('data: {"del')).toEqual([])
    expect(p.push('ta": "H')).toEqual([])
    expect(p.push('i"}\n\n')).toEqual([{ event: 'message', data: '{"delta": "Hi"}' }])
  })

  it('parses two frames in one push', () => {
    const p = new SseParser()
    expect(p.push('data: {"delta": "A"}\n\ndata: {"delta": "B"}\n\n')).toEqual([
      { event: 'message', data: '{"delta": "A"}' },
      { event: 'message', data: '{"delta": "B"}' },
    ])
  })

  it('handles CRLF line endings', () => {
    const p = new SseParser()
    expect(p.push('data: {"delta": "A"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n')).toEqual([
      { event: 'message', data: '{"delta": "A"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('reads the event name of a done frame', () => {
    const p = new SseParser()
    expect(p.push('event: done\ndata: {}\n\n')).toEqual([{ event: 'done', data: '{}' }])
  })
})
