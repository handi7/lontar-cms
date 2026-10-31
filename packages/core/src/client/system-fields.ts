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
