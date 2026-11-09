/**
 * Fields every document has, set by the engine rather than declared in config.
 * See docs/adr/0004-system-fields.md and docs/adr/0023-version-storage-and-drafts.md.
 */
export const BASE_SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt'] as const
export const DRAFT_SYSTEM_FIELDS = ['_status'] as const
export const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt', '_status'] as const

export type SystemFieldName = (typeof SYSTEM_FIELDS)[number]

export interface SystemFields {
  id: number
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601. */
  updatedAt: string
}

export const DOC_STATUSES = ['draft', 'published'] as const
export type DocStatus = (typeof DOC_STATUSES)[number]

export interface DraftSystemFields {
  _status: DocStatus
  _isPublished?: boolean
}

export const UPLOAD_SYSTEM_FIELDS = [
  'filename',
  'url',
  'mimeType',
  'filesize',
  'width',
  'height',
  'sizes',
] as const

export type UploadSystemFieldName = (typeof UPLOAD_SYSTEM_FIELDS)[number]

export interface UploadSystemFields {
  filename: string
  url: string
  mimeType: string
  filesize: number
  width?: number | null
  height?: number | null
  sizes?: Record<string, unknown> | null
}

export interface ClientVersion {
  id: number
  parentId: number
  versionNumber: number
  snapshot: Record<string, unknown>
  _status: DocStatus
  autosave: boolean
  createdAt: string
  createdBy: string | null
}

export interface ClientPaginatedVersions {
  docs: ClientVersion[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
}
