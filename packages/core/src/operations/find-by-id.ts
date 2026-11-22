import { constraintOf, findConstrained, resolveAccess, sanitizeDocRead } from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { Where } from '../query/types'
import { runAfterReadHooks } from '../hooks'
import { populateDoc } from '../populate'
import { AccessDeniedError } from './errors'
import { projectCanonicalDoc, resolveOperationLocale, type ProjectLocaleContext } from './locale'
import { resolveOperationContextCache, type FindByIDOperationArgs } from './types'

// Read access, plus update access for a draft read. A constraint from either limits which
// document may be returned (ADR 0030 §5 to §7).
async function assertFindByIDAccess(
  collection: CollectionConfig,
  config: Config,
  id: number,
  user: AuthUser | null,
  draft?: boolean,
  locale?: string,
): Promise<Where | undefined> {
  const read = await resolveAccess(collection, 'read', { user, id, locale }, config)
  if (!read.allowed) throw new AccessDeniedError('Access denied', { user })
  if (!draft) return constraintOf(read)
  const update = await resolveAccess(collection, 'update', { user, id, locale }, config)
  if (!update.allowed) throw new AccessDeniedError('Access denied', { user })
  return constraintOf(read, update)
}

function isDraftHidden(collection: CollectionConfig, doc: DocumentData, draft?: boolean): boolean {
  return Boolean(collection.versions?.drafts && !draft && doc._status !== 'published')
}

async function hydrateDraftDoc(
  db: Config['db'],
  collection: CollectionConfig,
  parentId: number,
  baseDoc: DocumentData,
  draft?: boolean,
  localeCtx?: ProjectLocaleContext,
): Promise<DocumentData> {
  if (!collection.versions?.drafts) {
    return baseDoc
  }
  const isPublished = baseDoc._status === 'published'
  if (!draft || !db.findLatestDraftVersion) {
    return { ...baseDoc, _isPublished: isPublished }
  }
  const latestDraft = await db.findLatestDraftVersion({ collection, parentId })
  if (latestDraft) {
    const projected = localeCtx
      ? projectCanonicalDoc(latestDraft.snapshot, collection.fields, localeCtx)
      : latestDraft.snapshot
    return { ...projected, _isPublished: isPublished }
  }
  return { ...baseDoc, _isPublished: isPublished }
}

async function finalizeFindByIDDoc<T>(
  args: FindByIDOperationArgs,
  populated: DocumentData | null,
  cache: FieldAccessCache,
  locale?: string,
): Promise<T | null> {
  if (args.overrideAccess || !populated) {
    return populated as T
  }

  const sanitized = await sanitizeDocRead(args.collection.fields, populated, args.user ?? null, {
    id: args.id,
    doc: populated,
    cache,
    req: args.req,
    locale,
  })

  return sanitized as T
}

export async function findByIDOperation<T = DocumentData>(
  args: FindByIDOperationArgs,
): Promise<T | null> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )

  let constraint: Where | undefined
  if (!args.overrideAccess) {
    constraint = await assertFindByIDAccess(
      args.collection,
      args.config,
      args.id,
      args.user ?? null,
      args.draft,
      locale,
    )
  }

  // A document outside the constraint comes back as null, like one that does not exist.
  const doc = await findConstrained({
    config: args.config,
    collection: args.collection,
    id: args.id,
    constraint,
    locale,
    fallbackLocale,
  })
  if (!doc || isDraftHidden(args.collection, doc, args.draft)) {
    return null
  }

  const localeCtx: ProjectLocaleContext | undefined = args.config.localization
    ? {
        locale,
        fallbackLocale,
        defaultLocale: args.config.localization.defaultLocale,
      }
    : undefined

  const rawDoc = await hydrateDraftDoc(
    args.config.db,
    args.collection,
    args.id,
    doc,
    args.draft,
    localeCtx,
  )

  const transformed = await runAfterReadHooks({
    collection: args.collection,
    doc: rawDoc,
    req: args.req,
    locale,
  })

  const cache = resolveOperationContextCache(args)

  const populated = await populateDoc(transformed, {
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

  return finalizeFindByIDDoc<T>(args, populated, cache, locale)
}
