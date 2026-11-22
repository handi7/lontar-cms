import type { AuthUser } from '../auth/types'
import type { SearchResult } from '../client'
import type { CollectionConfig, Config } from '../config/types'
import type { Field } from '../fields/types'
import { AccessDeniedError, ValidationError } from './errors'
import { findOperation } from './find'
import { resolveOperationLocale } from './locale'

export const SEARCH_LIMIT_PER_COLLECTION = 5
export const SEARCH_LIMIT_TOTAL = 20
export const SEARCH_MAX_QUERY_LENGTH = 200

const TITLE_FIELD_TYPES = new Set<Field['type']>(['text', 'email', 'slug', 'textarea'])

/**
 * The field a collection is searched and labelled by: `admin.useAsTitle`, else its first text-like
 * field, else `filename` for an upload collection. A collection without one is not searchable.
 */
export function resolveSearchTitleField(collection: CollectionConfig): string | undefined {
  const named = collection.admin?.useAsTitle
  if (named) {
    const field = collection.fields[named]
    if (field) return TITLE_FIELD_TYPES.has(field.type) ? named : undefined
    return collection.upload && named === 'filename' ? named : undefined
  }
  const textLike = Object.entries(collection.fields).find(([, f]) => TITLE_FIELD_TYPES.has(f.type))
  if (textLike) return textLike[0]
  return collection.upload ? 'filename' : undefined
}

export interface SearchOperationArgs {
  config: Config
  user: AuthUser | null
  q: string
  req?: Request
  locale?: string
}

function toResult(
  collection: CollectionConfig,
  titleField: string,
  doc: Record<string, unknown>,
): SearchResult {
  const raw = doc[titleField]
  const id = doc.id as number
  const status = doc._status
  return {
    id,
    title: typeof raw === 'string' && raw !== '' ? raw : `#${String(id)}`,
    collection: collection.slug,
    ...(collection.versions?.drafts && (status === 'draft' || status === 'published')
      ? { status: status }
      : {}),
  }
}

async function searchCollection(
  args: SearchOperationArgs,
  collection: CollectionConfig,
  locale: string | undefined,
): Promise<SearchResult[]> {
  const titleField = resolveSearchTitleField(collection)
  if (!titleField) return []
  try {
    const result = await findOperation({
      config: args.config,
      collection,
      where: { [titleField]: { contains: args.q } },
      limit: SEARCH_LIMIT_PER_COLLECTION,
      depth: 0,
      overrideAccess: false,
      user: args.user,
      req: args.req,
      locale,
    })
    return result.docs.map((doc) => toResult(collection, titleField, doc))
  } catch (err) {
    // An unreadable collection, or a title field the user may not query, drops out of the results
    // the same way it does from the admin: failing closed, without saying why.
    if (err instanceof AccessDeniedError || err instanceof ValidationError) return []
    throw err
  }
}

/**
 * Searches every readable collection by its title field. Reads go through `findOperation` with
 * access enforced, so collection access, field access on the title, drafts and locale behave as they
 * do for a normal list request, and the adapter escapes `contains`.
 */
export async function searchOperation(args: SearchOperationArgs): Promise<SearchResult[]> {
  const q = args.q.trim().slice(0, SEARCH_MAX_QUERY_LENGTH)
  // Throws a ValidationError for an unknown locale before any collection is touched.
  const { locale } = resolveOperationLocale(args.config, args.locale)
  if (q === '') return []

  const perCollection = await Promise.all(
    (args.config.collections ?? []).map((collection) =>
      searchCollection({ ...args, q }, collection, locale),
    ),
  )
  return perCollection.flat().slice(0, SEARCH_LIMIT_TOTAL)
}
