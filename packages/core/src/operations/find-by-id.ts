import { checkAccess, sanitizeDocRead } from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { runAfterReadHooks } from '../hooks'
import { populateDoc } from '../populate'
import { AccessDeniedError } from './errors'
import { resolveOperationLocale } from './locale'
import { resolveOperationContextCache, type FindByIDOperationArgs } from './types'

async function assertReadAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
  locale?: string,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.read, { user: user ?? null, id, locale })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertFindByIDAccess(
  collection: CollectionConfig,
  id: number,
  user: AuthUser | null,
  draft?: boolean,
  locale?: string,
): Promise<void> {
  await assertReadAccess(collection, id, user, locale)
  if (draft) {
    const allowed = await checkAccess(collection.access?.update, { user, id, locale })
    if (!allowed) {
      throw new AccessDeniedError('Access denied', { user })
    }
  }
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
    return { ...latestDraft.snapshot, _isPublished: isPublished }
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

  if (!args.overrideAccess) {
    await assertFindByIDAccess(args.collection, args.id, args.user ?? null, args.draft, locale)
  }

  const doc = await args.config.db.findByID({
    collection: args.collection,
    id: args.id,
    locale,
    fallbackLocale,
  })
  if (!doc || isDraftHidden(args.collection, doc, args.draft)) {
    return null
  }

  const rawDoc = await hydrateDraftDoc(args.config.db, args.collection, args.id, doc, args.draft)

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
