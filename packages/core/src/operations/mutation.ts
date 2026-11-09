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

export function resolveCreateStatus(
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

async function maybeSaveVersion(args: {
  txDb: DatabaseAdapter
  collection: CollectionConfig
  parentId: number
  snapshot: DocumentData
  status: DocStatus
  autosave?: boolean
  userId?: string | null
}): Promise<void> {
  if (!args.collection.versions || !args.txDb.saveVersion) return
  await args.txDb.saveVersion({
    collection: args.collection,
    parentId: args.parentId,
    snapshot: args.snapshot,
    status: args.status,
    autosave: args.autosave,
    userId: args.userId,
  })
}

function isDraftRevisionOfPublished(
  collection: CollectionConfig,
  originalDoc: DocumentData,
  status?: DocStatus,
  statusTransition?: DocStatusTransition,
): boolean {
  return Boolean(
    collection.versions?.drafts &&
    originalDoc._status === 'published' &&
    status === 'draft' &&
    statusTransition !== 'unpublish',
  )
}

function buildDraftRevisionDoc(
  id: number,
  originalDoc: DocumentData,
  finalData: DocumentData,
): DocumentData {
  return {
    ...originalDoc,
    ...finalData,
    id,
    _status: 'draft',
    updatedAt: new Date().toISOString(),
  }
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
  autosave?: boolean
  userId?: string | null
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
    await maybeSaveVersion({
      txDb,
      collection: args.collection,
      parentId: created.id,
      snapshot: created,
      status: (created._status as DocStatus | undefined) ?? status ?? 'published',
      autosave: args.autosave,
      userId: args.userId,
    })
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
  return status === 'published' ? 'published' : 'draft'
}

export function resolveUpdateStatus(args: {
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

async function handleDraftRevisionUpdate(args: {
  txDb: DatabaseAdapter
  collection: CollectionConfig
  id: number
  originalDoc: DocumentData
  finalData: DocumentData
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  req?: Request
}): Promise<MutationExecutionResult> {
  const draftDoc = buildDraftRevisionDoc(args.id, args.originalDoc, args.finalData)
  await maybeSaveVersion({
    txDb: args.txDb,
    collection: args.collection,
    parentId: args.id,
    snapshot: draftDoc,
    status: 'draft',
    autosave: args.autosave,
    userId: args.userId,
  })
  const doc = await runAfterChangeHooks({
    collection: args.collection,
    doc: draftDoc,
    operation: 'update',
    previousDoc: args.originalDoc,
    status: 'draft',
    previousStatus: args.previousStatus,
    statusTransition: args.statusTransition,
    req: args.req,
  })
  return { success: true, doc }
}

async function prepareUpdatePayload(
  collection: CollectionConfig,
  clientCol: ReturnType<typeof toClientCollection>,
  args: {
    data: DocumentData
    originalDoc: DocumentData
    req?: Request
    draft?: boolean
    status?: DocStatus
    statusTransition?: DocStatusTransition
  },
): Promise<{
  finalData: DocumentData
  status: DocStatus | undefined
  previousStatus: DocStatus | undefined
  statusTransition: DocStatusTransition | undefined
  rawHookData: DocumentData
}> {
  const initialData = sanitizeConditionalFields(clientCol.fields, args.data, args.originalDoc)
  const { status, previousStatus, statusTransition } = resolveUpdateStatus({
    collection,
    ...args,
  })
  if (status !== undefined) {
    initialData._status = status
  }
  const data = await runBeforeChangeHooks({
    collection,
    data: initialData,
    operation: 'update',
    originalDoc: args.originalDoc,
    status,
    previousStatus,
    statusTransition,
    req: args.req,
  })
  const finalData = sanitizeConditionalFields(clientCol.fields, data, args.originalDoc)
  if (collection.versions?.drafts) {
    finalData._status = data._status ?? status
  }
  return { finalData, status, previousStatus, statusTransition, rawHookData: data }
}

async function handleParentRowUpdate(args: {
  txDb: DatabaseAdapter
  rootDb: DatabaseAdapter
  collection: CollectionConfig
  id: number
  finalData: DocumentData
  originalDoc: DocumentData
  rawHookData: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  req?: Request
}): Promise<MutationExecutionResult> {
  const updated = await args.txDb.update({
    collection: args.collection,
    id: args.id,
    data: args.finalData,
  })
  if (!updated) {
    return {
      success: false,
      status: 404,
      body: { error: `Document with ID ${args.id} not found` },
    }
  }
  await maybeSaveVersion({
    txDb: args.txDb,
    collection: args.collection,
    parentId: args.id,
    snapshot: updated,
    status: (updated._status as DocStatus | undefined) ?? args.status ?? 'published',
    autosave: args.autosave,
    userId: args.userId,
  })
  try {
    const doc = await runAfterChangeHooks({
      collection: args.collection,
      doc: updated,
      operation: 'update',
      previousDoc: args.originalDoc,
      status: (updated._status as DocStatus | undefined) ?? args.status,
      previousStatus: args.previousStatus,
      statusTransition: args.statusTransition,
      req: args.req,
    })
    return { success: true, doc }
  } catch (hookErr) {
    if (!args.rootDb.transaction) {
      await compensateUpdate(
        args.txDb,
        args.collection,
        args.id,
        args.originalDoc,
        args.rawHookData,
      )
    }
    throw hookErr
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
  autosave?: boolean
  userId?: string | null
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const { finalData, status, previousStatus, statusTransition, rawHookData } =
      await prepareUpdatePayload(args.collection, clientCol, args)

    if (isDraftRevisionOfPublished(args.collection, args.originalDoc, status, statusTransition)) {
      return handleDraftRevisionUpdate({
        txDb,
        collection: args.collection,
        id: args.id,
        originalDoc: args.originalDoc,
        finalData,
        previousStatus,
        statusTransition,
        autosave: args.autosave,
        userId: args.userId,
        req: args.req,
      })
    }

    return handleParentRowUpdate({
      txDb,
      rootDb: args.db,
      collection: args.collection,
      id: args.id,
      finalData,
      originalDoc: args.originalDoc,
      rawHookData,
      status,
      previousStatus,
      statusTransition,
      autosave: args.autosave,
      userId: args.userId,
      req: args.req,
    })
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
