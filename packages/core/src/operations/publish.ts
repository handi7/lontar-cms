import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { DocStatus } from '../client/system-fields'
import type { CollectionConfig, Config } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { DocStatusTransition } from '../hooks/types'
import { populateDoc } from '../populate'
import { AccessDeniedError, NotFoundError, ValidationError } from './errors'
import { executeUpdate, type MutationExecutionResult } from './mutation'

export interface PublishOperationArgs {
  config: Config
  collection: CollectionConfig
  id: number
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

  const originalDoc = await args.config.db.findByID({
    collection: args.collection,
    id: args.id,
  })
  if (!originalDoc) {
    throw new NotFoundError(`Document with ID ${args.id} not found`)
  }

  const result = await executeUpdate({
    collection: args.collection,
    id: args.id,
    data: { ...originalDoc, _status: status },
    originalDoc,
    db: args.config.db,
    req: args.req,
    status,
    statusTransition,
  })

  if (!result.success) {
    handleMutationResult(result, args.id, action)
  }

  const populated = await populateDoc(result.doc, {
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
