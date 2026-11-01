import { useState, useEffect, useContext, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { ClientUploadField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { fetchCollectionDocs, fetchDoc, createDoc } from '../api/client'
import { formatFilesize } from './FileUploadZone'

export interface UploadPickerProps {
  field: ClientUploadField
  register: UseFormRegister<Record<string, unknown>>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
}

function extractNumericId(item: unknown): number | null {
  if (typeof item === 'number' && item > 0) return item
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const id = (item as Record<string, unknown>).id
    if (typeof id === 'number' && id > 0) return id
  }
  return null
}

function getMediaTitle(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return ''
  if (typeof doc.filename === 'string' && doc.filename) return doc.filename
  if (typeof doc.alt === 'string' && doc.alt) return doc.alt
  if (typeof doc.title === 'string' && doc.title) return doc.title
  if (typeof doc.id === 'number' || typeof doc.id === 'string') return `#${String(doc.id)}`
  return 'Untitled'
}

function isMediaImage(doc?: Record<string, unknown> | null): boolean {
  if (!doc) return false
  if (typeof doc.mimeType === 'string' && doc.mimeType.startsWith('image/')) return true
  const url = typeof doc.url === 'string' ? doc.url : ''
  return Boolean(url && /\.(png|jpe?g|gif|webp|svg)$/i.test(url))
}

function formatMediaDimensions(doc?: Record<string, unknown> | null): string {
  if (!doc) return ''
  const w = typeof doc.width === 'number' ? doc.width : null
  const h = typeof doc.height === 'number' ? doc.height : null
  return w && h ? ` • ${w}×${h}px` : ''
}

function SelectedMediaView({
  doc,
  id,
  basePath,
  relationTo,
  onChange,
  onRemove,
}: {
  doc: Record<string, unknown> | null | undefined
  id: number
  basePath: string
  relationTo: string
  onChange: () => void
  onRemove: () => void
}) {
  const url = typeof doc?.url === 'string' ? doc.url : ''
  const isImage = isMediaImage(doc)
  const title = getMediaTitle(doc) || `#${id}`
  const base = basePath && basePath !== '/' ? basePath.replace(/\/+$/, '') : ''
  const viewUrl = `${base}/${relationTo}/${id}`
  const filesizeStr = typeof doc?.filesize === 'number' ? ` • ${formatFilesize(doc.filesize)}` : ''
  const dimStr = formatMediaDimensions(doc)

  return (
    <div className="lontar-upload-selected" data-testid="upload-picker-selected">
      {isImage && url && <img src={url} alt={title} className="lontar-upload-thumbnail" />}
      <div className="lontar-upload-selected-info">
        <span className="lontar-upload-selected-title">{title}</span>
        <span className="lontar-upload-meta">
          #{id}
          {filesizeStr}
          {dimStr}
        </span>
      </div>
      <div className="lontar-upload-picker-actions">
        <a
          href={viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="lontar-btn lontar-btn-secondary lontar-btn-sm"
          data-testid="upload-picker-link"
        >
          View ↗
        </a>
        <button
          type="button"
          className="lontar-btn lontar-btn-secondary lontar-btn-sm"
          onClick={onChange}
          data-testid="upload-picker-change"
        >
          Change
        </button>
        <button
          type="button"
          className="lontar-btn lontar-btn-danger lontar-btn-sm"
          onClick={onRemove}
          data-testid="upload-picker-remove"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function MediaOptionRow({
  doc,
  onSelect,
}: {
  doc: Record<string, unknown>
  onSelect: (doc: Record<string, unknown>) => void
}) {
  const id = Number(doc.id)
  const title = getMediaTitle(doc)
  const url = typeof doc.url === 'string' ? doc.url : ''
  const isImage =
    (typeof doc.mimeType === 'string' && doc.mimeType.startsWith('image/')) ||
    url.match(/\.(png|jpe?g|gif|webp|svg)$/i)

  return (
    <button
      key={id}
      type="button"
      className="lontar-upload-option"
      onClick={() => onSelect(doc)}
      data-testid={`upload-option-${id}`}
    >
      {isImage && url && <img src={url} alt="" className="lontar-upload-option-thumb" />}
      <span className="lontar-upload-option-title">{title}</span>
      <span className="lontar-text-muted">#{id}</span>
    </button>
  )
}

function MediaDropdown({
  relationTo,
  apiBase,
  onSelect,
  onCancel,
}: {
  relationTo: string
  apiBase: string
  onSelect: (doc: Record<string, unknown>) => void
  onCancel?: () => void
}) {
  const [searchTerm, setSearchTerm] = useState('')

  const query = useQuery({
    queryKey: ['media-picker-options', relationTo, searchTerm],
    queryFn: () => {
      const trimmed = searchTerm.trim()
      const where = trimmed ? { filename: { contains: trimmed } } : undefined
      return fetchCollectionDocs(apiBase, relationTo, { limit: 20, where })
    },
  })

  return (
    <div className="lontar-upload-dropdown-container">
      <div className="lontar-relationship-search-bar">
        <input
          type="text"
          className="lontar-input"
          placeholder="Search media by filename..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoFocus
          data-testid="upload-picker-search"
        />
        {onCancel && (
          <button
            type="button"
            className="lontar-btn lontar-btn-secondary lontar-btn-sm"
            onClick={onCancel}
            data-testid="upload-picker-cancel-search"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="lontar-upload-dropdown" data-testid="upload-picker-dropdown">
        {query.isLoading && <div className="lontar-relationship-empty">Loading media...</div>}
        {query.isError && (
          <div className="lontar-relationship-empty lontar-error-text">Failed to load media</div>
        )}
        {query.data && query.data.docs.length === 0 && (
          <div className="lontar-relationship-empty">No media files found</div>
        )}
        {query.data?.docs.map((doc) => (
          <MediaOptionRow key={doc.id as number} doc={doc} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

interface EmptyPickerActionsProps {
  onBrowse: () => void
  onUploadFile: (file: File) => void
  isPending: boolean
}

function EmptyPickerActions({ onBrowse, onUploadFile, isPending }: EmptyPickerActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="lontar-upload-picker-empty">
      <button
        type="button"
        className="lontar-btn lontar-btn-secondary lontar-btn-sm"
        onClick={onBrowse}
        data-testid="upload-picker-browse-btn"
      >
        Select from Media
      </button>
      <button
        type="button"
        className="lontar-btn lontar-btn-secondary lontar-btn-sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={isPending}
        data-testid="upload-picker-upload-btn"
      >
        {isPending ? 'Uploading...' : 'Upload New File'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            onUploadFile(file)
          }
        }}
        data-testid="upload-picker-quick-input"
      />
    </div>
  )
}

function useUploadDoc(apiBase: string, relationTo: string, selectedId: number | null) {
  const isEnabled = typeof selectedId === 'number' && selectedId > 0
  return useQuery({
    queryKey: ['collection-doc', relationTo, selectedId],
    queryFn: () => (isEnabled && selectedId ? fetchDoc(apiBase, relationTo, selectedId) : null),
    enabled: isEnabled,
  })
}

function useUploadMutation(apiBase: string, relationTo: string, onUploaded: (id: number) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('alt', file.name)
      return createDoc(apiBase, relationTo, formData)
    },
    onSuccess: (newDoc) => {
      void queryClient.invalidateQueries({ queryKey: [relationTo] })
      onUploaded(Number(newDoc.id))
    },
  })
}

export function UploadPicker({ field, register, setValue, watch }: UploadPickerProps) {
  const adminCtx = useContext(AdminContext)
  const apiBase = adminCtx?.apiBase ?? '/api'
  const basePath = adminCtx?.basePath ?? '/admin'

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedId = extractNumericId(rawValue)
  const [isSearching, setIsSearching] = useState(false)

  const docQuery = useUploadDoc(apiBase, field.relationTo, selectedId)
  const uploadMutation = useUploadMutation(apiBase, field.relationTo, (id) => {
    setValue?.(field.name, id, { shouldValidate: true, shouldDirty: true })
    setIsSearching(false)
  })

  if (selectedId && !isSearching) {
    return (
      <SelectedMediaView
        doc={docQuery.data}
        id={selectedId}
        basePath={basePath}
        relationTo={field.relationTo}
        onChange={() => setIsSearching(true)}
        onRemove={() => setValue?.(field.name, null, { shouldValidate: true, shouldDirty: true })}
      />
    )
  }

  return (
    <div className="lontar-upload-picker">
      {isSearching ? (
        <MediaDropdown
          relationTo={field.relationTo}
          apiBase={apiBase}
          onSelect={(doc) => {
            setValue?.(field.name, Number(doc.id), { shouldValidate: true, shouldDirty: true })
            setIsSearching(false)
          }}
          onCancel={selectedId ? () => setIsSearching(false) : undefined}
        />
      ) : (
        <EmptyPickerActions
          onBrowse={() => setIsSearching(true)}
          onUploadFile={(file) => uploadMutation.mutate(file)}
          isPending={uploadMutation.isPending}
        />
      )}
    </div>
  )
}
