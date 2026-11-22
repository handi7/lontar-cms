import { sanitizeDocRead, sanitizeDocWrite } from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { DocStatus } from '../client/system-fields'
import { clientFieldsToZod } from '../client/zod'
import { toClientCollection } from '../config/to-client-config'
import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { populateDoc } from '../populate'
import { NotFoundError, ValidationError } from './errors'
import { extractLocaleCodes, resolveOperationLocale } from './locale'
import {
  executeUpdate,
  resolveDraftFlag,
  resolveLocaleOriginalDoc,
  resolveOriginalDoc,
  resolveUpdateStatus,
} from './mutation'
import { cleanupReplacedMedia } from '../server/routes/collection-upload'
import { runBeforeValidateHooks } from '../hooks'
import type { DocStatusTransition } from '../hooks/types'
import { assertRowAccess } from './row-access'
import { resolveOperationContextCache, type UpdateOperationArgs } from './types'

function validateUpdateData(
  collection: CollectionConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
  locale?: string,
  locales?: string[],
): DocumentData {
  const clientCol = toClientCollection(collection)
  const partialSchema = clientFieldsToZod(clientCol.fields, {
    partial: true,
    originalDoc,
    locale,
    locales,
  })
  const parsed = partialSchema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

function handleUpdateError(
  result: { success: false; status: number; body: Record<string, unknown> },
  id: number,
): never {
  if (result.status === 400 && 'issues' in result.body) {
    throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
  }
  if (result.status === 404) {
    const errorMsg =
      typeof result.body.error === 'string' ? result.body.error : `Document with ID ${id} not found`
    throw new NotFoundError(errorMsg)
  }
  const fallback = typeof result.body.error === 'string' ? result.body.error : 'Update failed'
  throw new Error(fallback)
}

async function prepareUpdatePayload(
  args: UpdateOperationArgs,
  originalDoc: DocumentData,
  draft?: boolean,
  cache?: FieldAccessCache,
  locale?: string,
  locales?: string[],
): Promise<{
  validatedData: DocumentData
  status: DocStatus | undefined
  statusTransition: DocStatusTransition | undefined
}> {
  const writeData = args.overrideAccess
    ? args.data
    : await sanitizeDocWrite(args.collection.fields, args.data, 'update', {
        user: args.user ?? null,
        id: args.id,
        data: args.data,
        doc: originalDoc,
        cache,
        req: args.req,
        locale,
      })

  const { _status: _ignoredStatus, ...cleanData } = writeData
  const { status, previousStatus, statusTransition } = resolveUpdateStatus({
    collection: args.collection,
    data: cleanData,
    originalDoc,
    draft,
  })

  const hookData = await runBeforeValidateHooks({
    collection: args.collection,
    data: cleanData,
    operation: 'update',
    originalDoc,
    status,
    previousStatus,
    statusTransition,
    req: args.req,
    locale,
  })

  const validatedData = validateUpdateData(args.collection, hookData, originalDoc, locale, locales)
  return { validatedData, status, statusTransition }
}

async function finalizeUpdateDoc<T>(
  args: UpdateOperationArgs,
  resultDoc: DocumentData,
  originalDoc: DocumentData,
  draft?: boolean,
  status?: DocStatus,
  isDraftRevision?: boolean,
  cache?: FieldAccessCache,
  locale?: string,
  fallbackLocale?: string | false,
): Promise<T> {
  const isDraftUpdate = status === 'draft' || Boolean(isDraftRevision)
  if (args.collection.upload && !isDraftUpdate) {
    await cleanupReplacedMedia(args.config, originalDoc, resultDoc)
  }

  const populated = await populateDoc(resultDoc, {
    collection: args.collection,
    depth: args.depth ?? 0,
    collections: args.config.collections,
    localization: args.config.localization,
    db: args.config.db,
    user: args.user ?? null,
    req: args.req,
    overrideAccess: args.overrideAccess,
    draft,
    cache,
    locale,
    fallbackLocale,
  })

  if (args.overrideAccess) {
    return populated as T
  }

  const sanitized = await sanitizeDocRead(args.collection.fields, populated, args.user ?? null, {
    id: args.id,
    doc: populated,
    cache,
    req: args.req,
    locale,
  })

  return sanitized as T
}

export async function updateOperation<T = DocumentData>(args: UpdateOperationArgs): Promise<T> {
  const cache = resolveOperationContextCache(args)
  const { locale, fallbackLocale } = resolveOperationLocale(
    args.config,
    args.locale,
    args.fallbackLocale,
  )
  const locales = extractLocaleCodes(args.config)

  if (!args.overrideAccess) {
    await assertRowAccess({
      config: args.config,
      collection: args.collection,
      id: args.id,
      user: args.user,
      operations: ['update'],
      data: args.data,
      locale,
      fallbackLocale,
    })
  }

  const draft = resolveDraftFlag(args.collection, args.draft, args.autosave)
  const originalDoc = await resolveOriginalDoc(args.config.db, args.collection, args.id, draft)
  if (!originalDoc) {
    throw new NotFoundError(`Document with ID ${args.id} not found`)
  }

  const localeOriginalDoc = await resolveLocaleOriginalDoc(
    args.config.db,
    args.collection,
    args.id,
    originalDoc,
    args.config,
    locale,
  )

  const { validatedData, status, statusTransition } = await prepareUpdatePayload(
    args,
    localeOriginalDoc,
    draft,
    cache,
    locale,
    locales,
  )

  const result = await executeUpdate({
    collection: args.collection,
    id: args.id,
    data: validatedData,
    originalDoc,
    localeOriginalDoc,
    db: args.config.db,
    req: args.req,
    draft,
    status,
    statusTransition,
    autosave: args.autosave,
    userId: args.user?.id,
    config: args.config,
    locale,
  })

  if (!result.success) {
    handleUpdateError(result, args.id)
  }

  return finalizeUpdateDoc<T>(
    args,
    result.doc,
    originalDoc,
    draft,
    status,
    result.isDraftRevision,
    cache,
    locale,
    fallbackLocale,
  )
}
