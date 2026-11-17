import { checkAccess, sanitizeDocRead, sanitizeDocWrite } from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection } from '../config/to-client-config'
import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { populateDoc } from '../populate'
import { AccessDeniedError, ValidationError } from './errors'
import {
  executeCreate,
  resolveCreateStatus,
  resolveDraftFlag,
  type MutationExecutionResult,
} from './mutation'
import { runBeforeValidateHooks } from '../hooks'
import { resolveOperationContextCache, type CreateOperationArgs } from './types'

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

async function canPopulateCreateDraft(
  args: CreateOperationArgs,
  docId: unknown,
  draft?: boolean,
): Promise<boolean> {
  if (args.overrideAccess) return true
  if (!draft) return false
  const numericId = typeof docId === 'number' ? docId : Number(docId) || undefined
  return Boolean(
    await checkAccess(args.collection.access?.update, {
      user: args.user ?? null,
      id: numericId,
    }),
  )
}

async function prepareCreateWriteData(
  args: CreateOperationArgs,
  cache: FieldAccessCache,
): Promise<DocumentData> {
  if (args.overrideAccess) return args.data
  return sanitizeDocWrite(args.collection.fields, args.data, 'create', {
    user: args.user ?? null,
    data: args.data,
    cache,
    req: args.req,
  })
}

export async function createOperation<T = DocumentData>(args: CreateOperationArgs): Promise<T> {
  const cache = resolveOperationContextCache(args)

  if (!args.overrideAccess) {
    await assertCreateAccess(args.collection, args.data, args.user)
  }

  const writeData = await prepareCreateWriteData(args, cache)

  const draft = resolveDraftFlag(args.collection, args.draft, args.autosave)
  const { status, statusTransition } = resolveCreateStatus(args.collection, draft)
  const { _status: _ignoredStatus, ...cleanData } = writeData
  const hookData = await runBeforeValidateHooks({
    collection: args.collection,
    data: cleanData,
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
    draft,
    autosave: args.autosave,
    userId: args.user?.id,
    config: args.config,
  })

  const createdDoc = assertCreateResultSuccess(result)
  const canPopulateDraft = await canPopulateCreateDraft(args, createdDoc.id, draft)

  const populated = await populateDoc(createdDoc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: canPopulateDraft,
    cache,
  })

  if (args.overrideAccess) {
    return populated as T
  }

  const sanitized = await sanitizeDocRead(args.collection.fields, populated, args.user ?? null, {
    id: createdDoc.id as string | number | undefined,
    doc: populated,
    cache,
    req: args.req,
  })

  return sanitized as T
}
