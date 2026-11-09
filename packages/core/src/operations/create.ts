import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection } from '../config/to-client-config'
import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { populateDoc } from '../populate'
import { AccessDeniedError, ValidationError } from './errors'
import { executeCreate } from './mutation'
import type { CreateOperationArgs } from './types'

async function assertCreateAccess(
  collection: CollectionConfig,
  data: DocumentData,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(collection.access?.create, { user: user ?? null, data })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateCreateData(collection: CollectionConfig, data: DocumentData): DocumentData {
  const clientCol = toClientCollection(collection)
  const schema = clientFieldsToZod(clientCol.fields)
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

export async function createOperation<T = DocumentData>(args: CreateOperationArgs): Promise<T> {
  if (!args.overrideAccess) {
    await assertCreateAccess(args.collection, args.data, args.user)
  }

  const validatedData = validateCreateData(args.collection, args.data)

  const result = await executeCreate({
    collection: args.collection,
    data: validatedData,
    db: args.config.db,
    req: args.req,
    draft: args.draft,
    autosave: args.autosave,
    userId: args.user?.id,
  })

  if (!result.success) {
    if (result.status === 400 && 'issues' in result.body) {
      throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
    }
    throw new Error(result.body.error ?? 'Create failed')
  }

  const populated = await populateDoc(result.doc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
  })

  return populated as T
}
