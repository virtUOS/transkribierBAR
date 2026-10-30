import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import { api } from '../../api/client'
import { FileUpload } from './FileUpload'
import type { FileInfo } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { uploadFile: vi.fn() },
}))

const fileInfo = { id: 'f1', original_filename: 'talk.mp3', file_size: 2048 } as FileInfo

function makeFile(name = 'talk.mp3', size = 10) {
  const f = new File(['x'], name, { type: 'audio/mpeg' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

const initialState = useStore.getState()

beforeEach(async () => {
  vi.clearAllMocks()
  useStore.setState(initialState, true)
  await i18n.changeLanguage('en')
})

describe('FileUpload', () => {
  it('offers the picker with the supported formats', () => {
    render(<FileUpload />)
    expect(screen.getByText('Drag and drop a file or click to upload')).toBeInTheDocument()
    expect(fileInput().accept).toBe('.mp3,.wav,.mp4,.webm,.m4a,.mov,.aac,.opus,.ogg')
  })

  it('uploads the picked file and stores the result', async () => {
    vi.mocked(api.uploadFile).mockResolvedValue(fileInfo)
    render(<FileUpload />)
    const f = makeFile()
    fireEvent.change(fileInput(), { target: { files: [f] } })
    await waitFor(() => expect(useStore.getState().file).toEqual(fileInfo))
    expect(api.uploadFile).toHaveBeenCalledWith(f, expect.any(AbortSignal))
    expect(useStore.getState().uploading).toBe(false)
    expect(useStore.getState().uploadAbortController).toBeNull()
    // Once a file is there, the drop zone becomes a file summary.
    expect(screen.getByText('talk.mp3')).toBeInTheDocument()
    expect(screen.getByText('(2.0 KB)')).toBeInTheDocument()
  })

  it('uploads a dropped file', async () => {
    vi.mocked(api.uploadFile).mockResolvedValue(fileInfo)
    const { container } = render(<FileUpload />)
    const f = makeFile('drop.wav')
    fireEvent.drop(container.firstChild as Element, { dataTransfer: { files: [f] } })
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledWith(f, expect.any(AbortSignal)))
  })

  it('shows a busy state and exposes the abort controller while uploading', async () => {
    let resolve!: (v: FileInfo) => void
    vi.mocked(api.uploadFile).mockReturnValue(new Promise((r) => { resolve = r }))
    render(<FileUpload />)
    fireEvent.change(fileInput(), { target: { files: [makeFile()] } })
    expect(await screen.findByText('Uploading file — please wait...')).toBeInTheDocument()
    expect(fileInput()).toBeDisabled()
    expect(useStore.getState().uploading).toBe(true)
    expect(useStore.getState().uploadAbortController).toBeInstanceOf(AbortController)
    await act(async () => resolve(fileInfo))
    expect(useStore.getState().uploading).toBe(false)
  })

  it('rejects files over 1 GB without uploading', () => {
    render(<FileUpload />)
    fireEvent.change(fileInput(), { target: { files: [makeFile('big.mp4', 1024 * 1024 * 1024 + 1)] } })
    expect(screen.getByText('File is too large. Maximum size is 1 GB.')).toBeInTheDocument()
    expect(api.uploadFile).not.toHaveBeenCalled()
  })

  it('accepts a file of exactly 1 GB', async () => {
    vi.mocked(api.uploadFile).mockResolvedValue(fileInfo)
    render(<FileUpload />)
    fireEvent.change(fileInput(), { target: { files: [makeFile('edge.mp4', 1024 * 1024 * 1024)] } })
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalled())
    expect(screen.queryByText(/File is too large/)).not.toBeInTheDocument()
  })

  it('shows the server error when the upload fails', async () => {
    vi.mocked(api.uploadFile).mockRejectedValue(new Error('Unsupported file type'))
    render(<FileUpload />)
    fireEvent.change(fileInput(), { target: { files: [makeFile('notes.txt')] } })
    expect(await screen.findByText('Unsupported file type')).toBeInTheDocument()
    expect(useStore.getState().file).toBeNull()
    expect(useStore.getState().uploading).toBe(false)
  })

  it('shows no error when the user cancelled the upload', async () => {
    vi.mocked(api.uploadFile).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    render(<FileUpload />)
    fireEvent.change(fileInput(), { target: { files: [makeFile()] } })
    await waitFor(() => expect(useStore.getState().uploading).toBe(false))
    expect(screen.queryByText('aborted')).not.toBeInTheDocument()
    expect(screen.getByText('Drag and drop a file or click to upload')).toBeInTheDocument()
  })

  it('shows the title with the filename once a transcription has one', () => {
    useStore.setState({ file: fileInfo, transcriptionTitle: 'Team meeting' })
    render(<FileUpload />)
    expect(screen.getByText('Team meeting')).toBeInTheDocument()
    expect(screen.getByText('[talk.mp3]')).toBeInTheDocument()
  })
})
