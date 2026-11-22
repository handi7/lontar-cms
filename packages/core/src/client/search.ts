import type { DocStatus } from './system-fields'

/** One hit from `GET /api/_lontar/search`. */
export interface SearchResult {
  id: number
  /** The collection's title field, or `#<id>` when it is empty. */
  title: string
  /** Slug of the collection the document is in. */
  collection: string
  /** Only for a collection with drafts. */
  status?: DocStatus
}
