import { useState, useRef, useEffect } from 'react'

export interface FileUploadZoneProps {
  value?: File | null
  onChange: (file: File | null) => void
  currentFile?: {
    filename?: string
    url?: string
    mimeType?: string
    filesize?: number
    width?: number | null
    height?: number | null
  } | null
  accept?: string
  error?: string
  required?: boolean
  disabled?: boolean
}

export function formatFilesize(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SelectedFilePreview({ file, onClear }: { file: File; onClear: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreviewUrl(null)
  }, [file])

  return (
    <div className="lontar-upload-preview" data-testid="upload-selected-preview">
      {previewUrl && <img src={previewUrl} alt={file.name} className="lontar-upload-preview-img" />}
      <div className="lontar-upload-preview-info">
        <span className="lontar-upload-filename">{file.name}</span>
        <span className="lontar-upload-meta">
          {formatFilesize(file.size)} • {file.type || 'file'}
        </span>
      </div>
      <button
        type="button"
        className="lontar-btn lontar-btn-danger lontar-btn-sm"
        onClick={onClear}
        data-testid="upload-remove-file"
      >
        Remove
      </button>
    </div>
  )
}

function isImageFile(mimeType?: string, url?: string): boolean {
  if (mimeType?.startsWith('image/')) return true
  return Boolean(url && /\.(png|jpe?g|gif|webp|svg)$/i.test(url))
}

function formatFileMeta(file: {
  filesize?: number
  width?: number | null
  height?: number | null
  mimeType?: string
}): string {
  const parts: string[] = []
  if (file.filesize) parts.push(formatFilesize(file.filesize))
  if (file.width && file.height) parts.push(`${file.width}×${file.height}px`)
  if (file.mimeType) parts.push(file.mimeType)
  return parts.join(' • ')
}

function CurrentFilePreview({
  file,
  onReplace,
}: {
  file: {
    filename?: string
    url?: string
    mimeType?: string
    filesize?: number
    width?: number | null
    height?: number | null
  }
  onReplace: () => void
}) {
  const isImage = isImageFile(file.mimeType, file.url)
  const meta = formatFileMeta(file)

  return (
    <div className="lontar-upload-preview" data-testid="upload-current-preview">
      {isImage && file.url && (
        <img src={file.url} alt={file.filename ?? ''} className="lontar-upload-preview-img" />
      )}
      <div className="lontar-upload-preview-info">
        <span className="lontar-upload-filename">{file.filename}</span>
        <span className="lontar-upload-meta">{meta}</span>
      </div>
      <button
        type="button"
        className="lontar-btn lontar-btn-secondary lontar-btn-sm"
        onClick={onReplace}
        data-testid="upload-replace-file"
      >
        Replace File
      </button>
    </div>
  )
}

export function FileUploadZone({
  value,
  onChange,
  currentFile,
  accept,
  error,
  required,
  disabled,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile) {
      onChange(droppedFile)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      onChange(selected)
    }
  }

  return (
    <div className="lontar-field-group lontar-upload-zone-wrapper">
      <label className="lontar-label">
        <span>File</span>
        {required && <span className="lontar-required">*</span>}
      </label>

      {value ? (
        <SelectedFilePreview file={value} onClear={() => onChange(null)} />
      ) : currentFile?.url ? (
        <CurrentFilePreview file={currentFile} onReplace={() => inputRef.current?.click()} />
      ) : (
        <div
          className={`lontar-dropzone ${isDragging ? 'lontar-dropzone-active' : ''} ${
            error ? 'lontar-dropzone-error' : ''
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          data-testid="upload-dropzone"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              inputRef.current?.click()
            }
          }}
        >
          <div className="lontar-dropzone-content">
            <span className="lontar-dropzone-icon">📁</span>
            <span className="lontar-dropzone-prompt">
              Drag &amp; drop a file here, or click to browse
            </span>
            {accept && <span className="lontar-dropzone-hint">Accepted: {accept}</span>}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: 'none' }}
        data-testid="upload-file-input"
        disabled={disabled}
      />

      {error && <span className="lontar-field-error">{error}</span>}
    </div>
  )
}
