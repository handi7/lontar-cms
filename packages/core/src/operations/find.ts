import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import { DEFAULT_LIMIT, MAX_LIMIT, type CollectionConfig, type Config } from '../config/types'
import type { DocumentData, PaginatedDocs } from '../database/adapter'
import { runAfterReadHooks } from '../hooks'
import { populateDocs } from '../populate'
import type { SortItem, Where } from '../query/types'
import { validateSort, validateWhere } from '../query/validator'
import { AccessDeniedError, ValidationError } from './errors'
import type { FindOperationArgs } from './types'

async function assertReadAccess(
  collection: CollectionConfig,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.read, { user: user ?? null })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

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

function assertValidWhere(where: Where | undefined, collection: CollectionConfig): void {
  if (!where) return
  const issues = validateWhere(where, collection)
  if (issues.length > 0) {
    throw new ValidationError('Validation failed', { issues })
  }
}

function assertValidSort(
  sort: string | SortItem[] | undefined,
  collection: CollectionConfig,
): void {
  if (!sort) return
  const issues = validateSort(sort, collection)
  if (issues.length > 0) {
    throw new ValidationError('Validation failed', { issues })
  }
}

async function assertFindAccess(
  collection: CollectionConfig,
  user: AuthUser | null,
  draft?: boolean,
): Promise<void> {
  await assertReadAccess(collection, user)
  if (draft) {
    const allowed = await checkAccess(collection.access?.update, { user })
    if (!allowed) {
      throw new AccessDeniedError('Access denied', { user })
    }
  }
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

export async function findOperation<T = DocumentData>(
  args: FindOperationArgs,
): Promise<PaginatedDocs<T>> {
  if (!args.overrideAccess) {
    await assertFindAccess(args.collection, args.user ?? null, args.draft)
  }

  const { page, limit } = resolveLimits(args.collection, args.config, args.page, args.limit)
  assertValidWhere(args.where, args.collection)
  assertValidSort(args.sort, args.collection)

  const where = resolveFindWhere(args.collection, args.where, args.draft)

  const result = await args.config.db.find({
    collection: args.collection,
    where,
    sort: args.sort,
    page,
    limit,
  })

  const docs = await Promise.all(
    result.docs.map((doc) =>
      runAfterReadHooks({ collection: args.collection, doc, req: args.req }),
    ),
  )

  const populated = await populateDocs({
    docs,
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
  })

  return { ...result, docs: populated as T[] }
}
