/**
 * Fields every document has, set by the engine rather than declared in config.
 * See docs/adr/0004-system-fields.md.
 */
export const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt'] as const

export type SystemFieldName = (typeof SYSTEM_FIELDS)[number]

export interface SystemFields {
  id: number
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601. */
  updatedAt: string
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
