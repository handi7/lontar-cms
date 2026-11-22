import type { Where } from '@lontar/core/client'

export type MimeGroup = 'images' | 'video' | 'audio' | 'documents' | 'other'
export type ListViewMode = 'table' | 'grid'

export const MIME_GROUPS: ReadonlyArray<{ value: MimeGroup; label: string }> = [
  { value: 'images', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'documents', label: 'Documents' },
  { value: 'other', label: 'Other' },
]

const MIME_GROUP_VALUES = new Set<string>(MIME_GROUPS.map((g) => g.value))

export function isMimeGroup(value: unknown): value is MimeGroup {
  return typeof value === 'string' && MIME_GROUP_VALUES.has(value)
}

// The query language has `contains` and `in` but no prefix match or negation, so "documents" and
// "other" name the common types instead of being everything left over.
const DOCUMENT_TYPES = [
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument',
  'application/vnd.openxmlformats-officedocument',
  'text/',
]
const OTHER_TYPES = [
  'application/octet-stream',
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/json',
  'application/xml',
]

/** The `where` clause that keeps one group of MIME types. */
export function mimeGroupWhere(group: MimeGroup): Where {
  switch (group) {
    case 'images':
      return { mimeType: { contains: 'image/' } }
    case 'video':
      return { mimeType: { contains: 'video/' } }
    case 'audio':
      return { mimeType: { contains: 'audio/' } }
    case 'documents':
      return { or: DOCUMENT_TYPES.map((type) => ({ mimeType: { contains: type } })) }
    case 'other':
      return { mimeType: { in: OTHER_TYPES } }
  }
}

/** Which group decides a file's icon. Anything that is not clearly one of the first four is "other". */
export function mimeGroupOf(mimeType: unknown): MimeGroup {
  if (typeof mimeType !== 'string') return 'other'
  if (mimeType.startsWith('image/')) return 'images'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (DOCUMENT_TYPES.some((type) => mimeType.includes(type))) {
    return 'documents'
  }
  return 'other'
}

function sizeUrl(size: unknown): string | undefined {
  if (!size || typeof size !== 'object') return undefined
  const { url } = size as { url?: unknown }
  return typeof url === 'string' && url ? url : undefined
}

function generatedUrl(sizes: unknown): string | undefined {
  if (!sizes || typeof sizes !== 'object') return undefined
  const generated = sizes as Record<string, unknown>
  const preferred = sizeUrl(generated.thumb)
  if (preferred) return preferred
  return Object.values(generated).map(sizeUrl).find(Boolean)
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif)$/i

/** A small image to show for a document: `thumb`, else any generated size, else the original. */
export function thumbnailUrl(doc: Record<string, unknown>): string | undefined {
  const url = typeof doc.url === 'string' && doc.url ? doc.url : undefined
  const isImage = mimeGroupOf(doc.mimeType) === 'images' || IMAGE_EXTENSION.test(url ?? '')
  return isImage ? (generatedUrl(doc.sizes) ?? url) : undefined
}

export function formatFileSize(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

export function formatDimensions(doc: Record<string, unknown>): string | undefined {
  const { width, height } = doc
  return typeof width === 'number' && typeof height === 'number'
    ? `${width} × ${height}`
    : undefined
}

const VIEW_PREFIX = 'lontar-admin-list-view'

export function viewModeStorageKey(userId: string | null, slug: string): string {
  return `${VIEW_PREFIX}:${userId ?? 'anonymous'}:${slug}`
}

export function readStoredViewMode(storageKey: string): ListViewMode | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw === 'grid' || raw === 'table' ? raw : null
  } catch {
    return null
  }
}

export function writeStoredViewMode(storageKey: string, mode: ListViewMode): void {
  try {
    window.localStorage.setItem(storageKey, mode)
  } catch {
    // The choice still applies for this session.
  }
}

export function mediaName(doc: Record<string, unknown>): string {
  if (typeof doc.filename === 'string' && doc.filename) return doc.filename
  return `#${String(doc.id)}`
}
