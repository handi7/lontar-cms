import { checkAccess, sanitizeDocRead } from '../access'
import type { AuthUser } from '../auth/types'
import type { DocStatus } from '../client/system-fields'
import type { AccessArgs, CollectionConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import { runAfterDeleteHooks, runBeforeDeleteHooks } from '../hooks'
import { handleUploadDelete } from '../server/routes/collection-upload'
import { dispatchWebhooks } from '../webhooks'
import { AccessDeniedError } from './errors'
import { resolveOperationLocale } from './locale'
import { resolveOperationContextCache, type DeleteOperationArgs } from './types'

async function assertDeleteAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
  locale?: string,
): Promise<void> {
  const accessArgs: AccessArgs = { user: user ?? null, id }
  if (locale !== undefined) {
    accessArgs.locale = locale
  }
  const allowed = await checkAccess(collection.access?.delete, accessArgs)
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function finalizeDeleteDoc<T>(
  args: DeleteOperationArgs,
  finalDoc: DocumentData,
  locale?: string,
): Promise<T> {
  if (args.overrideAccess) {
    return finalDoc as T
  }

  const cache = resolveOperationContextCache(args)
  const sanitized = await sanitizeDocRead(args.collection.fields, finalDoc, args.user ?? null, {
    id: args.id,
    doc: finalDoc,
    cache,
    req: args.req,
    locale,
  })

  return sanitized as T
}

export async function deleteOperation<T = DocumentData>(
  args: DeleteOperationArgs,
): Promise<T | null> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )

  if (!args.overrideAccess) {
    await assertDeleteAccess(args.collection, args.id, args.user, locale)
  }

  const run = async (txDb: DatabaseAdapter): Promise<DocumentData | null> => {
    const docToDelete = await txDb.findByID({
      collection: args.collection,
      id: args.id,
      locale,
      fallbackLocale,
    })
    if (!docToDelete) {
      return null
    }

    await runBeforeDeleteHooks({
      collection: args.collection,
      id: args.id,
      doc: docToDelete,
      status: docToDelete._status as DocStatus | undefined,
      req: args.req,
      locale,
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
      locale,
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
      locale,
    })
  }

  if (postCommitError) {
    throw postCommitError
  }

  return finalizeDeleteDoc<T>(args, finalDoc, locale)
}
