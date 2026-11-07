import { useState, useEffect, useContext, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { ClientConfig, ClientUploadField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { fetchCollectionDocs, fetchDoc, createDoc, formatApiErrorMessage } from '../api/client'
import { Alert } from '../components/ui/alert'
import { cn } from '../lib/utils'
import { formatFilesize } from './FileUploadZone'
import {
  PickerButton,
  PickerCard,
  PickerOption,
  PickerResults,
  PickerSearchBar,
  PickerStatus,
  PickerViewLink,
  pickerActionsClass,
  pickerThumbClass,
  pickerTitleClass,
} from './picker-parts'
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
    <PickerCard className="lt:justify-start" data-testid="upload-picker-selected">
      {isImage && url && (
        <img src={url} alt={title} className={cn(pickerThumbClass, 'lt:size-11')} />
      )}
      <div className="lt:flex lt:min-w-0 lt:flex-1 lt:flex-col lt:gap-0.5">
        <span className={cn(pickerTitleClass, 'lt:text-sm')}>{title}</span>
        <span className="lt:text-xs lt:text-muted-foreground">
          #{id}
          {filesizeStr}
          {dimStr}
        </span>
      </div>
      <div className={pickerActionsClass}>
        <PickerViewLink href={viewUrl} testId="upload-picker-link" />
        <PickerButton onClick={onChange} data-testid="upload-picker-change">
          Change
        </PickerButton>
        <PickerButton destructive onClick={onRemove} data-testid="upload-picker-remove">
          Remove
        </PickerButton>
      </div>
    </PickerCard>
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
    <PickerOption
      key={id}
      className="lt:justify-start"
      onClick={() => onSelect(doc)}
      data-testid={`upload-option-${id}`}
    >
      {isImage && url && <img src={url} alt="" className={cn(pickerThumbClass, 'lt:size-8')} />}
      <span className={cn(pickerTitleClass, 'lt:flex-1 lt:font-normal')}>{title}</span>
      <span className="lt:text-muted-foreground">#{id}</span>
    </PickerOption>
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
    <div className="lt:flex lt:w-full lt:flex-col lt:gap-2">
      <PickerSearchBar
        placeholder="Search media by filename..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        autoFocus
        data-testid="upload-picker-search"
        onCancel={onCancel}
        cancelTestId="upload-picker-cancel-search"
      />
      <PickerResults className="lt:max-h-[240px]" data-testid="upload-picker-dropdown">
        {query.isLoading && <PickerStatus>Loading media...</PickerStatus>}
        {query.isError && <PickerStatus error>Failed to load media</PickerStatus>}
        {query.data && query.data.docs.length === 0 && (
          <PickerStatus>No media files found</PickerStatus>
        )}
        {query.data?.docs.map((doc) => (
          <MediaOptionRow key={doc.id as number} doc={doc} onSelect={onSelect} />
        ))}
      </PickerResults>
    </div>
  )
}

interface EmptyPickerActionsProps {
  onBrowse: () => void
  onUploadFile: (file: File) => void
  isPending: boolean
  accept?: string
  error?: string | null
}

function EmptyPickerActions({
  onBrowse,
  onUploadFile,
  isPending,
  accept,
  error,
}: EmptyPickerActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="lt:flex lt:flex-col lt:items-start lt:gap-2">
      <div className="lt:flex lt:items-center lt:gap-2">
        <PickerButton onClick={onBrowse} data-testid="upload-picker-browse-btn">
          Select from Media
        </PickerButton>
        <PickerButton
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
          data-testid="upload-picker-upload-btn"
        >
          {isPending ? 'Uploading...' : 'Upload New File'}
        </PickerButton>
      </div>
      {error && (
        <Alert
          variant="destructive"
          className="lt:px-3 lt:py-2 lt:text-[0.8125rem]"
          data-testid="upload-picker-error"
        >
          {error}
        </Alert>
      )}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            onUploadFile(file)
          }
          e.target.value = ''
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

function useUploadMutation(
  apiBase: string,
  relationTo: string,
  onUploaded: (id: number) => void,
  onError?: (err: Error) => void,
) {
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
    onError,
  })
}

function getTargetUploadAccept(
  config: ClientConfig | undefined,
  relationTo: string,
): string | undefined {
  const collection = config?.collections.find((c) => c.slug === relationTo)
  if (!collection || typeof collection.upload !== 'object') return undefined
  const mimeTypes = collection.upload?.mimeTypes
  return mimeTypes && mimeTypes.length > 0 ? mimeTypes.join(',') : undefined
}

export function UploadPicker({ field, register, setValue, watch }: UploadPickerProps) {
  const adminCtx = useContext(AdminContext)
  const apiBase = adminCtx?.apiBase ?? '/api'
  const basePath = adminCtx?.basePath ?? '/admin'
  const accept = getTargetUploadAccept(adminCtx?.config, field.relationTo)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedId = extractNumericId(rawValue)

  const docQuery = useUploadDoc(apiBase, field.relationTo, selectedId)
  const uploadMutation = useUploadMutation(
    apiBase,
    field.relationTo,
    (id) => {
      setUploadError(null)
      setValue?.(field.name, id, { shouldValidate: true, shouldDirty: true })
      setIsSearching(false)
    },
    (err) => {
      setUploadError(formatApiErrorMessage(err))
    },
  )

  const handleSelectDoc = (id: number) => {
    setUploadError(null)
    setValue?.(field.name, id, { shouldValidate: true, shouldDirty: true })
    setIsSearching(false)
  }

  const handleRemove = () => {
    setUploadError(null)
    setValue?.(field.name, null, { shouldValidate: true, shouldDirty: true })
  }

  if (selectedId && !isSearching) {
    return (
      <SelectedMediaView
        doc={docQuery.data}
        id={selectedId}
        basePath={basePath}
        relationTo={field.relationTo}
        onChange={() => setIsSearching(true)}
        onRemove={handleRemove}
      />
    )
  }

  return (
    <div className="lt:flex lt:w-full lt:flex-col lt:gap-2">
      {isSearching ? (
        <MediaDropdown
          relationTo={field.relationTo}
          apiBase={apiBase}
          onSelect={(doc) => handleSelectDoc(Number(doc.id))}
          onCancel={() => setIsSearching(false)}
        />
      ) : (
        <EmptyPickerActions
          onBrowse={() => {
            setUploadError(null)
            setIsSearching(true)
          }}
          onUploadFile={(file) => {
            setUploadError(null)
            uploadMutation.mutate(file)
          }}
          isPending={uploadMutation.isPending}
          accept={accept}
          error={uploadError}
        />
      )}
    </div>
  )
}
