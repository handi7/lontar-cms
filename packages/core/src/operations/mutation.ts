import { sanitizeConditionalFields } from '../client/condition'
import type { DocStatus } from '../client/system-fields'
import { toClientCollection, toClientGlobal } from '../config/to-client-config'
import type { CollectionConfig, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData, StoredDoc } from '../database/adapter'
import { formatUniqueConstraintError, UniqueConstraintError } from '../database/errors'
import { runAfterChangeHooks, runBeforeChangeHooks } from '../hooks'
import type { DocStatusTransition } from '../hooks/types'

export type MutationExecutionResult =
  | { success: true; doc: DocumentData }
  | { success: false; status: 400 | 404; body: { error: string; issues?: unknown[] } }

export function buildRevertData(
  originalDoc: DocumentData,
  appliedData: DocumentData,
): DocumentData {
  const revertData: DocumentData = { ...originalDoc }
  for (const key of Object.keys(appliedData)) {
    if (!(key in revertData)) {
      revertData[key] = null
    }
  }
  return revertData
}

function resolveCreateStatus(
  collection: CollectionConfig,
  data: DocumentData,
  draft?: boolean,
): { status: DocStatus | undefined; statusTransition: DocStatusTransition | undefined } {
  if (!collection.versions?.drafts) {
    return { status: undefined, statusTransition: undefined }
  }
  const status = (data._status as DocStatus | undefined) ?? (draft ? 'draft' : 'published')
  const statusTransition: DocStatusTransition = status === 'published' ? 'published' : 'draft'
  return { status, statusTransition }
}

async function compensateCreate(
  txDb: DatabaseAdapter,
  collection: CollectionConfig,
  id: number,
): Promise<void> {
  try {
    await txDb.delete({ collection, id })
  } catch {
    // Non-fatal compensation error
  }
}

export async function executeCreate(args: {
  collection: CollectionConfig
  db: DatabaseAdapter
  data: DocumentData
  req?: Request
  draft?: boolean
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const initialData = sanitizeConditionalFields(clientCol.fields, args.data)
    const { status, statusTransition } = resolveCreateStatus(args.collection, args.data, args.draft)
    if (status !== undefined) {
      initialData._status = status
    }
    const data = await runBeforeChangeHooks({
      collection: args.collection,
      data: initialData,
      operation: 'create',
      status,
      previousStatus: undefined,
      statusTransition,
      req: args.req,
    })
    const finalData = sanitizeConditionalFields(clientCol.fields, data)
    if (args.collection.versions?.drafts) {
      finalData._status = data._status ?? status
    }
    const created = await txDb.create({ collection: args.collection, data: finalData })
    try {
      const doc = await runAfterChangeHooks({
        collection: args.collection,
        doc: created,
        operation: 'create',
        status: (created._status as DocStatus | undefined) ?? status,
        previousStatus: undefined,
        statusTransition,
        req: args.req,
      })
      return { success: true, doc }
    } catch (hookErr) {
      if (!args.db.transaction) {
        await compensateCreate(txDb, args.collection, created.id)
      }
      throw hookErr
    }
  }

  try {
    if (args.db.transaction) {
      return await args.db.transaction(run)
    }
    return await run(args.db)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }
}

function resolveUpdateStatusTransition(
  previousStatus: DocStatus,
  status: DocStatus,
  explicitTransition?: DocStatusTransition,
): DocStatusTransition {
  if (explicitTransition) return explicitTransition
  if (previousStatus === 'draft' && status === 'published') return 'publish'
  if (previousStatus === 'published' && status === 'draft') return 'unpublish'
  return status === 'published' ? 'published' : 'draft'
}

function resolveUpdateStatus(args: {
  collection: CollectionConfig
  data: DocumentData
  originalDoc: DocumentData
  draft?: boolean
  status?: DocStatus
  statusTransition?: DocStatusTransition
}): {
  status: DocStatus | undefined
  previousStatus: DocStatus | undefined
  statusTransition: DocStatusTransition | undefined
} {
  if (!args.collection.versions?.drafts) {
    return { status: undefined, previousStatus: undefined, statusTransition: undefined }
  }
  const previousStatus = (args.originalDoc._status as DocStatus | undefined) ?? 'published'
  const fallback = args.draft !== undefined ? (args.draft ? 'draft' : 'published') : previousStatus
  const status = args.status ?? (args.data._status as DocStatus | undefined) ?? fallback
  const statusTransition = resolveUpdateStatusTransition(
    previousStatus,
    status,
    args.statusTransition,
  )
  return { status, previousStatus, statusTransition }
}

async function compensateUpdate(
  txDb: DatabaseAdapter,
  collection: CollectionConfig,
  id: number,
  originalDoc: DocumentData,
  data: DocumentData,
): Promise<void> {
  try {
    await txDb.update({
      collection,
      id,
      data: buildRevertData(originalDoc, data),
    })
  } catch {
    // Non-fatal compensation error
  }
}

export async function executeUpdate(args: {
  collection: CollectionConfig
  db: DatabaseAdapter
  id: number
  originalDoc: DocumentData
  data: DocumentData
  req?: Request
  draft?: boolean
  status?: DocStatus
  statusTransition?: DocStatusTransition
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const initialData = sanitizeConditionalFields(clientCol.fields, args.data, args.originalDoc)
    const { status, previousStatus, statusTransition } = resolveUpdateStatus(args)
    if (status !== undefined) {
      initialData._status = status
    }
    const data = await runBeforeChangeHooks({
      collection: args.collection,
      data: initialData,
      operation: 'update',
      originalDoc: args.originalDoc,
      status,
      previousStatus,
      statusTransition,
      req: args.req,
    })
    const finalData = sanitizeConditionalFields(clientCol.fields, data, args.originalDoc)
    if (args.collection.versions?.drafts) {
      finalData._status = data._status ?? status
    }
    const updated = await txDb.update({ collection: args.collection, id: args.id, data: finalData })
    if (!updated) {
      return {
        success: false,
        status: 404,
        body: { error: `Document with ID ${args.id} not found` },
      }
    }
    try {
      const doc = await runAfterChangeHooks({
        collection: args.collection,
        doc: updated,
        operation: 'update',
        previousDoc: args.originalDoc,
        status: (updated._status as DocStatus | undefined) ?? status,
        previousStatus,
        statusTransition,
        req: args.req,
      })
      return { success: true, doc }
    } catch (hookErr) {
      if (!args.db.transaction) {
        await compensateUpdate(txDb, args.collection, args.id, args.originalDoc, data)
      }
      throw hookErr
    }
  }

  try {
    if (args.db.transaction) {
      return await args.db.transaction(run)
    }
    return await run(args.db)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }
}

export async function executeGlobalUpdate(args: {
  global: GlobalConfig
  db: DatabaseAdapter
  existing: StoredDoc | null
  data: DocumentData
  req?: Request
}): Promise<MutationExecutionResult> {
  const clientGlobal = toClientGlobal(args.global)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const operation = args.existing ? 'update' : 'create'
    const initialData = sanitizeConditionalFields(
      clientGlobal.fields,
      args.data,
      args.existing ?? undefined,
    )
    const data = await runBeforeChangeHooks({
      global: args.global,
      data: initialData,
      operation,
      originalDoc: args.existing ?? undefined,
      req: args.req,
    })
    const finalData = sanitizeConditionalFields(
      clientGlobal.fields,
      data,
      args.existing ?? undefined,
    )
    const saved = await txDb.updateGlobal({ global: args.global, data: finalData })
    const doc = await runAfterChangeHooks({
      global: args.global,
      doc: saved,
      operation,
      previousDoc: args.existing ?? undefined,
      req: args.req,
    })
    return { success: true, doc }
  }

  try {
    if (args.db.transaction) {
      return await args.db.transaction(run)
    }
    return await run(args.db)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }
}
