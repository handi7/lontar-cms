import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection } from '../config/to-client-config'
import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { populateDoc } from '../populate'
import { AccessDeniedError, NotFoundError, ValidationError } from './errors'
import {
  executeUpdate,
  resolveDraftFlag,
  resolveOriginalDoc,
  resolveUpdateStatus,
} from './mutation'
import { cleanupReplacedMedia } from '../server/routes/collection-upload'
import { runBeforeValidateHooks } from '../hooks'
import type { UpdateOperationArgs } from './types'

async function assertUpdateAccess(
  collection: CollectionConfig,
  id: number,
  data: DocumentData,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.update, { user: user ?? null, id, data })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateUpdateData(
  collection: CollectionConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
): DocumentData {
  const clientCol = toClientCollection(collection)
  const partialSchema = clientFieldsToZod(clientCol.fields, { partial: true, originalDoc })
  const parsed = partialSchema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

function handleUpdateError(
  result: { success: false; status: number; body: Record<string, unknown> },
  id: number,
): never {
  if (result.status === 400 && 'issues' in result.body) {
    throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
  }
  if (result.status === 404) {
    const errorMsg =
      typeof result.body.error === 'string' ? result.body.error : `Document with ID ${id} not found`
    throw new NotFoundError(errorMsg)
  }
  const fallback = typeof result.body.error === 'string' ? result.body.error : 'Update failed'
  throw new Error(fallback)
}

export async function updateOperation<T = DocumentData>(args: UpdateOperationArgs): Promise<T> {
  if (!args.overrideAccess) {
    await assertUpdateAccess(args.collection, args.id, args.data, args.user)
  }

  const draft = resolveDraftFlag(args.collection, args.draft, args.autosave)
  const originalDoc = await resolveOriginalDoc(args.config.db, args.collection, args.id, draft)
  if (!originalDoc) {
    throw new NotFoundError(`Document with ID ${args.id} not found`)
  }

  const { _status: _ignoredStatus, ...cleanData } = args.data
  const { status, previousStatus, statusTransition } = resolveUpdateStatus({
    collection: args.collection,
    data: cleanData,
    originalDoc,
    draft,
  })

  const hookData = await runBeforeValidateHooks({
    collection: args.collection,
    data: cleanData,
    operation: 'update',
    originalDoc,
    status,
    previousStatus,
    statusTransition,
    req: args.req,
  })

  const validatedData = validateUpdateData(args.collection, hookData, originalDoc)

  const result = await executeUpdate({
    collection: args.collection,
    id: args.id,
    data: validatedData,
    originalDoc,
    db: args.config.db,
    req: args.req,
    draft,
    status,
    statusTransition,
    autosave: args.autosave,
    userId: args.user?.id,
    config: args.config,
  })

  if (!result.success) {
    handleUpdateError(result, args.id)
  }

  const isDraftUpdate = status === 'draft' || Boolean(result.isDraftRevision)
  if (args.collection.upload && !isDraftUpdate) {
    await cleanupReplacedMedia(args.config, originalDoc, result.doc)
  }

  const populated = await populateDoc(result.doc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft,
  })

  return populated as T
}
