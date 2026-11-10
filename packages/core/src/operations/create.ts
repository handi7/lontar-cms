import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection } from '../config/to-client-config'
import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { populateDoc } from '../populate'
import { AccessDeniedError, ValidationError } from './errors'
import { executeCreate, resolveCreateStatus, type MutationExecutionResult } from './mutation'
import { runBeforeValidateHooks } from '../hooks'
import type { CreateOperationArgs } from './types'

async function assertCreateAccess(
  collection: CollectionConfig,
  data: DocumentData,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.create, { user: user ?? null, data })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateCreateData(collection: CollectionConfig, data: DocumentData): DocumentData {
  const clientCol = toClientCollection(collection)
  const schema = clientFieldsToZod(clientCol.fields)
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

function assertCreateResultSuccess(result: MutationExecutionResult): DocumentData {
  if (!result.success) {
    if (result.status === 400 && 'issues' in result.body) {
      throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
    }
    throw new Error(result.body.error ?? 'Create failed')
  }
  return result.doc
}

async function canPopulateCreateDraft(args: CreateOperationArgs, docId: unknown): Promise<boolean> {
  if (args.overrideAccess) return true
  if (!args.draft) return false
  const numericId = typeof docId === 'number' ? docId : Number(docId) || undefined
  return Boolean(
    await checkAccess(args.collection.access?.update, {
      user: args.user ?? null,
      id: numericId,
    }),
  )
}

export async function createOperation<T = DocumentData>(args: CreateOperationArgs): Promise<T> {
  if (!args.overrideAccess) {
    await assertCreateAccess(args.collection, args.data, args.user)
  }

  const { status, statusTransition } = resolveCreateStatus(args.collection, args.data, args.draft)
  const hookData = await runBeforeValidateHooks({
    collection: args.collection,
    data: args.data,
    operation: 'create',
    status,
    previousStatus: undefined,
    statusTransition,
    req: args.req,
  })

  const validatedData = validateCreateData(args.collection, hookData)

  const result = await executeCreate({
    collection: args.collection,
    data: validatedData,
    db: args.config.db,
    req: args.req,
    draft: args.draft,
    autosave: args.autosave,
    userId: args.user?.id,
    config: args.config,
  })

  const createdDoc = assertCreateResultSuccess(result)
  const canPopulateDraft = await canPopulateCreateDraft(args, createdDoc.id)

  const populated = await populateDoc(createdDoc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: canPopulateDraft,
  })

  return populated as T
}
