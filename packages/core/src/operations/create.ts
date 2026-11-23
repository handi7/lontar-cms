import {
  checkAccess,
  matchesConstraint,
  resolveAccess,
  sanitizeDocRead,
  sanitizeDocWrite,
} from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection } from '../config/to-client-config'
import type { AccessArgs, CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { populateDoc } from '../populate'
import { AccessDeniedError, ValidationError } from './errors'
import { extractLocaleCodes, resolveOperationLocale } from './locale'
import {
  executeCreate,
  resolveCreateStatus,
  resolveDraftFlag,
  type MutationExecutionResult,
} from './mutation'
import { runBeforeValidateHooks } from '../hooks'
import { resolveOperationContextCache, type CreateOperationArgs } from './types'

async function assertCreateAccess(
  collection: CollectionConfig,
  data: DocumentData,
  user?: AuthUser | null,
  locale?: string,
): Promise<void> {
  const accessArgs: AccessArgs = { user: user ?? null, data }
  if (locale !== undefined) {
    accessArgs.locale = locale
  }
  const allowed = await checkAccess(collection.access?.create, accessArgs)
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateCreateData(
  collection: CollectionConfig,
  data: DocumentData,
  locale?: string,
  locales?: string[],
): DocumentData {
  const clientCol = toClientCollection(collection)
  const schema = clientFieldsToZod(clientCol.fields, { locale, locales })
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

function assertCreateResultSuccess(result: MutationExecutionResult): DocumentData {
  if (!result.success) {
    if (result.status === 400 && 'issues' in result.body) {
      throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
    }
    throw new Error(result.body.error ?? 'Create failed')
  }
  return result.doc
}

/**
 * Whether the creator may see the draft they just made populated. `update` access can return a
 * constraint (ADR 0030), so it is read as a decision and the new document is checked against it.
 */
async function canPopulateCreateDraft(
  args: CreateOperationArgs,
  docId: unknown,
  draft?: boolean,
  locale?: string,
): Promise<boolean> {
  if (args.overrideAccess) return true
  if (!draft) return false
  const numericId = typeof docId === 'number' ? docId : Number(docId) || undefined
  const decision = await resolveAccess(
    args.collection,
    'update',
    { user: args.user ?? null, id: numericId, locale },
    args.config,
  )
  if (!decision.allowed) return false
  if (!decision.constraint) return true
  if (numericId === undefined) return false
  return matchesConstraint({
    config: args.config,
    collection: args.collection,
    id: numericId,
    constraint: decision.constraint,
    locale,
  })
}

async function prepareCreateWriteData(
  args: CreateOperationArgs,
  cache: FieldAccessCache,
  locale?: string,
): Promise<DocumentData> {
  if (args.overrideAccess) return args.data
  return sanitizeDocWrite(args.collection.fields, args.data, 'create', {
    user: args.user ?? null,
    data: args.data,
    cache,
    req: args.req,
    locale,
  })
}

export async function createOperation<T = DocumentData>(args: CreateOperationArgs): Promise<T> {
  const cache = resolveOperationContextCache(args)
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  const locales = extractLocaleCodes(args.config)

  if (!args.overrideAccess) {
    await assertCreateAccess(args.collection, args.data, args.user, locale)
  }

  const writeData = await prepareCreateWriteData(args, cache, locale)

  const draft = resolveDraftFlag(args.collection, args.draft, args.autosave)
  const { status, statusTransition } = resolveCreateStatus(args.collection, draft)
  const { _status: _ignoredStatus, ...cleanData } = writeData
  const hookData = await runBeforeValidateHooks({
    collection: args.collection,
    data: cleanData,
    operation: 'create',
    status,
    previousStatus: undefined,
    statusTransition,
    req: args.req,
    locale,
  })

  const validatedData = validateCreateData(args.collection, hookData, locale, locales)

  const result = await executeCreate({
    collection: args.collection,
    data: validatedData,
    db: args.config.db,
    req: args.req,
    draft,
    autosave: args.autosave,
    userId: args.user?.id,
    config: args.config,
    locale,
  })

  const createdDoc = assertCreateResultSuccess(result)
  const canPopulateDraft = await canPopulateCreateDraft(args, createdDoc.id, draft, locale)

  const populated = await populateDoc(createdDoc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    localization: args.config.localization,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft: canPopulateDraft,
    cache,
    locale,
    fallbackLocale,
  })

  if (args.overrideAccess) {
    return populated as T
  }

  const sanitized = await sanitizeDocRead(args.collection.fields, populated, args.user ?? null, {
    id: createdDoc.id as string | number | undefined,
    doc: populated,
    cache,
    req: args.req,
    locale,
  })

  return sanitized as T
}
