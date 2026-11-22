import {
  combineWhere,
  constraintOf,
  resolveAccess,
  sanitizeDocRead,
  validateQueryAccess,
} from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import { DEFAULT_LIMIT, MAX_LIMIT, type CollectionConfig, type Config } from '../config/types'
import type { DocumentData, PaginatedDocs } from '../database/adapter'
import { runAfterReadHooks } from '../hooks'
import { populateDocs } from '../populate'
import type { SortItem, Where } from '../query/types'
import { validateSort, validateWhere } from '../query/validator'
import { AccessDeniedError, ValidationError } from './errors'
import { projectCanonicalDoc, resolveOperationLocale, type ProjectLocaleContext } from './locale'
import { resolveOperationContextCache, type FindOperationArgs } from './types'

function resolveDefaultLimit(collection: CollectionConfig, config: Config): number {
  return collection.pagination?.defaultLimit ?? config.pagination?.defaultLimit ?? DEFAULT_LIMIT
}

function resolveMaxLimit(collection: CollectionConfig, config: Config): number {
  return collection.pagination?.maxLimit ?? config.pagination?.maxLimit ?? MAX_LIMIT
}

function resolveLimit(collection: CollectionConfig, config: Config, limit?: number): number {
  const defaultLimit = resolveDefaultLimit(collection, config)
  const maxLimit = resolveMaxLimit(collection, config)
  const parsed = typeof limit === 'number' && limit > 0 ? limit : defaultLimit
  return Math.min(parsed, maxLimit)
}

function resolvePage(page?: number): number {
  return typeof page === 'number' && page > 0 ? page : 1
}

function resolveLimits(
  collection: CollectionConfig,
  config: Config,
  page?: number,
  limit?: number,
): { page: number; limit: number } {
  return {
    page: resolvePage(page),
    limit: resolveLimit(collection, config, limit),
  }
}

function assertValidWhere(
  where: Where | undefined,
  collection: CollectionConfig,
  config: Config,
): void {
  if (!where) return
  const issues = validateWhere(where, collection, config.localization)
  if (issues.length > 0) {
    throw new ValidationError('Validation failed', { issues })
  }
}

function assertValidSort(
  sort: string | SortItem[] | undefined,
  collection: CollectionConfig,
  config: Config,
): void {
  if (!sort) return
  const issues = validateSort(sort, collection, config.localization)
  if (issues.length > 0) {
    throw new ValidationError('Validation failed', { issues })
  }
}

async function assertValidQueryAccess(
  where: Where | undefined,
  sort: string | SortItem[] | undefined,
  collection: CollectionConfig,
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
): Promise<void> {
  const issues = await validateQueryAccess(where, sort, collection, user, { cache, req })
  if (issues.length > 0) {
    throw new ValidationError('Validation failed', { issues })
  }
}

// Read access, plus update access for a draft read (ADR 0030 §7). A constraint from either is
// returned so the query is limited to the rows both allow.
async function assertFindAccess(
  collection: CollectionConfig,
  config: Config,
  user: AuthUser | null,
  draft?: boolean,
  locale?: string,
): Promise<Where | undefined> {
  const read = await resolveAccess(collection, 'read', { user, locale }, config)
  if (!read.allowed) throw new AccessDeniedError('Access denied', { user })
  if (!draft) return constraintOf(read)
  const update = await resolveAccess(collection, 'update', { user, locale }, config)
  if (!update.allowed) throw new AccessDeniedError('Access denied', { user })
  return constraintOf(read, update)
}

function resolveFindWhere(
  collection: CollectionConfig,
  where?: Where,
  draft?: boolean,
): Where | undefined {
  if (collection.versions?.drafts && !draft) {
    const publishedFilter: Where = { _status: { equals: 'published' } }
    return where ? { and: [where, publishedFilter] } : publishedFilter
  }
  return where
}

async function hydrateDraftDocs(
  db: Config['db'],
  collection: CollectionConfig,
  docs: DocumentData[],
  draft?: boolean,
  localeCtx?: ProjectLocaleContext,
): Promise<DocumentData[]> {
  if (!collection.versions?.drafts) {
    return docs
  }
  return Promise.all(
    docs.map(async (doc) => {
      const isPublished = doc._status === 'published'
      if (!draft || !db.findLatestDraftVersion) {
        return { ...doc, _isPublished: isPublished }
      }
      const latestDraft = await db.findLatestDraftVersion({
        collection,
        parentId: Number(doc.id),
      })
      if (latestDraft) {
        const projected = localeCtx
          ? projectCanonicalDoc(latestDraft.snapshot, collection.fields, localeCtx)
          : latestDraft.snapshot
        return { ...projected, _isPublished: isPublished }
      }
      return { ...doc, _isPublished: isPublished }
    }),
  )
}

export async function findOperation<T = DocumentData>(
  args: FindOperationArgs,
): Promise<PaginatedDocs<T>> {
  const cache = resolveOperationContextCache(args)
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )

  let constraint: Where | undefined
  if (!args.overrideAccess) {
    constraint = await assertFindAccess(
      args.collection,
      args.config,
      args.user ?? null,
      args.draft,
      locale,
    )
    await assertValidQueryAccess(
      args.where,
      args.sort,
      args.collection,
      args.user ?? null,
      cache,
      args.req,
    )
  }

  const { page, limit } = resolveLimits(args.collection, args.config, args.page, args.limit)
  assertValidWhere(args.where, args.collection, args.config)
  assertValidSort(args.sort, args.collection, args.config)

  const where = combineWhere(resolveFindWhere(args.collection, args.where, args.draft), constraint)

  const result = await args.config.db.find({
    collection: args.collection,
    where,
    sort: args.sort,
    page,
    limit,
    locale,
    fallbackLocale,
  })

  const localeCtx: ProjectLocaleContext | undefined = args.config.localization
    ? {
        locale,
        fallbackLocale,
        defaultLocale: args.config.localization.defaultLocale,
      }
    : undefined

  const rawDocs = await hydrateDraftDocs(
    args.config.db,
    args.collection,
    result.docs,
    args.draft,
    localeCtx,
  )

  const docs = await Promise.all(
    rawDocs.map((doc) =>
      runAfterReadHooks({ collection: args.collection, doc, req: args.req, locale }),
    ),
  )

  const populated = await populateDocs({
    docs,
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    localization: args.config.localization,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
    cache,
    locale,
    fallbackLocale,
  })

  const docsToReturn = args.overrideAccess
    ? populated
    : await Promise.all(
        populated.map((doc) =>
          sanitizeDocRead(args.collection.fields, doc, args.user ?? null, {
            id: doc.id as string | number | undefined,
            doc,
            cache,
            req: args.req,
            locale,
          }),
        ),
      )

  return { ...result, docs: docsToReturn as T[] }
}
