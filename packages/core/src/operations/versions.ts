import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig } from '../config/types'
import type { DocumentData, PaginatedVersions, StoredVersion } from '../database/adapter'
import { AccessDeniedError, NotFoundError, ValidationError } from './errors'
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

async function assertReadAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.read, { user: user ?? null, id })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertUpdateAccess(
  collection: CollectionConfig,
  id: number,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.update, { user: user ?? null, id })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function assertVersionsEnabled(collection: CollectionConfig): void {
  if (!collection.versions) {
    throw new ValidationError(`Versions are not enabled for collection "${collection.slug}"`)
  }
}

export async function findVersionsOperation(
  args: FindVersionsOperationArgs,
): Promise<PaginatedVersions> {
  assertVersionsEnabled(args.collection)
  if (!args.overrideAccess) {
    await assertReadAccess(args.collection, args.id, args.user)
  }

  if (!args.config.db.findVersions) {
    throw new Error('Database adapter does not support version history')
  }

  return args.config.db.findVersions({
    collection: args.collection,
    parentId: args.id,
    page: args.page,
    limit: args.limit,
    sort: args.sort,
  })
}

export async function findVersionByIDOperation(
  args: FindVersionByIDOperationArgs,
): Promise<StoredVersion> {
  assertVersionsEnabled(args.collection)
  if (!args.overrideAccess) {
    await assertReadAccess(args.collection, args.id, args.user)
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

  return version
}

export async function restoreVersionOperation<T = DocumentData>(
  args: RestoreVersionOperationArgs,
): Promise<T> {
  assertVersionsEnabled(args.collection)
  if (!args.overrideAccess) {
    await assertUpdateAccess(args.collection, args.id, args.user)
  }

  const version = await findVersionByIDOperation({
    config: args.config,
    collection: args.collection,
    id: args.id,
    versionId: args.versionId,
    overrideAccess: true,
  })

  const draft = args.draft !== undefined ? args.draft : version._status === 'draft'

  return updateOperation<T>({
    config: args.config,
    collection: args.collection,
    id: args.id,
    data: version.snapshot,
    depth: args.depth,
    draft,
    overrideAccess: args.overrideAccess,
    user: args.user,
    req: args.req,
  })
}
