import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { FormatViewer } from './FormatViewer'
import { downloadText } from '../../utils/format'
import type { TranscriptionResult, Utterance } from '../../api/types'

vi.mock('../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/format')>()),
  downloadText: vi.fn(),
}))

const utterances: Utterance[] = [
  { start: 0, end: 1500, text: 'Hello there.', speaker: 'SPEAKER_00' },
  { start: 3_661_001, end: 3_662_250, text: 'General Kenobi.', speaker: 'SPEAKER_01' },
  { start: 3_663_000, end: 3_664_000, text: 'No speaker.', speaker: null },
]

function setup(state: Record<string, unknown> = {}) {
  useStore.setState({
    transcriptionResult: { id: 't1', utterances } as TranscriptionResult,
    speakerMappings: { SPEAKER_00: 'Ann' },
    ...state,
  })
}

function content() {
  return (screen.getByRole('textbox') as HTMLTextAreaElement).value
}

const initialState = useStore.getState()

beforeEach(async () => {
  vi.clearAllMocks()
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
})

describe('FormatViewer', () => {
  it('renders SRT with numbered cues, comma timestamps and mapped speaker names', () => {
    setup()
    render(<FormatViewer format="srt" />)
    expect(content()).toBe([
      '1\n00:00:00,000 --> 00:00:01,500\n[Ann]: Hello there.',
      '2\n01:01:01,001 --> 01:01:02,250\n[SPEAKER_01]: General Kenobi.',
      '3\n01:01:03,000 --> 01:01:04,000\nNo speaker.',
    ].join('\n\n'))
  })

  it('renders VTT with a header and dot timestamps', () => {
    setup()
    render(<FormatViewer format="vtt" />)
    expect(content()).toBe([
      'WEBVTT',
      '00:00:00.000 --> 00:00:01.500\n[Ann]: Hello there.',
      '01:01:01.001 --> 01:01:02.250\n[SPEAKER_01]: General Kenobi.',
      '01:01:03.000 --> 01:01:04.000\nNo speaker.',
    ].join('\n\n'))
  })

  it('renders TXT with one line per utterance', () => {
    setup()
    render(<FormatViewer format="txt" />)
    expect(content()).toBe('Ann: Hello there.\nSPEAKER_01: General Kenobi.\nNo speaker.')
  })

  it('renders JSON with mapped speakers and keeps null speakers', () => {
    setup()
    render(<FormatViewer format="json" />)
    expect(JSON.parse(content())).toEqual([
      { start: 0, end: 1500, text: 'Hello there.', speaker: 'Ann' },
      { start: 3_661_001, end: 3_662_250, text: 'General Kenobi.', speaker: 'SPEAKER_01' },
      { start: 3_663_000, end: 3_664_000, text: 'No speaker.', speaker: null },
    ])
  })

  it('renders an empty preview for an unknown format', () => {
    setup()
    render(<FormatViewer format="docx" />)
    expect(content()).toBe('')
  })

  it('exports the refined text when the refined view is active', () => {
    setup({
      refinedUtterances: [{ start: 0, end: 1500, text: 'Hello, there!', speaker: 'SPEAKER_00' }],
      activeView: 'refined',
    })
    render(<FormatViewer format="txt" />)
    expect(content()).toBe('Ann: Hello, there!')
  })

  it('exports both original and refined utterances as JSON in the refined view', () => {
    setup({
      refinedUtterances: [{ start: 0, end: 1500, text: 'Hello, there!', speaker: 'SPEAKER_00' }],
      activeView: 'refined',
    })
    render(<FormatViewer format="json" />)
    const parsed = JSON.parse(content())
    expect(parsed.utterances).toHaveLength(3)
    expect(parsed.utterances[0].speaker).toBe('Ann')
    expect(parsed.refined_utterances).toEqual([{ start: 0, end: 1500, text: 'Hello, there!', speaker: 'Ann' }])
  })

  it('exports the translation when the translated view is active', () => {
    setup({
      translatedUtterances: [{ start: 0, end: 1500, text: 'Hallo.', speaker: 'SPEAKER_00' }],
      activeView: 'translated',
    })
    render(<FormatViewer format="txt" />)
    expect(content()).toBe('Ann: Hallo.')
  })

  it('falls back to the original when the selected view has no data', () => {
    setup({ activeView: 'refined', refinedUtterances: null })
    render(<FormatViewer format="txt" />)
    expect(content()).toContain('Ann: Hello there.')
  })

  it('downloads under the media file name with the format extension', () => {
    setup({ file: { id: 'f1', original_filename: 'meeting.final.mp4', file_size: 1 } })
    render(<FormatViewer format="srt" />)
    const buttons = screen.getAllByRole('button', { name: 'Download SRT' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0])
    expect(downloadText).toHaveBeenCalledWith(content(), 'meeting.final.srt')
  })

  it('downloads as "transcription" when no file is known', () => {
    setup()
    render(<FormatViewer format="vtt" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Download VTT' })[1])
    expect(downloadText).toHaveBeenCalledWith(expect.stringMatching(/^WEBVTT/), 'transcription.vtt')
  })
})
