import { checkAccess, sanitizeDocRead, sanitizeDocWrite } from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientGlobal } from '../config/to-client-config'
import type { Config, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import { runAfterReadHooks, runBeforeValidateHooks } from '../hooks'
import { populateDoc } from '../populate'
import { AccessDeniedError, ValidationError } from './errors'
import {
  extractLocaleCodes,
  projectCanonicalDoc,
  resolveOperationLocale,
  type ProjectLocaleContext,
} from './locale'
import { executeGlobalUpdate, resolveDraftFlag, resolveGlobalUpdateStatus } from './mutation'
import {
  resolveOperationContextCache,
  type FindGlobalOperationArgs,
  type UpdateGlobalOperationArgs,
} from './types'

async function assertGlobalReadAccess(
  global: GlobalConfig,
  user?: AuthUser | null,
  draft?: boolean,
  locale?: string,
  req?: Request,
): Promise<void> {
  const allowed = await checkAccess(global.access?.read, { user: user ?? null, locale, req })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
  if (draft) {
    const updateAllowed = await checkAccess(global.access?.update, {
      user: user ?? null,
      locale,
      req,
    })
    if (!updateAllowed) {
      throw new AccessDeniedError('Access denied', { user })
    }
  }
}

async function assertGlobalUpdateAccess(
  global: GlobalConfig,
  data: DocumentData,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  const allowed = await checkAccess(global.access?.update, {
    user: user ?? null,
    data,
    locale,
    req,
  })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateGlobalData(
  global: GlobalConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
  localeOpts?: { locale?: string; locales?: readonly string[] },
): DocumentData {
  const clientGlobal = toClientGlobal(global)
  const schema = clientFieldsToZod(clientGlobal.fields, {
    partial: true,
    originalDoc,
    locale: localeOpts?.locale,
    locales: localeOpts?.locales,
  })
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

export async function resolveOriginalGlobalDoc(
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
  localeCtx?: ProjectLocaleContext,
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
    const projected = localeCtx
      ? projectCanonicalDoc(latestDraft.snapshot, global.fields, localeCtx)
      : latestDraft.snapshot
    return { ...projected, _isPublished: isPublished }
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
  const cache = resolveOperationContextCache(args)
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )

  if (!args.overrideAccess) {
    await assertGlobalReadAccess(args.global, args.user, args.draft, locale, args.req)
  }

  const doc = await args.config.db.findGlobal({
    global: args.global,
    draft: args.draft,
    locale,
    fallbackLocale,
  })
  if (!doc || isGlobalDraftHidden(args.global, doc, args.draft)) {
    return {} as T
  }

  const localeCtx: ProjectLocaleContext | undefined = args.config.localization
    ? {
        locale,
        fallbackLocale,
        defaultLocale: args.config.localization.defaultLocale,
      }
    : undefined

  const rawDoc = await hydrateGlobalDraftDoc(
    args.config.db,
    args.global,
    doc,
    args.draft,
    localeCtx,
  )
  const transformed = await runAfterReadHooks({
    global: args.global,
    doc: rawDoc,
    req: args.req,
    locale,
  })

  const populated = await populateGlobalDoc<T>({
    doc: transformed,
    global: args.global,
    config: args.config,
    depth: args.depth,
    user: args.user,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
    cache,
    locale,
    fallbackLocale,
  })

  if (args.overrideAccess) {
    return populated
  }

  const sanitized = await sanitizeDocRead(
    args.global.fields,
    populated as DocumentData,
    args.user ?? null,
    { doc: populated as DocumentData, cache, req: args.req, locale },
  )

  return sanitized as T
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
  cache?: FieldAccessCache
  locale?: string
  fallbackLocale?: string | false
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
      cache: args.cache,
      locale: args.locale,
      fallbackLocale: args.fallbackLocale,
    })
    return populated as T
  }
  return args.doc as T
}

async function prepareGlobalWriteData(
  args: UpdateGlobalOperationArgs,
  existing: DocumentData | null,
  cache: FieldAccessCache,
  locale?: string,
): Promise<DocumentData> {
  if (args.overrideAccess) return args.data
  return sanitizeDocWrite(args.global.fields, args.data, 'update', {
    user: args.user ?? null,
    data: args.data,
    doc: existing ?? undefined,
    cache,
    req: args.req,
    locale,
  })
}

export async function updateGlobalOperation<T = DocumentData>(
  args: UpdateGlobalOperationArgs,
): Promise<T> {
  const cache = resolveOperationContextCache(args)
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  const locales = extractLocaleCodes(args.config)

  if (!args.overrideAccess) {
    await assertGlobalUpdateAccess(args.global, args.data, args.user, locale, args.req)
  }

  const draft = resolveDraftFlag(args.global, args.draft, args.autosave)
  const existing = await resolveOriginalGlobalDoc(args.config.db, args.global, draft)
  const writeData = await prepareGlobalWriteData(args, existing, cache, locale)

  const { _status: _ignoredStatus, ...cleanData } = writeData
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
    locale,
  })
  const validatedData = validateGlobalData(args.global, hookData, existing ?? undefined, {
    locale,
    locales,
  })

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
    locale,
  })

  assertGlobalUpdateSuccess(result)

  const populated = await populateGlobalDoc<T>({
    doc: result.doc,
    global: args.global,
    config: args.config,
    depth: args.depth,
    user: args.user,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft,
    cache,
    locale,
    fallbackLocale,
  })

  if (args.overrideAccess) {
    return populated
  }

  const sanitized = await sanitizeDocRead(
    args.global.fields,
    populated as DocumentData,
    args.user ?? null,
    { doc: populated as DocumentData, cache, req: args.req, locale },
  )

  return sanitized as T
}
