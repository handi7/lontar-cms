import { checkAccess, sanitizeDocRead } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DocumentData, PaginatedVersions, StoredVersion } from '../database/adapter'
import type { Fields } from '../fields/types'
import { AccessDeniedError, NotFoundError, ValidationError } from './errors'
import { updateGlobalOperation } from './global'
import { projectCanonicalDoc, resolveOperationLocale } from './locale'
import type { OperationContext } from './types'
import { updateOperation } from './update'

export interface FindVersionsOperationArgs extends OperationContext {
  collection: CollectionConfig
  id: number
  page?: number
  limit?: number
  sort?: string
}

export interface FindVersionByIDOperationArgs extends OperationContext {
  collection: CollectionConfig
  id: number
  versionId: number
}

export interface RestoreVersionOperationArgs extends OperationContext {
  collection: CollectionConfig
  id: number
  versionId: number
  draft?: boolean
  depth?: number
}

export interface FindGlobalVersionsOperationArgs extends OperationContext {
  global: GlobalConfig
  page?: number
  limit?: number
  sort?: string
}

export interface FindGlobalVersionByIDOperationArgs extends OperationContext {
  global: GlobalConfig
  versionId: number
}

export interface RestoreGlobalVersionOperationArgs extends OperationContext {
  global: GlobalConfig
  versionId: number
  draft?: boolean
  depth?: number
}

async function assertReadAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.read, {
    user: user ?? null,
    id,
    locale,
    req,
  })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertUpdateAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.update, {
    user: user ?? null,
    id,
    locale,
    req,
  })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

// Version snapshots hold draft content, which ADR 0023 §5 gates behind update access.
async function assertVersionHistoryAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  await assertReadAccess(collection, id, user, locale, req)
  await assertUpdateAccess(collection, id, user, locale, req)
}

function assertVersionsEnabled(collection: CollectionConfig): void {
  if (!collection.versions) {
    throw new ValidationError(`Versions are not enabled for collection "${collection.slug}"`)
  }
}

function projectVersionSnapshot(
  snapshot: DocumentData,
  fields: Fields,
  config: Config,
  locale?: string,
  fallbackLocale?: string | false,
): DocumentData {
  if (!config.localization || locale === 'all') {
    return snapshot
  }
  return projectCanonicalDoc(snapshot, fields, {
    locale,
    fallbackLocale,
    defaultLocale: config.localization.defaultLocale,
  })
}

export async function findVersionsOperation(
  args: FindVersionsOperationArgs,
): Promise<PaginatedVersions> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  assertVersionsEnabled(args.collection)
  if (!args.overrideAccess) {
    await assertVersionHistoryAccess(args.collection, args.id, args.user, locale, args.req)
  }

  if (!args.config.db.findVersions) {
    throw new Error('Database adapter does not support version history')
  }

  const result = await args.config.db.findVersions({
    collection: args.collection,
    parentId: args.id,
    page: args.page,
    limit: args.limit,
    sort: args.sort,
  })

  const docs = await Promise.all(
    result.docs.map(async (v) => {
      const projected = projectVersionSnapshot(
        v.snapshot,
        args.collection.fields,
        args.config,
        locale,
        fallbackLocale,
      )

      if (args.overrideAccess) {
        return { ...v, snapshot: projected }
      }

      const sanitizedSnapshot = await sanitizeDocRead(
        args.collection.fields,
        projected,
        args.user ?? null,
        {
          id: args.id,
          doc: projected,
          req: args.req,
          locale,
        },
      )
      return { ...v, snapshot: sanitizedSnapshot }
    }),
  )

  return { ...result, docs }
}

export async function findVersionByIDOperation(
  args: FindVersionByIDOperationArgs,
): Promise<StoredVersion> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  assertVersionsEnabled(args.collection)
  if (!args.overrideAccess) {
    await assertVersionHistoryAccess(args.collection, args.id, args.user, locale, args.req)
  }

  if (!args.config.db.findVersionByID) {
    throw new Error('Database adapter does not support version history')
  }

  const version = await args.config.db.findVersionByID({
    collection: args.collection,
    parentId: args.id,
    versionId: args.versionId,
  })

  if (!version) {
    throw new NotFoundError(
      `Version ${args.versionId} not found for document ${args.id} in collection "${args.collection.slug}"`,
    )
  }

  const projected = projectVersionSnapshot(
    version.snapshot,
    args.collection.fields,
    args.config,
    locale,
    fallbackLocale,
  )

  if (args.overrideAccess) return { ...version, snapshot: projected }

  const sanitizedSnapshot = await sanitizeDocRead(
    args.collection.fields,
    projected,
    args.user ?? null,
    { id: args.id, doc: projected, req: args.req, locale },
  )

  return { ...version, snapshot: sanitizedSnapshot }
}

export async function restoreVersionOperation<T = DocumentData>(
  args: RestoreVersionOperationArgs,
): Promise<T> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  assertVersionsEnabled(args.collection)
  if (!args.overrideAccess) {
    await assertVersionHistoryAccess(args.collection, args.id, args.user, locale, args.req)
  }

  const isLocalized = Boolean(args.config.localization)

  const version = await findVersionByIDOperation({
    config: args.config,
    collection: args.collection,
    id: args.id,
    versionId: args.versionId,
    overrideAccess: true,
    locale: isLocalized ? 'all' : undefined,
  })

  const draft = args.draft !== undefined ? args.draft : version._status === 'draft'

  const restored = await updateOperation<DocumentData>({
    config: args.config,
    collection: args.collection,
    id: args.id,
    data: version.snapshot,
    depth: args.depth,
    draft,
    overrideAccess: args.overrideAccess,
    user: args.user,
    req: args.req,
    locale: isLocalized ? 'all' : locale,
    fallbackLocale: args.fallbackLocale,
  })

  if (isLocalized && locale !== 'all') {
    return projectCanonicalDoc(restored, args.collection.fields, {
      locale,
      fallbackLocale,
      defaultLocale: args.config.localization?.defaultLocale,
    }) as T
  }

  return restored as T
}

async function assertGlobalReadAccess(
  global: GlobalConfig,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  const allowed = await checkAccess(global.access?.read, { user: user ?? null, locale, req })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertGlobalUpdateAccess(
  global: GlobalConfig,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  const allowed = await checkAccess(global.access?.update, { user: user ?? null, locale, req })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertGlobalVersionHistoryAccess(
  global: GlobalConfig,
  user?: AuthUser | null,
  locale?: string,
  req?: Request,
): Promise<void> {
  await assertGlobalReadAccess(global, user, locale, req)
  await assertGlobalUpdateAccess(global, user, locale, req)
}

function assertGlobalVersionsEnabled(global: GlobalConfig): void {
  if (!global.versions) {
    throw new ValidationError(`Versions are not enabled for global "${global.slug}"`)
  }
}

export async function findGlobalVersionsOperation(
  args: FindGlobalVersionsOperationArgs,
): Promise<PaginatedVersions> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  assertGlobalVersionsEnabled(args.global)
  if (!args.overrideAccess) {
    await assertGlobalVersionHistoryAccess(args.global, args.user, locale, args.req)
  }

  if (!args.config.db.findVersions) {
    throw new Error('Database adapter does not support version history')
  }

  const existing = await args.config.db.findGlobal({ global: args.global })
  const parentId = Number(existing?.id ?? 1)

  const result = await args.config.db.findVersions({
    global: args.global,
    parentId,
    page: args.page,
    limit: args.limit,
    sort: args.sort,
  })

  const docs = await Promise.all(
    result.docs.map(async (v) => {
      const projected = projectVersionSnapshot(
        v.snapshot,
        args.global.fields,
        args.config,
        locale,
        fallbackLocale,
      )

      if (args.overrideAccess) return { ...v, snapshot: projected }

      const sanitizedSnapshot = await sanitizeDocRead(
        args.global.fields,
        projected,
        args.user ?? null,
        {
          id: parentId,
          doc: projected,
          req: args.req,
          locale,
        },
      )
      return { ...v, snapshot: sanitizedSnapshot }
    }),
  )

  return { ...result, docs }
}

export async function findGlobalVersionByIDOperation(
  args: FindGlobalVersionByIDOperationArgs,
): Promise<StoredVersion> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  assertGlobalVersionsEnabled(args.global)
  if (!args.overrideAccess) {
    await assertGlobalVersionHistoryAccess(args.global, args.user, locale, args.req)
  }

  if (!args.config.db.findVersionByID) {
    throw new Error('Database adapter does not support version history')
  }

  const existing = await args.config.db.findGlobal({ global: args.global })
  const parentId = Number(existing?.id ?? 1)

  const version = await args.config.db.findVersionByID({
    global: args.global,
    parentId,
    versionId: args.versionId,
  })

  if (!version) {
    throw new NotFoundError(`Version ${args.versionId} not found for global "${args.global.slug}"`)
  }

  const projected = projectVersionSnapshot(
    version.snapshot,
    args.global.fields,
    args.config,
    locale,
    fallbackLocale,
  )

  if (args.overrideAccess) return { ...version, snapshot: projected }

  const sanitizedSnapshot = await sanitizeDocRead(
    args.global.fields,
    projected,
    args.user ?? null,
    { id: parentId, doc: projected, req: args.req, locale },
  )

  return { ...version, snapshot: sanitizedSnapshot }
}

export async function restoreGlobalVersionOperation<T = DocumentData>(
  args: RestoreGlobalVersionOperationArgs,
): Promise<T> {
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  assertGlobalVersionsEnabled(args.global)
  if (!args.overrideAccess) {
    await assertGlobalVersionHistoryAccess(args.global, args.user, locale, args.req)
  }

  const isLocalized = Boolean(args.config.localization)

  const version = await findGlobalVersionByIDOperation({
    config: args.config,
    global: args.global,
    versionId: args.versionId,
    overrideAccess: true,
    locale: isLocalized ? 'all' : undefined,
  })

  const draft = args.draft !== undefined ? args.draft : version._status === 'draft'

  const restored = await updateGlobalOperation<DocumentData>({
    config: args.config,
    global: args.global,
    data: version.snapshot,
    depth: args.depth,
    draft,
    overrideAccess: args.overrideAccess,
    user: args.user,
    req: args.req,
    locale: isLocalized ? 'all' : locale,
    fallbackLocale: args.fallbackLocale,
  })

  if (isLocalized && locale !== 'all') {
    return projectCanonicalDoc(restored, args.global.fields, {
      locale,
      fallbackLocale,
      defaultLocale: args.config.localization?.defaultLocale,
    }) as T
  }

  return restored as T
}
