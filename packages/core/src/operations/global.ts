import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientGlobal } from '../config/to-client-config'
import type { Config, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import { runAfterReadHooks, runBeforeValidateHooks } from '../hooks'
import { populateDoc } from '../populate'
import { AccessDeniedError, ValidationError } from './errors'
import { executeGlobalUpdate, resolveDraftFlag, resolveGlobalUpdateStatus } from './mutation'
import type { FindGlobalOperationArgs, UpdateGlobalOperationArgs } from './types'

async function assertGlobalReadAccess(
  global: GlobalConfig,
  user?: AuthUser | null,
  draft?: boolean,
): Promise<void> {
  const allowed = await checkAccess(global.access?.read, { user: user ?? null })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
  if (draft) {
    const updateAllowed = await checkAccess(global.access?.update, { user: user ?? null })
    if (!updateAllowed) {
      throw new AccessDeniedError('Access denied', { user })
    }
  }
}

async function assertGlobalUpdateAccess(
  global: GlobalConfig,
  data: DocumentData,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(global.access?.update, { user: user ?? null, data })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateGlobalData(
  global: GlobalConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
): DocumentData {
  const clientGlobal = toClientGlobal(global)
  const schema = clientFieldsToZod(clientGlobal.fields, { partial: true, originalDoc })
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

async function resolveOriginalGlobalDoc(
  db: DatabaseAdapter,
  global: GlobalConfig,
  draft?: boolean,
): Promise<DocumentData | null> {
  const baseDoc = await db.findGlobal({ global })
  if (!baseDoc) return null
  const shouldLoadDraft = draft ?? baseDoc._status === 'draft'
  if (shouldLoadDraft && global.versions && db.findLatestDraftVersion) {
    const parentId = Number(baseDoc.id ?? 1)
    const draftVersion = await db.findLatestDraftVersion({ global, parentId })
    if (draftVersion) {
      return {
        ...draftVersion.snapshot,
        id: parentId,
        _status: 'draft',
        _isPublished: baseDoc._status === 'published',
        createdAt: baseDoc.createdAt,
        updatedAt: draftVersion.createdAt,
      }
    }
  }
  return baseDoc
}

async function hydrateGlobalDraftDoc(
  db: Config['db'],
  global: GlobalConfig,
  baseDoc: DocumentData,
  draft?: boolean,
): Promise<DocumentData> {
  if (!global.versions?.drafts) {
    return baseDoc
  }
  const isPublished = baseDoc._status === 'published'
  if (!draft || !db.findLatestDraftVersion) {
    return { ...baseDoc, _isPublished: isPublished }
  }
  const parentId = Number(baseDoc.id ?? 1)
  const latestDraft = await db.findLatestDraftVersion({ global, parentId })
  if (latestDraft) {
    return { ...latestDraft.snapshot, _isPublished: isPublished }
  }
  return { ...baseDoc, _isPublished: isPublished }
}

function isGlobalDraftHidden(
  global: GlobalConfig,
  doc: DocumentData | null,
  draft?: boolean,
): boolean {
  return Boolean(global.versions?.drafts && !draft && doc && doc._status !== 'published')
}

export async function findGlobalOperation<T = DocumentData>(
  args: FindGlobalOperationArgs,
): Promise<T> {
  if (!args.overrideAccess) {
    await assertGlobalReadAccess(args.global, args.user, args.draft)
  }

  const doc = await args.config.db.findGlobal({ global: args.global, draft: args.draft })
  if (!doc || isGlobalDraftHidden(args.global, doc, args.draft)) {
    return {} as T
  }

  const rawDoc = await hydrateGlobalDraftDoc(args.config.db, args.global, doc, args.draft)
  const transformed = await runAfterReadHooks({
    global: args.global,
    doc: rawDoc,
    req: args.req,
  })

  return populateGlobalDoc<T>({
    doc: transformed,
    global: args.global,
    config: args.config,
    depth: args.depth,
    user: args.user,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
  })
}

function assertGlobalUpdateSuccess(
  result: Awaited<ReturnType<typeof executeGlobalUpdate>>,
): asserts result is { success: true; doc: DocumentData } {
  if (!result.success) {
    if (result.status === 400 && 'issues' in result.body) {
      throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
    }
    throw new Error(result.body.error ?? 'Global update failed')
  }
}

async function populateGlobalDoc<T>(args: {
  doc: DocumentData
  global: GlobalConfig
  config: Config
  depth?: number
  user?: AuthUser | null
  req?: Request
  overrideAccess?: boolean
  draft?: boolean
}): Promise<T> {
  if (args.depth !== undefined && args.depth > 0) {
    const populated = await populateDoc(args.doc, {
      collection: { slug: args.global.slug, fields: args.global.fields },
      depth: args.depth,
      db: args.config.db,
      user: args.user ?? null,
      collections: args.config.collections,
      req: args.req,
      overrideAccess: args.overrideAccess,
      draft: args.draft,
    })
    return populated as T
  }
  return args.doc as T
}

export async function updateGlobalOperation<T = DocumentData>(
  args: UpdateGlobalOperationArgs,
): Promise<T> {
  if (!args.overrideAccess) {
    await assertGlobalUpdateAccess(args.global, args.data, args.user)
  }

  const draft = resolveDraftFlag(args.global, args.draft, args.autosave)
  const existing = await resolveOriginalGlobalDoc(args.config.db, args.global, draft)
  const { _status: _ignoredStatus, ...cleanData } = args.data
  const { status, previousStatus, statusTransition } = resolveGlobalUpdateStatus({
    global: args.global,
    data: cleanData,
    originalDoc: existing,
    draft,
  })

  const hookData = await runBeforeValidateHooks({
    global: args.global,
    data: cleanData,
    operation: 'update',
    originalDoc: existing ?? undefined,
    status,
    previousStatus,
    statusTransition,
    req: args.req,
  })
  const validatedData = validateGlobalData(args.global, hookData, existing ?? undefined)

  const result = await executeGlobalUpdate({
    global: args.global,
    db: args.config.db,
    existing,
    data: validatedData,
    req: args.req,
    config: args.config,
    draft,
    autosave: args.autosave,
    status,
    statusTransition,
    userId: args.user?.id,
  })

  assertGlobalUpdateSuccess(result)

  return populateGlobalDoc<T>({
    doc: result.doc,
    global: args.global,
    config: args.config,
    depth: args.depth,
    user: args.user,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft,
  })
}
