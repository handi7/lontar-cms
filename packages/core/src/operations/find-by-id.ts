import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig } from '../config/types'
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

export async function findByIDOperation<T = DocumentData>(
  args: FindByIDOperationArgs,
): Promise<T | null> {
  if (!args.overrideAccess) {
    await assertReadAccess(args.collection, args.id, args.user)
  }

  const doc = await args.config.db.findByID({ collection: args.collection, id: args.id })
  if (!doc) {
    return null
  }

  const transformed = await runAfterReadHooks({
    collection: args.collection,
    doc,
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
  })

  return populated as T
}
