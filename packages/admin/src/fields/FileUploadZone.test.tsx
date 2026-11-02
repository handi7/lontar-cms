import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileUploadZone, formatFilesize } from './FileUploadZone'

describe('formatFilesize', () => {
  it('formats bytes, KB, and MB correctly', () => {
    expect(formatFilesize(null)).toBe('')
    expect(formatFilesize(undefined)).toBe('')
    expect(formatFilesize(500)).toBe('500 B')
    expect(formatFilesize(2048)).toBe('2.0 KB')
    expect(formatFilesize(1048576 * 2.5)).toBe('2.5 MB')
  })
})

describe('FileUploadZone', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders dropzone when no file is selected', () => {
    const onChange = vi.fn()
    render(<FileUploadZone onChange={onChange} accept="image/*" />)

    expect(screen.getByTestId('upload-dropzone')).toBeTruthy()
    expect(screen.getByText(/Drag & drop a file here/i)).toBeTruthy()
    expect(screen.getByText(/Accepted: image\/\*/i)).toBeTruthy()
  })

  it('triggers file selection when file is chosen', () => {
    const onChange = vi.fn()
    render(<FileUploadZone onChange={onChange} />)

    const input = screen.getByTestId('upload-file-input')
    const file = new File(['content'], 'test.png', { type: 'image/png' })

    fireEvent.change(input, { target: { files: [file] } })
    expect(onChange).toHaveBeenCalledWith(file)
  })

  it('handles drag and drop of file', () => {
    const onChange = vi.fn()
    render(<FileUploadZone onChange={onChange} />)

    const dropzone = screen.getByTestId('upload-dropzone')
    const file = new File(['content'], 'dropped.png', { type: 'image/png' })

    fireEvent.dragOver(dropzone)
    expect(dropzone.className).toContain('lontar-dropzone-active')

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    })

    expect(onChange).toHaveBeenCalledWith(file)
  })

  it('renders selected file preview and allows clearing', () => {
    const onChange = vi.fn()
    const file = new File(['hello world'], 'doc.pdf', { type: 'application/pdf' })

    render(<FileUploadZone value={file} onChange={onChange} />)

    expect(screen.getByTestId('upload-selected-preview')).toBeTruthy()
    expect(screen.getByText('doc.pdf')).toBeTruthy()

    const removeBtn = screen.getByTestId('upload-remove-file')
    fireEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders current document file preview and replace button', () => {
    const onChange = vi.fn()
    render(
      <FileUploadZone
        onChange={onChange}
        currentFile={{
          filename: 'existing.jpg',
          url: '/media/existing.jpg',
          mimeType: 'image/jpeg',
          filesize: 10240,
          width: 800,
          height: 600,
        }}
      />,
    )

    expect(screen.getByTestId('upload-current-preview')).toBeTruthy()
    expect(screen.getByText('existing.jpg')).toBeTruthy()
    expect(screen.getByText(/800×600px/)).toBeTruthy()
    expect(screen.getByTestId('upload-replace-file')).toBeTruthy()
  })

  it('renders error message when error prop is provided', () => {
    const onChange = vi.fn()
    render(<FileUploadZone onChange={onChange} error="File too large" />)

    expect(screen.getByText('File too large')).toBeTruthy()
    expect(screen.getByTestId('upload-dropzone').className).toContain('lontar-dropzone-error')
  })

  it('rejects file larger than maxFileSize and displays error', () => {
    const onChange = vi.fn()
    render(<FileUploadZone onChange={onChange} maxFileSize={100} />)

    expect(screen.getByText(/Max size: 100 B/i)).toBeTruthy()

    const input = screen.getByTestId('upload-file-input')
    const largeFile = new File(['a'.repeat(200)], 'large.png', { type: 'image/png' })

    fireEvent.change(input, { target: { files: [largeFile] } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/File size exceeds maximum allowed size of 100 B/i)).toBeTruthy()
  })
})
