import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { DocStatus } from '../client/system-fields'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection, toClientGlobal } from '../config/to-client-config'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import { runBeforeValidateHooks } from '../hooks'
import type { DocStatusTransition } from '../hooks/types'
import { populateDoc } from '../populate'
import { AccessDeniedError, NotFoundError, ValidationError } from './errors'
import { executeGlobalUpdate, executeUpdate, type MutationExecutionResult } from './mutation'
import { cleanupReplacedMedia } from '../server/routes/collection-upload'

export interface PublishOperationArgs {
  config: Config
  collection: CollectionConfig
  id: number
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  req?: Request
}

export interface PublishGlobalOperationArgs {
  config: Config
  global: GlobalConfig
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  req?: Request
}

async function assertPublishAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.update, {
    user: user ?? null,
    id,
  })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

type MutationFailure = Extract<MutationExecutionResult, { success: false }>

function handleMutationResult(result: MutationFailure, id: number, action: string): never {
  if (result.status === 400 && 'issues' in result.body) {
    throw new ValidationError('Validation failed', { issues: result.body.issues })
  }
  if (result.status === 404) {
    throw new NotFoundError(result.body.error ?? `Document with ID ${id} not found`)
  }
  throw new Error(result.body.error ?? `${action} failed`)
}

async function resolvePublishPayload(
  db: Config['db'],
  collection: CollectionConfig,
  id: number,
  originalDoc: DocumentData,
  statusTransition: DocStatusTransition,
): Promise<DocumentData> {
  if (statusTransition === 'publish' && collection.versions && db.findLatestDraftVersion) {
    const latestDraft = await db.findLatestDraftVersion({ collection, parentId: id })
    if (latestDraft) {
      return latestDraft.snapshot
    }
  }
  return originalDoc
}

async function maybeCleanupPublishedMedia(
  args: PublishOperationArgs,
  originalDoc: DocumentData,
  resultDoc: DocumentData,
  statusTransition: DocStatusTransition,
): Promise<void> {
  if (args.collection.upload && statusTransition === 'publish') {
    await cleanupReplacedMedia(args.config, originalDoc, resultDoc)
  }
}

function validatePublishData(
  collection: CollectionConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
): DocumentData {
  const clientCol = toClientCollection(collection)
  const schema = clientFieldsToZod(clientCol.fields, { originalDoc })
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

async function prepareTransitionDocumentPayload(
  collection: CollectionConfig,
  publishPayload: DocumentData,
  originalDoc: DocumentData,
  status: DocStatus,
  statusTransition: DocStatusTransition,
  req?: Request,
): Promise<DocumentData> {
  const dataForUpdate: DocumentData = { ...publishPayload, _status: status }
  if (statusTransition === 'publish') {
    const hookData = await runBeforeValidateHooks({
      collection,
      data: dataForUpdate,
      operation: 'update',
      originalDoc,
      status,
      previousStatus: (originalDoc._status as DocStatus | undefined) ?? 'draft',
      statusTransition,
      req,
    })
    const validatedData = validatePublishData(collection, hookData, originalDoc)
    return { ...hookData, ...validatedData, _status: status }
  }
  if (statusTransition === 'unpublish') {
    const hookData = await runBeforeValidateHooks({
      collection,
      data: dataForUpdate,
      operation: 'update',
      originalDoc,
      status,
      previousStatus: (originalDoc._status as DocStatus | undefined) ?? 'published',
      statusTransition,
      req,
    })
    return { ...hookData, _status: status }
  }
  return dataForUpdate
}

async function transitionDocumentStatus<T = DocumentData>(
  args: PublishOperationArgs,
  status: DocStatus,
  statusTransition: DocStatusTransition,
  action: string,
): Promise<T> {
  if (!args.collection.versions?.drafts) {
    throw new ValidationError(`Drafts are not enabled for collection "${args.collection.slug}"`)
  }

  if (!args.overrideAccess) {
    await assertPublishAccess(args.collection, args.id, args.user)
  }

  const runTransition = async (
    txDb: DatabaseAdapter,
  ): Promise<{ resultDoc: DocumentData; originalDoc: DocumentData }> => {
    const originalDoc = await txDb.findByID({
      collection: args.collection,
      id: args.id,
      forUpdate: true,
    })
    if (!originalDoc) {
      throw new NotFoundError(`Document with ID ${args.id} not found`)
    }

    const publishPayload = await resolvePublishPayload(
      txDb,
      args.collection,
      args.id,
      originalDoc,
      statusTransition,
    )

    const finalData = await prepareTransitionDocumentPayload(
      args.collection,
      publishPayload,
      originalDoc,
      status,
      statusTransition,
      args.req,
    )

    const result = await executeUpdate({
      collection: args.collection,
      id: args.id,
      data: finalData,
      originalDoc,
      db: txDb,
      req: args.req,
      status,
      statusTransition,
      userId: args.user?.id,
      config: args.config,
    })

    if (!result.success) {
      handleMutationResult(result, args.id, action)
    }

    return { resultDoc: result.doc, originalDoc }
  }

  const { resultDoc, originalDoc } = args.config.db.transaction
    ? await args.config.db.transaction(runTransition)
    : await runTransition(args.config.db)

  await maybeCleanupPublishedMedia(args, originalDoc, resultDoc, statusTransition)

  const populated = await populateDoc(resultDoc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
  })

  return populated as T
}

export function publishOperation<T = DocumentData>(args: PublishOperationArgs): Promise<T> {
  return transitionDocumentStatus<T>(args, 'published', 'publish', 'Publish')
}

export function unpublishOperation<T = DocumentData>(args: PublishOperationArgs): Promise<T> {
  return transitionDocumentStatus<T>(args, 'draft', 'unpublish', 'Unpublish')
}

async function assertGlobalPublishAccess(
  global: GlobalConfig,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(global.access?.update, { user: user ?? null })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function resolveGlobalPublishPayload(
  db: Config['db'],
  global: GlobalConfig,
  originalDoc: DocumentData,
  statusTransition: DocStatusTransition,
): Promise<DocumentData> {
  if (statusTransition === 'publish' && global.versions && db.findLatestDraftVersion) {
    const parentId = Number(originalDoc.id ?? 1)
    const latestDraft = await db.findLatestDraftVersion({ global, parentId })
    if (latestDraft) {
      return latestDraft.snapshot
    }
  }
  return originalDoc
}

function assertGlobalTransitionSuccess(
  result: Awaited<ReturnType<typeof executeGlobalUpdate>>,
  action: string,
): asserts result is { success: true; doc: DocumentData } {
  if (!result.success) {
    if (result.status === 400 && 'issues' in result.body) {
      throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
    }
    throw new Error(result.body.error ?? `${action} failed`)
  }
}

async function populateGlobalTransitionDoc<T>(args: {
  doc: DocumentData
  global: GlobalConfig
  config: Config
  depth?: number
  user?: AuthUser | null
  req?: Request
  overrideAccess?: boolean
}): Promise<T> {
  if (args.depth !== undefined && args.depth > 0) {
    const populated = await populateDoc(args.doc, {
      collection: { slug: args.global.slug, fields: args.global.fields },
      depth: args.depth,
      collections: args.config.collections,
      db: args.config.db,
      user: args.user ?? null,
      req: args.req,
      overrideAccess: args.overrideAccess,
    })
    return populated as T
  }
  return args.doc as T
}

function validateGlobalPublishData(
  global: GlobalConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
): DocumentData {
  const clientGlobal = toClientGlobal(global)
  const schema = clientFieldsToZod(clientGlobal.fields, { originalDoc })
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

async function prepareTransitionGlobalPayload(
  global: GlobalConfig,
  publishPayload: DocumentData,
  originalDoc: DocumentData,
  status: DocStatus,
  statusTransition: DocStatusTransition,
  req?: Request,
): Promise<DocumentData> {
  const dataForUpdate: DocumentData = { ...publishPayload, _status: status }
  if (statusTransition === 'publish') {
    const hookData = await runBeforeValidateHooks({
      global,
      data: dataForUpdate,
      operation: 'update',
      originalDoc,
      status,
      previousStatus: (originalDoc._status as DocStatus | undefined) ?? 'draft',
      statusTransition,
      req,
    })
    const validatedData = validateGlobalPublishData(global, hookData, originalDoc)
    return { ...hookData, ...validatedData, _status: status }
  }
  if (statusTransition === 'unpublish') {
    const hookData = await runBeforeValidateHooks({
      global,
      data: dataForUpdate,
      operation: 'update',
      originalDoc,
      status,
      previousStatus: (originalDoc._status as DocStatus | undefined) ?? 'published',
      statusTransition,
      req,
    })
    return { ...hookData, _status: status }
  }
  return dataForUpdate
}

async function transitionGlobalStatus<T = DocumentData>(
  args: PublishGlobalOperationArgs,
  status: DocStatus,
  statusTransition: DocStatusTransition,
  action: string,
): Promise<T> {
  if (!args.global.versions?.drafts) {
    throw new ValidationError(`Drafts are not enabled for global "${args.global.slug}"`)
  }

  if (!args.overrideAccess) {
    await assertGlobalPublishAccess(args.global, args.user)
  }

  const runTransition = async (txDb: DatabaseAdapter): Promise<DocumentData> => {
    const originalDoc = await txDb.findGlobal({ global: args.global, forUpdate: true })
    if (!originalDoc) {
      throw new NotFoundError(`Global "${args.global.slug}" not found`)
    }

    const publishPayload = await resolveGlobalPublishPayload(
      txDb,
      args.global,
      originalDoc,
      statusTransition,
    )

    const finalData = await prepareTransitionGlobalPayload(
      args.global,
      publishPayload,
      originalDoc,
      status,
      statusTransition,
      args.req,
    )

    const result = await executeGlobalUpdate({
      global: args.global,
      existing: originalDoc,
      data: finalData,
      db: txDb,
      req: args.req,
      status,
      statusTransition,
      userId: args.user?.id,
      config: args.config,
    })

    assertGlobalTransitionSuccess(result, action)
    return result.doc
  }

  const resultDoc = args.config.db.transaction
    ? await args.config.db.transaction(runTransition)
    : await runTransition(args.config.db)

  return populateGlobalTransitionDoc<T>({
    doc: resultDoc,
    global: args.global,
    config: args.config,
    depth: args.depth,
    user: args.user,
    req: args.req,
    overrideAccess: args.overrideAccess,
  })
}

export function publishGlobalOperation<T = DocumentData>(
  args: PublishGlobalOperationArgs,
): Promise<T> {
  return transitionGlobalStatus<T>(args, 'published', 'publish', 'Publish')
}

export function unpublishGlobalOperation<T = DocumentData>(
  args: PublishGlobalOperationArgs,
): Promise<T> {
  return transitionGlobalStatus<T>(args, 'draft', 'unpublish', 'Unpublish')
}
