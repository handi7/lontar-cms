import { sanitizeConditionalFields } from '../client/condition'
import type { DocStatus } from '../client/system-fields'
import { toClientCollection, toClientGlobal } from '../config/to-client-config'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import { formatUniqueConstraintError, UniqueConstraintError } from '../database/errors'
import { runAfterChangeHooks, runBeforeChangeHooks } from '../hooks'
import type { DocStatusTransition } from '../hooks/types'
import { dispatchWebhooks, type WebhookAction } from '../webhooks'

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

// The original doc of a draft save is the pending draft snapshot, whose `_status` is
// always 'draft'; `_isPublished` carries the live row's status in that case.
function isLivePublished(doc: DocumentData): boolean {
  return doc._isPublished === true || doc._status === 'published'
}

function isDraftRevisionOfPublished(
  collection: CollectionConfig,
  originalDoc: DocumentData,
  status?: DocStatus,
  statusTransition?: DocStatusTransition,
): boolean {
  return Boolean(
    collection.versions?.drafts &&
    isLivePublished(originalDoc) &&
    status === 'draft' &&
    statusTransition !== 'unpublish',
  )
}

function buildDraftRevisionDoc(
  id: number,
  originalDoc: DocumentData,
  finalData: DocumentData,
): DocumentData {
  const { _isPublished: _readOnlyFlag, ...rest } = { ...originalDoc, ...finalData }
  return {
    ...rest,
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

async function prepareCreatePayload(
  collection: CollectionConfig,
  clientCol: ReturnType<typeof toClientCollection>,
  args: {
    data: DocumentData
    draft?: boolean
    req?: Request
  },
): Promise<{
  finalData: DocumentData
  status: DocStatus | undefined
  statusTransition: DocStatusTransition | undefined
}> {
  const initialData = sanitizeConditionalFields(clientCol.fields, args.data)
  const { status, statusTransition } = resolveCreateStatus(collection, args.data, args.draft)
  if (status !== undefined) {
    initialData._status = status
  }
  const data = await runBeforeChangeHooks({
    collection,
    data: initialData,
    operation: 'create',
    status,
    previousStatus: undefined,
    statusTransition,
    req: args.req,
  })
  const finalData = sanitizeConditionalFields(clientCol.fields, data)
  if (collection.versions?.drafts) {
    finalData._status = data._status ?? status
  }
  return { finalData, status, statusTransition }
}

export async function executeCreate(args: {
  collection: CollectionConfig
  db: DatabaseAdapter
  data: DocumentData
  req?: Request
  draft?: boolean
  autosave?: boolean
  userId?: string | null
  config?: Config
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const { finalData, status, statusTransition } = await prepareCreatePayload(
      args.collection,
      clientCol,
      args,
    )
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
      const finalDoc = args.collection.versions?.drafts
        ? { ...doc, _isPublished: doc._status === 'published' }
        : doc
      return { success: true, doc: finalDoc }
    } catch (hookErr) {
      if (!args.db.transaction) {
        await compensateCreate(txDb, args.collection, created.id)
      }
      throw hookErr
    }
  }

  let result: MutationExecutionResult
  try {
    if (args.db.transaction) {
      result = await args.db.transaction(run)
    } else {
      result = await run(args.db)
    }
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }

  if (result.success && !args.autosave) {
    void dispatchWebhooks({
      config: args.config,
      collection: args.collection,
      event: 'create',
      doc: result.doc,
      status: result.doc._status as DocStatus | undefined,
    })
  }

  return result
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
  return { success: true, doc: { ...doc, _isPublished: true } }
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
    const finalDoc = args.collection.versions?.drafts
      ? { ...doc, _isPublished: doc._status === 'published' }
      : doc
    return { success: true, doc: finalDoc }
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

function resolveUpdateWebhookEvent(transition?: DocStatusTransition): WebhookAction {
  if (transition === 'publish') return 'publish'
  if (transition === 'unpublish') return 'unpublish'
  return 'update'
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
  config?: Config
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

  let result: MutationExecutionResult
  try {
    if (args.db.transaction) {
      result = await args.db.transaction(run)
    } else {
      result = await run(args.db)
    }
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }

  if (result.success && !args.autosave) {
    const event = resolveUpdateWebhookEvent(args.statusTransition)
    void dispatchWebhooks({
      config: args.config,
      collection: args.collection,
      event,
      doc: result.doc,
      previousDoc: args.originalDoc,
      status: result.doc._status as DocStatus | undefined,
      previousStatus: args.originalDoc._status as DocStatus | undefined,
    })
  }

  return result
}

async function maybeSaveGlobalVersion(args: {
  txDb: DatabaseAdapter
  global: GlobalConfig
  parentId: number
  snapshot: DocumentData
  status: DocStatus
  autosave?: boolean
  userId?: string | null
}): Promise<void> {
  if (!args.global.versions || !args.txDb.saveVersion) return
  await args.txDb.saveVersion({
    global: args.global,
    parentId: args.parentId,
    snapshot: args.snapshot,
    status: args.status,
    autosave: args.autosave,
    userId: args.userId,
  })
}

function isGlobalDraftRevisionOfPublished(
  global: GlobalConfig,
  originalDoc: DocumentData | null,
  status?: DocStatus,
  statusTransition?: DocStatusTransition,
): boolean {
  return Boolean(
    global.versions?.drafts &&
    originalDoc &&
    isLivePublished(originalDoc) &&
    status === 'draft' &&
    statusTransition !== 'unpublish',
  )
}

export function resolveGlobalUpdateStatus(args: {
  global: GlobalConfig
  data: DocumentData
  originalDoc?: DocumentData | null
  draft?: boolean
  status?: DocStatus
  statusTransition?: DocStatusTransition
}): {
  status: DocStatus | undefined
  previousStatus: DocStatus | undefined
  statusTransition: DocStatusTransition | undefined
} {
  if (!args.global.versions?.drafts) {
    return { status: undefined, previousStatus: undefined, statusTransition: undefined }
  }
  const previousStatus = (args.originalDoc?._status as DocStatus | undefined) ?? 'published'
  const fallback = args.draft !== undefined ? (args.draft ? 'draft' : 'published') : previousStatus
  const status = args.status ?? (args.data._status as DocStatus | undefined) ?? fallback
  const statusTransition = resolveUpdateStatusTransition(
    previousStatus,
    status,
    args.statusTransition,
  )
  return { status, previousStatus, statusTransition }
}

function applyGlobalStatus(
  global: GlobalConfig,
  target: DocumentData,
  status?: DocStatus,
  fallback?: DocStatus,
): void {
  if (global.versions?.drafts && status !== undefined) {
    target._status = fallback ?? status
  }
}

async function prepareGlobalPayload(
  global: GlobalConfig,
  clientGlobal: ReturnType<typeof toClientGlobal>,
  args: {
    data: DocumentData
    existing?: DocumentData | null
    req?: Request
    status?: DocStatus
    previousStatus?: DocStatus
    statusTransition?: DocStatusTransition
  },
): Promise<DocumentData> {
  const existing = args.existing ?? undefined
  const operation = existing ? 'update' : 'create'
  const initialData = sanitizeConditionalFields(clientGlobal.fields, args.data, existing)
  applyGlobalStatus(global, initialData, args.status)

  const hookData = await runBeforeChangeHooks({
    global,
    data: initialData,
    operation,
    originalDoc: existing,
    status: args.status,
    previousStatus: args.previousStatus,
    statusTransition: args.statusTransition,
    req: args.req,
  })

  const finalData = sanitizeConditionalFields(clientGlobal.fields, hookData, existing)
  applyGlobalStatus(global, finalData, args.status, hookData._status as DocStatus | undefined)
  return finalData
}

async function handleGlobalDraftRevisionUpdate(args: {
  txDb: DatabaseAdapter
  global: GlobalConfig
  existing: DocumentData | null
  finalData: DocumentData
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  req?: Request
}): Promise<MutationExecutionResult> {
  const parentId = Number(args.existing?.id ?? 1)
  const draftDoc = buildDraftRevisionDoc(parentId, args.existing ?? {}, args.finalData)
  await maybeSaveGlobalVersion({
    txDb: args.txDb,
    global: args.global,
    parentId,
    snapshot: draftDoc,
    status: 'draft',
    autosave: args.autosave,
    userId: args.userId,
  })
  const doc = await runAfterChangeHooks({
    global: args.global,
    doc: draftDoc,
    operation: 'update',
    previousDoc: args.existing ?? undefined,
    status: 'draft',
    previousStatus: args.previousStatus,
    statusTransition: args.statusTransition,
    req: args.req,
  })
  return { success: true, doc: { ...doc, _isPublished: true } }
}

async function handleGlobalParentRowUpdate(args: {
  txDb: DatabaseAdapter
  global: GlobalConfig
  existing: DocumentData | null
  finalData: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  req?: Request
}): Promise<MutationExecutionResult> {
  const operation = args.existing ? 'update' : 'create'
  const saved = await args.txDb.updateGlobal({ global: args.global, data: args.finalData })
  const parentId = Number(saved.id ?? 1)
  await maybeSaveGlobalVersion({
    txDb: args.txDb,
    global: args.global,
    parentId,
    snapshot: saved,
    status: (saved._status as DocStatus | undefined) ?? args.status ?? 'published',
    autosave: args.autosave,
    userId: args.userId,
  })
  const doc = await runAfterChangeHooks({
    global: args.global,
    doc: saved,
    operation,
    previousDoc: args.existing ?? undefined,
    status: (saved._status as DocStatus | undefined) ?? args.status,
    previousStatus: args.previousStatus,
    statusTransition: args.statusTransition,
    req: args.req,
  })
  const finalDoc = args.global.versions?.drafts
    ? { ...doc, _isPublished: doc._status === 'published' }
    : doc
  return { success: true, doc: finalDoc }
}

export async function executeGlobalUpdate(args: {
  global: GlobalConfig
  db: DatabaseAdapter
  existing: DocumentData | null
  data: DocumentData
  req?: Request
  config?: Config
  draft?: boolean
  status?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
}): Promise<MutationExecutionResult> {
  const clientGlobal = toClientGlobal(args.global)
  const { status, previousStatus, statusTransition } = resolveGlobalUpdateStatus({
    global: args.global,
    data: args.data,
    originalDoc: args.existing,
    draft: args.draft,
    status: args.status,
    statusTransition: args.statusTransition,
  })

  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const finalData = await prepareGlobalPayload(args.global, clientGlobal, {
      data: args.data,
      existing: args.existing,
      req: args.req,
      status,
      previousStatus,
      statusTransition,
    })

    if (isGlobalDraftRevisionOfPublished(args.global, args.existing, status, statusTransition)) {
      return handleGlobalDraftRevisionUpdate({
        txDb,
        global: args.global,
        existing: args.existing,
        finalData,
        previousStatus,
        statusTransition,
        autosave: args.autosave,
        userId: args.userId,
        req: args.req,
      })
    }

    return handleGlobalParentRowUpdate({
      txDb,
      global: args.global,
      existing: args.existing,
      finalData,
      status,
      previousStatus,
      statusTransition,
      autosave: args.autosave,
      userId: args.userId,
      req: args.req,
    })
  }

  let result: MutationExecutionResult
  try {
    if (args.db.transaction) {
      result = await args.db.transaction(run)
    } else {
      result = await run(args.db)
    }
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }

  if (result.success && !args.autosave) {
    const defaultEvent = args.existing ? 'update' : 'create'
    const event = statusTransition === 'publish' ? 'publish' : defaultEvent
    void dispatchWebhooks({
      config: args.config,
      global: args.global,
      event,
      doc: result.doc,
      previousDoc: args.existing ?? undefined,
      status: result.doc._status as DocStatus | undefined,
    })
  }

  return result
}
