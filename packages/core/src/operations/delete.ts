import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { DocStatus } from '../client/system-fields'
import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import { runAfterDeleteHooks, runBeforeDeleteHooks } from '../hooks'
import { handleUploadDelete } from '../server/routes/collection-upload'
import { dispatchWebhooks } from '../webhooks'
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

  const run = async (txDb: DatabaseAdapter): Promise<DocumentData | null> => {
    const docToDelete = await txDb.findByID({ collection: args.collection, id: args.id })
    if (!docToDelete) {
      return null
    }

    await runBeforeDeleteHooks({
      collection: args.collection,
      id: args.id,
      doc: docToDelete,
      status: docToDelete._status as DocStatus | undefined,
      req: args.req,
    })

    const deleted = await txDb.delete({ collection: args.collection, id: args.id })
    if (!deleted) {
      return null
    }

    return docToDelete
  }

  const deletedDoc = args.config.db.transaction
    ? await args.config.db.transaction(run)
    : await run(args.config.db)

  if (!deletedDoc) {
    return null
  }

  let finalDoc: DocumentData = deletedDoc
  let postCommitError: Error | null = null

  try {
    if (args.collection.upload) {
      await handleUploadDelete(args.collection, args.config, deletedDoc)
    }

    finalDoc = await runAfterDeleteHooks({
      collection: args.collection,
      id: args.id,
      doc: deletedDoc,
      status: deletedDoc._status as DocStatus | undefined,
      req: args.req,
    })
  } catch (err) {
    postCommitError =
      err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Delete hook failed')
  } finally {
    void dispatchWebhooks({
      config: args.config,
      collection: args.collection,
      event: 'delete',
      doc: finalDoc,
      status: deletedDoc._status as DocStatus | undefined,
    })
  }

  if (postCommitError) {
    throw postCommitError
  }

  return finalDoc as T
}
