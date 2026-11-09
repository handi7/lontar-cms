import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { runAfterReadHooks } from '../hooks'
import { populateDoc } from '../populate'
import { AccessDeniedError } from './errors'
import type { FindByIDOperationArgs } from './types'

async function assertReadAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.read, { user: user ?? null, id })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertFindByIDAccess(
  collection: CollectionConfig,
  id: number,
  user: AuthUser | null,
  draft?: boolean,
): Promise<void> {
  await assertReadAccess(collection, id, user)
  if (draft) {
    const allowed = await checkAccess(collection.access?.update, { user, id })
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

export async function findByIDOperation<T = DocumentData>(
  args: FindByIDOperationArgs,
): Promise<T | null> {
  if (!args.overrideAccess) {
    await assertFindByIDAccess(args.collection, args.id, args.user ?? null, args.draft)
  }

  const doc = await args.config.db.findByID({ collection: args.collection, id: args.id })
  if (!doc || isDraftHidden(args.collection, doc, args.draft)) {
    return null
  }

  const rawDoc = await hydrateDraftDoc(args.config.db, args.collection, args.id, doc, args.draft)

  const transformed = await runAfterReadHooks({
    collection: args.collection,
    doc: rawDoc,
    req: args.req,
  })

  const populated = await populateDoc(transformed, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
  })

  return populated as T
}
