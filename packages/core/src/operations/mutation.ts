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
  | {
      success: true
      doc: DocumentData
      isDraftRevision?: boolean
      statusTransition?: DocStatusTransition
      previousStatus?: DocStatus
      dispatchWebhooks?: () => void
    }
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
  dataOrDraft?: DocumentData | boolean,
  draftArg?: boolean,
): { status: DocStatus | undefined; statusTransition: DocStatusTransition | undefined } {
  if (!collection.versions?.drafts) {
    return { status: undefined, statusTransition: undefined }
  }
  const draft = typeof dataOrDraft === 'boolean' ? dataOrDraft : draftArg
  const status: DocStatus = draft ? 'draft' : 'published'
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
  const { status, statusTransition } = resolveCreateStatus(collection, args.draft)
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
    finalData._status = status
  }
  return { finalData, status, statusTransition }
}

function resolveCreateWebhookEvent(
  entity: CollectionConfig | GlobalConfig,
  status?: DocStatus,
): WebhookAction {
  if (entity.versions?.drafts && status === 'published') {
    return 'publish'
  }
  return 'create'
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
    const docStatus = result.doc._status as DocStatus | undefined
    const event = resolveCreateWebhookEvent(args.collection, docStatus)
    void dispatchWebhooks({
      config: args.config,
      collection: args.collection,
      event,
      doc: result.doc,
      status: docStatus,
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

// An autosave only ever writes a draft. Without this, an autosave sent without `draft`
// would write the live row and publish edits nobody reviewed.
export function resolveDraftFlag(
  entity: CollectionConfig | GlobalConfig,
  draft?: boolean,
  autosave?: boolean,
): boolean | undefined {
  if (autosave && entity.versions?.drafts) return true
  return draft
}

export async function resolveOriginalDoc(
  db: DatabaseAdapter,
  collection: CollectionConfig,
  id: number,
  draft?: boolean,
): Promise<DocumentData | null> {
  const baseDoc = await db.findByID({ collection, id })
  if (!baseDoc) return null
  const shouldLoadDraft = draft ?? baseDoc._status === 'draft'
  if (shouldLoadDraft && collection.versions && db.findLatestDraftVersion) {
    const draftVersion = await db.findLatestDraftVersion({ collection, parentId: id })
    if (draftVersion) {
      return { ...draftVersion.snapshot, _isPublished: baseDoc._status === 'published' }
    }
  }
  return baseDoc
}

export function resolveUpdateStatus(args: {
  collection: CollectionConfig
  data?: DocumentData
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
  const status = args.status ?? fallback
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
  return { success: true, doc: { ...doc, _isPublished: true }, isDraftRevision: true }
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
    finalData._status = status
  }
  return { finalData, status, previousStatus, statusTransition, rawHookData: data }
}

async function resolveUnpublishPendingDraft(
  txDb: DatabaseAdapter,
  collection: CollectionConfig,
  parentId: number,
  statusTransition?: DocStatusTransition,
): Promise<DocumentData | null> {
  if (
    statusTransition !== 'unpublish' ||
    !collection.versions?.drafts ||
    !txDb.findLatestDraftVersion
  ) {
    return null
  }
  const latestDraft = await txDb.findLatestDraftVersion({ collection, parentId })
  return latestDraft ? latestDraft.snapshot : null
}

function resolveHookDoc(doc: DocumentData, pendingDraft: DocumentData | null): DocumentData {
  return pendingDraft ? { ...pendingDraft, _status: 'draft' } : doc
}

function formatMutationDoc(
  doc: DocumentData,
  hasDrafts: unknown,
  statusTransition?: DocStatusTransition,
): DocumentData {
  if (!hasDrafts) return doc
  const isPublished = statusTransition === 'unpublish' ? false : doc._status === 'published'
  return { ...doc, _isPublished: isPublished }
}

async function syncParentRowVersion(args: {
  txDb: DatabaseAdapter
  collection: CollectionConfig
  parentId: number
  updated: DocumentData
  status?: DocStatus
  autosave?: boolean
  userId?: string | null
  pendingDraft: DocumentData | null
}): Promise<void> {
  if (args.pendingDraft) return
  await maybeSaveVersion({
    txDb: args.txDb,
    collection: args.collection,
    parentId: args.parentId,
    snapshot: args.updated,
    status: (args.updated._status as DocStatus | undefined) ?? args.status ?? 'published',
    autosave: args.autosave,
    userId: args.userId,
  })
}

function mergeDraftUpdateData(originalDoc: DocumentData, finalData: DocumentData): DocumentData {
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    _isPublished: _published,
    ...rest
  } = originalDoc
  return { ...rest, ...finalData }
}

function resolveParentRowData(args: {
  collection: CollectionConfig
  originalDoc: DocumentData
  finalData: DocumentData
  status?: DocStatus
  statusTransition?: DocStatusTransition
}): DocumentData {
  if (
    args.collection.versions?.drafts &&
    args.status === 'draft' &&
    args.statusTransition !== 'unpublish' &&
    args.originalDoc
  ) {
    return mergeDraftUpdateData(args.originalDoc, args.finalData)
  }
  return args.finalData
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
  const dataToUpdate = resolveParentRowData({
    collection: args.collection,
    originalDoc: args.originalDoc,
    finalData: args.finalData,
    status: args.status,
    statusTransition: args.statusTransition,
  })
  const updated = await args.txDb.update({
    collection: args.collection,
    id: args.id,
    data: dataToUpdate,
  })
  if (!updated) {
    return {
      success: false,
      status: 404,
      body: { error: `Document with ID ${args.id} not found` },
    }
  }
  const pendingDraft = await resolveUnpublishPendingDraft(
    args.txDb,
    args.collection,
    args.id,
    args.statusTransition,
  )

  await syncParentRowVersion({
    txDb: args.txDb,
    collection: args.collection,
    parentId: args.id,
    updated,
    status: args.status,
    autosave: args.autosave,
    userId: args.userId,
    pendingDraft,
  })

  const docToHook = resolveHookDoc(updated, pendingDraft)

  try {
    const doc = await runAfterChangeHooks({
      collection: args.collection,
      doc: docToHook,
      operation: 'update',
      previousDoc: args.originalDoc,
      status: (docToHook._status as DocStatus | undefined) ?? args.status,
      previousStatus: args.previousStatus,
      statusTransition: args.statusTransition,
      req: args.req,
    })
    const finalDoc = formatMutationDoc(doc, args.collection.versions?.drafts, args.statusTransition)
    return { success: true, doc: finalDoc, isDraftRevision: false }
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

function resolveUpdateWebhookEvent(
  transition?: DocStatusTransition,
  status?: DocStatus,
): WebhookAction {
  if (transition === 'publish') return 'publish'
  if (transition === 'unpublish') return 'unpublish'
  if (status === 'published' && transition === 'published') return 'publish'
  return 'update'
}

function dispatchPostUpdateWebhooks(args: {
  config?: Config
  collection: CollectionConfig
  result: Extract<MutationExecutionResult, { success: true }>
  originalDoc: DocumentData
  fallbackTransition?: DocStatusTransition
}): void {
  const statusTransition = args.result.statusTransition ?? args.fallbackTransition
  const previousStatus =
    args.result.previousStatus ?? (args.originalDoc._status as DocStatus | undefined)
  const docStatus = args.result.doc._status as DocStatus | undefined
  const event = resolveUpdateWebhookEvent(statusTransition, docStatus)
  void dispatchWebhooks({
    config: args.config,
    collection: args.collection,
    event,
    doc: args.result.doc,
    previousDoc: args.originalDoc,
    status: docStatus,
    previousStatus,
  })
}

function handlePostUpdateWebhooks(args: {
  config?: Config
  collection: CollectionConfig
  result: Extract<MutationExecutionResult, { success: true }>
  originalDoc: DocumentData
  fallbackTransition?: DocStatusTransition
  deferWebhooks?: boolean
  autosave?: boolean
}): MutationExecutionResult {
  if (args.autosave) {
    return args.result
  }
  const dispatch = () => {
    dispatchPostUpdateWebhooks({
      config: args.config,
      collection: args.collection,
      result: args.result,
      originalDoc: args.originalDoc,
      fallbackTransition: args.fallbackTransition,
    })
  }
  if (args.deferWebhooks) {
    return { ...args.result, dispatchWebhooks: dispatch }
  }
  dispatch()
  return args.result
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
  deferWebhooks?: boolean
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const { finalData, status, previousStatus, statusTransition, rawHookData } =
      await prepareUpdatePayload(args.collection, clientCol, args)

    const execResult = isDraftRevisionOfPublished(
      args.collection,
      args.originalDoc,
      status,
      statusTransition,
    )
      ? await handleDraftRevisionUpdate({
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
      : await handleParentRowUpdate({
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

    if (execResult.success) {
      return {
        ...execResult,
        statusTransition,
        previousStatus,
      }
    }
    return execResult
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

  if (result.success) {
    return handlePostUpdateWebhooks({
      config: args.config,
      collection: args.collection,
      result,
      originalDoc: args.originalDoc,
      fallbackTransition: args.statusTransition,
      deferWebhooks: args.deferWebhooks,
      autosave: args.autosave,
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
  data?: DocumentData
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
  const status = args.status ?? fallback
  const statusTransition = resolveUpdateStatusTransition(
    previousStatus,
    status,
    args.statusTransition,
  )
  return { status, previousStatus, statusTransition }
}

function applyGlobalStatus(global: GlobalConfig, target: DocumentData, status?: DocStatus): void {
  if (global.versions?.drafts && status !== undefined) {
    target._status = status
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
  applyGlobalStatus(global, finalData, args.status)
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
  return { success: true, doc: { ...doc, _isPublished: true }, isDraftRevision: true }
}

async function resolveGlobalUnpublishPendingDraft(
  txDb: DatabaseAdapter,
  global: GlobalConfig,
  parentId: number,
  statusTransition?: DocStatusTransition,
): Promise<DocumentData | null> {
  if (
    statusTransition !== 'unpublish' ||
    !global.versions?.drafts ||
    !txDb.findLatestDraftVersion
  ) {
    return null
  }
  const latestDraft = await txDb.findLatestDraftVersion({ global, parentId })
  return latestDraft ? latestDraft.snapshot : null
}

async function syncGlobalParentRowVersion(args: {
  txDb: DatabaseAdapter
  global: GlobalConfig
  parentId: number
  saved: DocumentData
  status?: DocStatus
  autosave?: boolean
  userId?: string | null
  pendingDraft: DocumentData | null
}): Promise<void> {
  if (args.pendingDraft) return
  await maybeSaveGlobalVersion({
    txDb: args.txDb,
    global: args.global,
    parentId: args.parentId,
    snapshot: args.saved,
    status: (args.saved._status as DocStatus | undefined) ?? args.status ?? 'published',
    autosave: args.autosave,
    userId: args.userId,
  })
}

function resolveGlobalParentRowData(args: {
  global: GlobalConfig
  existing: DocumentData | null
  finalData: DocumentData
  status?: DocStatus
  statusTransition?: DocStatusTransition
}): DocumentData {
  if (
    args.global.versions?.drafts &&
    args.status === 'draft' &&
    args.statusTransition !== 'unpublish' &&
    args.existing
  ) {
    return mergeDraftUpdateData(args.existing, args.finalData)
  }
  return args.finalData
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
  const dataToUpdate = resolveGlobalParentRowData({
    global: args.global,
    existing: args.existing,
    finalData: args.finalData,
    status: args.status,
    statusTransition: args.statusTransition,
  })
  const saved = await args.txDb.updateGlobal({ global: args.global, data: dataToUpdate })
  const parentId = Number(saved.id ?? 1)
  const pendingDraft = await resolveGlobalUnpublishPendingDraft(
    args.txDb,
    args.global,
    parentId,
    args.statusTransition,
  )

  await syncGlobalParentRowVersion({
    txDb: args.txDb,
    global: args.global,
    parentId,
    saved,
    status: args.status,
    autosave: args.autosave,
    userId: args.userId,
    pendingDraft,
  })

  const docToHook = resolveHookDoc(saved, pendingDraft)

  const doc = await runAfterChangeHooks({
    global: args.global,
    doc: docToHook,
    operation,
    previousDoc: args.existing ?? undefined,
    status: (docToHook._status as DocStatus | undefined) ?? args.status,
    previousStatus: args.previousStatus,
    statusTransition: args.statusTransition,
    req: args.req,
  })
  const finalDoc = formatMutationDoc(doc, args.global.versions?.drafts, args.statusTransition)
  return { success: true, doc: finalDoc, isDraftRevision: false }
}

function resolveGlobalWebhookEvent(
  global: GlobalConfig,
  isExisting: boolean,
  transition?: DocStatusTransition,
  status?: DocStatus,
): WebhookAction {
  const defaultEvent: WebhookAction = isExisting ? 'update' : 'create'
  if (!global.versions?.drafts) {
    return defaultEvent
  }
  if (!isExisting) {
    return resolveCreateWebhookEvent(global, status)
  }
  return resolveUpdateWebhookEvent(transition, status)
}

function dispatchPostGlobalWebhooks(args: {
  config?: Config
  global: GlobalConfig
  result: Extract<MutationExecutionResult, { success: true }>
  existing: DocumentData | null
  statusTransition?: DocStatusTransition
  previousStatus?: DocStatus
}): void {
  const isExisting = Boolean(args.existing)
  const statusTransition = args.result.statusTransition ?? args.statusTransition
  const previousStatus =
    args.result.previousStatus ??
    args.previousStatus ??
    (args.existing?._status as DocStatus | undefined) ??
    (isExisting ? 'published' : undefined)
  const docStatus = args.result.doc._status as DocStatus | undefined
  const event = resolveGlobalWebhookEvent(args.global, isExisting, statusTransition, docStatus)

  void dispatchWebhooks({
    config: args.config,
    global: args.global,
    event,
    doc: args.result.doc,
    previousDoc: args.existing ?? undefined,
    status: docStatus,
    previousStatus,
  })
}

function handlePostGlobalWebhooks(args: {
  config?: Config
  global: GlobalConfig
  result: Extract<MutationExecutionResult, { success: true }>
  existing: DocumentData | null
  statusTransition?: DocStatusTransition
  previousStatus?: DocStatus
  deferWebhooks?: boolean
  autosave?: boolean
}): MutationExecutionResult {
  if (args.autosave) {
    return args.result
  }
  const dispatch = () => {
    dispatchPostGlobalWebhooks({
      config: args.config,
      global: args.global,
      result: args.result,
      existing: args.existing,
      statusTransition: args.statusTransition,
      previousStatus: args.previousStatus,
    })
  }
  if (args.deferWebhooks) {
    return { ...args.result, dispatchWebhooks: dispatch }
  }
  dispatch()
  return args.result
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
  deferWebhooks?: boolean
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

    const execResult = isGlobalDraftRevisionOfPublished(
      args.global,
      args.existing,
      status,
      statusTransition,
    )
      ? await handleGlobalDraftRevisionUpdate({
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
      : await handleGlobalParentRowUpdate({
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

    if (execResult.success) {
      return {
        ...execResult,
        statusTransition,
        previousStatus,
      }
    }
    return execResult
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

  if (result.success) {
    return handlePostGlobalWebhooks({
      config: args.config,
      global: args.global,
      result,
      existing: args.existing,
      statusTransition,
      previousStatus,
      deferWebhooks: args.deferWebhooks,
      autosave: args.autosave,
    })
  }

  return result
}
