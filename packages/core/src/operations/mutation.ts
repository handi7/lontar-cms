import { sanitizeConditionalFields } from '../client/condition'
import type { DocStatus } from '../client/system-fields'
import { toClientCollection, toClientGlobal } from '../config/to-client-config'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import {
  formatCheckConstraintError,
  formatForeignKeyConstraintError,
  formatNotNullConstraintError,
  formatUniqueConstraintError,
  CheckConstraintError,
  ForeignKeyConstraintError,
  NotNullConstraintError,
  UniqueConstraintError,
  type ValidationErrorResponse,
} from '../database/errors'
import { runAfterChangeHooks, runBeforeChangeHooks } from '../hooks'
import type { DocStatusTransition } from '../hooks/types'
import type { Fields } from '../fields/types'
import { mergeDraftLocaleData, projectCanonicalDoc } from './locale'
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

function mapDatabaseValidationError(err: unknown): ValidationErrorResponse | null {
  if (err instanceof UniqueConstraintError) return formatUniqueConstraintError(err)
  if (err instanceof NotNullConstraintError) return formatNotNullConstraintError(err)
  if (err instanceof ForeignKeyConstraintError) return formatForeignKeyConstraintError(err)
  if (err instanceof CheckConstraintError) return formatCheckConstraintError(err)
  return null
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
  fields?: Fields,
  locale?: string,
  defaultLocale?: string,
): DocumentData {
  const merged =
    fields && locale
      ? mergeDraftLocaleData(fields, originalDoc, finalData, locale, defaultLocale)
      : { ...originalDoc, ...finalData }
  const { _isPublished: _readOnlyFlag, ...rest } = merged
  return {
    ...rest,
    id,
    _status: 'draft',
    updatedAt: new Date().toISOString(),
  }
}

async function resolveCanonicalSnapshot(
  txDb: DatabaseAdapter,
  collection: CollectionConfig,
  parentId: number,
  fallbackDoc: DocumentData,
  isLocalized: boolean,
): Promise<DocumentData> {
  if (isLocalized && txDb.findByID) {
    const canonical = await txDb.findByID({ collection, id: parentId, locale: 'all' })
    if (canonical) return canonical
  }
  return fallbackDoc
}

async function resolveCanonicalGlobalSnapshot(
  txDb: DatabaseAdapter,
  global: GlobalConfig,
  fallbackDoc: DocumentData,
  isLocalized: boolean,
): Promise<DocumentData> {
  if (isLocalized && txDb.findGlobal) {
    const canonical = await txDb.findGlobal({ global, locale: 'all' })
    if (canonical) return canonical
  }
  return fallbackDoc
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
    locale?: string
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
    locale: args.locale,
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
  locale?: string
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const { finalData, status, statusTransition } = await prepareCreatePayload(
      args.collection,
      clientCol,
      args,
    )
    const created = await txDb.create({
      collection: args.collection,
      data: finalData,
      locale: args.locale,
    })
    const snapshot = await resolveCanonicalSnapshot(
      txDb,
      args.collection,
      created.id,
      created,
      Boolean(args.config?.localization),
    )
    await maybeSaveVersion({
      txDb,
      collection: args.collection,
      parentId: created.id,
      snapshot,
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
        locale: args.locale,
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
    const validationBody = mapDatabaseValidationError(err)
    if (validationBody) {
      return { success: false, status: 400, body: validationBody }
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
      locale: args.locale,
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

/**
 * The original doc as the requested locale sees it, for hooks, conditions, field access and
 * webhooks. `resolveOriginalDoc` returns either the live row in the default locale or a draft
 * snapshot with `{ en, id }` dictionaries; neither is what a `?locale=id` edit should compare
 * against. The canonical original stays untouched for the draft merge and the revert data.
 */
export async function resolveLocaleOriginalDoc(
  db: DatabaseAdapter,
  collection: CollectionConfig,
  id: number,
  originalDoc: DocumentData,
  config: Config,
  locale?: string,
): Promise<DocumentData> {
  if (!config.localization || !locale || locale === 'all') return originalDoc
  // A draft snapshot is already canonical and is marked with `_isPublished`.
  let canonical = originalDoc
  if (!('_isPublished' in originalDoc) && db.findByID) {
    canonical = (await db.findByID({ collection, id, locale: 'all' })) ?? originalDoc
  }
  const projected = projectCanonicalDoc(canonical, collection.fields, {
    locale,
    fallbackLocale: false,
  })
  return {
    ...projected,
    ...('_status' in originalDoc ? { _status: originalDoc._status } : {}),
    ...('_isPublished' in originalDoc ? { _isPublished: originalDoc._isPublished } : {}),
  }
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

async function resolveBaseDraftSnapshot(
  txDb: DatabaseAdapter,
  collection: CollectionConfig,
  id: number,
  fallbackDoc: DocumentData,
  isLocalized: boolean,
): Promise<DocumentData> {
  if (txDb.findLatestDraftVersion) {
    const latestDraft = await txDb.findLatestDraftVersion({ collection, parentId: id })
    if (latestDraft) return latestDraft.snapshot
  }
  if (isLocalized && txDb.findByID) {
    const canonical = await txDb.findByID({ collection, id, locale: 'all' })
    if (canonical) return canonical
  }
  return fallbackDoc
}

async function handleDraftRevisionUpdate(args: {
  txDb: DatabaseAdapter
  collection: CollectionConfig
  id: number
  originalDoc: DocumentData
  localeOriginalDoc?: DocumentData
  finalData: DocumentData
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  req?: Request
  locale?: string
  config?: Config
}): Promise<MutationExecutionResult> {
  const isLocalized = Boolean(args.config?.localization)
  const defaultLocale = args.config?.localization?.defaultLocale
  const baseSnapshot = await resolveBaseDraftSnapshot(
    args.txDb,
    args.collection,
    args.id,
    args.originalDoc,
    isLocalized,
  )

  const draftDoc = buildDraftRevisionDoc(
    args.id,
    baseSnapshot,
    args.finalData,
    args.collection.fields,
    args.locale,
    defaultLocale,
  )
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
    previousDoc: args.localeOriginalDoc ?? args.originalDoc,
    status: 'draft',
    previousStatus: args.previousStatus,
    statusTransition: args.statusTransition,
    req: args.req,
    locale: args.locale,
  })
  const projectedDoc =
    isLocalized && args.locale !== 'all'
      ? projectCanonicalDoc(doc, args.collection.fields, {
          locale: args.locale,
          defaultLocale,
        })
      : doc
  return { success: true, doc: { ...projectedDoc, _isPublished: true }, isDraftRevision: true }
}

async function prepareUpdatePayload(
  collection: CollectionConfig,
  clientCol: ReturnType<typeof toClientCollection>,
  args: {
    data: DocumentData
    originalDoc: DocumentData
    localeOriginalDoc?: DocumentData
    req?: Request
    draft?: boolean
    status?: DocStatus
    statusTransition?: DocStatusTransition
    locale?: string
  },
): Promise<{
  finalData: DocumentData
  status: DocStatus | undefined
  previousStatus: DocStatus | undefined
  statusTransition: DocStatusTransition | undefined
  rawHookData: DocumentData
}> {
  const hookOriginalDoc = args.localeOriginalDoc ?? args.originalDoc
  const initialData = sanitizeConditionalFields(clientCol.fields, args.data, hookOriginalDoc)
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
    originalDoc: hookOriginalDoc,
    status,
    previousStatus,
    statusTransition,
    req: args.req,
    locale: args.locale,
  })
  const finalData = sanitizeConditionalFields(clientCol.fields, data, hookOriginalDoc)
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
  config?: Config
}): Promise<void> {
  if (args.pendingDraft) return
  const snapshot = await resolveCanonicalSnapshot(
    args.txDb,
    args.collection,
    args.parentId,
    args.updated,
    Boolean(args.config?.localization),
  )
  await maybeSaveVersion({
    txDb: args.txDb,
    collection: args.collection,
    parentId: args.parentId,
    snapshot,
    status: (args.updated._status as DocStatus | undefined) ?? args.status ?? 'published',
    autosave: args.autosave,
    userId: args.userId,
  })
}

function deepMergeDraftData(original: unknown, update: unknown): unknown {
  if (update === undefined) return original
  if (
    original &&
    typeof original === 'object' &&
    !Array.isArray(original) &&
    update &&
    typeof update === 'object' &&
    !Array.isArray(update)
  ) {
    const result: Record<string, unknown> = { ...(original as Record<string, unknown>) }
    for (const [key, val] of Object.entries(update as Record<string, unknown>)) {
      result[key] = deepMergeDraftData(result[key], val)
    }
    return result
  }
  return update
}

function mergeDraftUpdateData(originalDoc: DocumentData, finalData: DocumentData): DocumentData {
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    _isPublished: _published,
    ...rest
  } = originalDoc

  const result: Record<string, unknown> = { ...rest }
  for (const [key, val] of Object.entries(finalData)) {
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergeDraftData(result[key], val)
    } else {
      result[key] = val
    }
  }
  return result
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
  localeOriginalDoc?: DocumentData
  rawHookData: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  req?: Request
  locale?: string
  config?: Config
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
    locale: args.locale,
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
    config: args.config,
  })

  const docToHook = resolveHookDoc(updated, pendingDraft)

  try {
    const doc = await runAfterChangeHooks({
      collection: args.collection,
      doc: docToHook,
      operation: 'update',
      previousDoc: args.localeOriginalDoc ?? args.originalDoc,
      status: (docToHook._status as DocStatus | undefined) ?? args.status,
      previousStatus: args.previousStatus,
      statusTransition: args.statusTransition,
      req: args.req,
      locale: args.locale,
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
  localeOriginalDoc?: DocumentData
  fallbackTransition?: DocStatusTransition
  locale?: string
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
    previousDoc: args.localeOriginalDoc ?? args.originalDoc,
    status: docStatus,
    previousStatus,
    locale: args.locale,
  })
}

function handlePostUpdateWebhooks(args: {
  config?: Config
  collection: CollectionConfig
  result: Extract<MutationExecutionResult, { success: true }>
  originalDoc: DocumentData
  localeOriginalDoc?: DocumentData
  fallbackTransition?: DocStatusTransition
  deferWebhooks?: boolean
  autosave?: boolean
  locale?: string
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
      localeOriginalDoc: args.localeOriginalDoc,
      fallbackTransition: args.fallbackTransition,
      locale: args.locale,
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
  /** `originalDoc` projected to the request locale; hooks and webhooks see this one. */
  localeOriginalDoc?: DocumentData
  data: DocumentData
  req?: Request
  draft?: boolean
  status?: DocStatus
  statusTransition?: DocStatusTransition
  autosave?: boolean
  userId?: string | null
  config?: Config
  deferWebhooks?: boolean
  locale?: string
  webhookLocale?: string
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
          localeOriginalDoc: args.localeOriginalDoc,
          finalData,
          previousStatus,
          statusTransition,
          autosave: args.autosave,
          userId: args.userId,
          req: args.req,
          locale: args.locale,
          config: args.config,
        })
      : await handleParentRowUpdate({
          txDb,
          rootDb: args.db,
          collection: args.collection,
          id: args.id,
          finalData,
          originalDoc: args.originalDoc,
          localeOriginalDoc: args.localeOriginalDoc,
          rawHookData,
          status,
          previousStatus,
          statusTransition,
          autosave: args.autosave,
          userId: args.userId,
          req: args.req,
          locale: args.locale,
          config: args.config,
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
    const validationBody = mapDatabaseValidationError(err)
    if (validationBody) {
      return { success: false, status: 400, body: validationBody }
    }
    throw err
  }

  if (result.success) {
    return handlePostUpdateWebhooks({
      config: args.config,
      collection: args.collection,
      result,
      originalDoc: args.originalDoc,
      localeOriginalDoc: args.localeOriginalDoc,
      fallbackTransition: args.statusTransition,
      deferWebhooks: args.deferWebhooks,
      autosave: args.autosave,
      locale: args.webhookLocale ?? args.locale,
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
    locale?: string
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
    locale: args.locale,
  })

  const finalData = sanitizeConditionalFields(clientGlobal.fields, hookData, existing)
  applyGlobalStatus(global, finalData, args.status)
  return finalData
}

async function resolveBaseGlobalDraftSnapshot(
  txDb: DatabaseAdapter,
  global: GlobalConfig,
  parentId: number,
  fallbackDoc: DocumentData,
  isLocalized: boolean,
): Promise<DocumentData> {
  if (txDb.findLatestDraftVersion) {
    const latestDraft = await txDb.findLatestDraftVersion({ global, parentId })
    if (latestDraft) return latestDraft.snapshot
  }
  if (isLocalized && txDb.findGlobal) {
    const canonical = await txDb.findGlobal({ global, locale: 'all' })
    if (canonical) return canonical
  }
  return fallbackDoc
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
  locale?: string
  config?: Config
}): Promise<MutationExecutionResult> {
  const parentId = Number(args.existing?.id ?? 1)
  const isLocalized = Boolean(args.config?.localization)
  const defaultLocale = args.config?.localization?.defaultLocale
  const baseSnapshot = await resolveBaseGlobalDraftSnapshot(
    args.txDb,
    args.global,
    parentId,
    args.existing ?? {},
    isLocalized,
  )

  const draftDoc = buildDraftRevisionDoc(
    parentId,
    baseSnapshot,
    args.finalData,
    args.global.fields,
    args.locale,
    defaultLocale,
  )
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
    locale: args.locale,
  })
  const projectedDoc =
    isLocalized && args.locale !== 'all'
      ? projectCanonicalDoc(doc, args.global.fields, {
          locale: args.locale,
          defaultLocale,
        })
      : doc
  return { success: true, doc: { ...projectedDoc, _isPublished: true }, isDraftRevision: true }
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
  config?: Config
}): Promise<void> {
  if (args.pendingDraft) return
  const snapshot = await resolveCanonicalGlobalSnapshot(
    args.txDb,
    args.global,
    args.saved,
    Boolean(args.config?.localization),
  )
  await maybeSaveGlobalVersion({
    txDb: args.txDb,
    global: args.global,
    parentId: args.parentId,
    snapshot,
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
  locale?: string
  config?: Config
}): Promise<MutationExecutionResult> {
  const operation = args.existing ? 'update' : 'create'
  const dataToUpdate = resolveGlobalParentRowData({
    global: args.global,
    existing: args.existing,
    finalData: args.finalData,
    status: args.status,
    statusTransition: args.statusTransition,
  })
  const saved = await args.txDb.updateGlobal({
    global: args.global,
    data: dataToUpdate,
    locale: args.locale,
  })
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
    config: args.config,
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
    locale: args.locale,
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
  locale?: string
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
    locale: args.locale,
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
  locale?: string
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
      locale: args.locale,
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
  locale?: string
  webhookLocale?: string
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
      locale: args.locale,
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
          locale: args.locale,
          config: args.config,
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
          locale: args.locale,
          config: args.config,
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
    const validationBody = mapDatabaseValidationError(err)
    if (validationBody) {
      return { success: false, status: 400, body: validationBody }
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
      locale: args.webhookLocale ?? args.locale,
    })
  }

  return result
}
