import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { handleUploadDelete } from '../server/routes/collection-upload'
import { AccessDeniedError } from './errors'
import type { DeleteOperationArgs } from './types'

async function assertDeleteAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.delete, { user: user ?? null, id })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

export async function deleteOperation<T = DocumentData>(
  args: DeleteOperationArgs,
): Promise<T | null> {
  if (!args.overrideAccess) {
    await assertDeleteAccess(args.collection, args.id, args.user)
  }

  const originalDoc = args.collection.upload
    ? await args.config.db.findByID({ collection: args.collection, id: args.id })
    : null

  const doc = await args.config.db.delete({ collection: args.collection, id: args.id })
  if (!doc) {
    return null
  }

  if (originalDoc) {
    await handleUploadDelete(args.collection, args.config, originalDoc)
  }

  return doc as T
}
