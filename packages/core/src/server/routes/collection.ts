import type { Context, Hono, Next } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { accessDenied, checkAccess, validateQueryAccess } from '../../access'
import type { AuthUser, LontarVariables } from '../../auth/types'
import { clientFieldsToZod } from '../../client/zod'
import { toClientCollection } from '../../config/to-client-config'
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type CollectionConfig,
  type Config,
  type LocalizationConfig,
} from '../../config/types'
import { ForeignKeyConstraintError, type DocumentData } from '../../database/adapter'
import {
  AccessDeniedError,
  createOperation,
  deleteOperation,
  executeCreate,
  executeUpdate,
  findByIDOperation,
  findOperation,
  findVersionByIDOperation,
  findVersionsOperation,
  NotFoundError,
  publishOperation,
  restoreVersionOperation,
  unpublishOperation,
  updateOperation,
  ValidationError,
} from '../../operations'
import { parseDepth } from '../../populate'
import type { Where } from '../../query/types'
import { parseWhereFromSearchParams } from '../../query/parser'
import { validateSort, validateWhere } from '../../query/validator'
import { DEFAULT_MAX_FILE_SIZE } from '../../storage'
import {
  handleServeFile,
  handleUploadCreate,
  handleUploadUpdate,
  isMultipartRequest,
} from './collection-upload'

type LontarEnv = { Variables: LontarVariables }

function parseId(param: string | undefined): number | null {
  if (!param) return null
  const id = parseInt(param, 10)
  return isNaN(id) || id <= 0 ? null : id
}

async function parseJsonBody(c: Context<LontarEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

function resolvePaginationLimits(
  collection: CollectionConfig,
  config: Config,
): { defaultLimit: number; maxLimit: number } {
  const defaultLimit =
    collection.pagination?.defaultLimit ?? config.pagination?.defaultLimit ?? DEFAULT_LIMIT
  const maxLimit = collection.pagination?.maxLimit ?? config.pagination?.maxLimit ?? MAX_LIMIT
  return { defaultLimit, maxLimit }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function resolvePagination(
  query: (key: string) => string | undefined,
  collection: CollectionConfig,
  config: Config,
): { page: number; limit: number } {
  const { defaultLimit, maxLimit } = resolvePaginationLimits(collection, config)
  const page = parsePositiveInt(query('page'), 1)
  const limit = Math.min(parsePositiveInt(query('limit'), defaultLimit), maxLimit)
  return { page, limit }
}

function resolveWhereFilter(
  rawUrl: string,
  collection: CollectionConfig,
  localization?: LocalizationConfig,
) {
  const url = new URL(rawUrl)
  const where = parseWhereFromSearchParams(url.searchParams)
  if (!where) return { where: undefined }
  const issues = validateWhere(where, collection, localization)
  return issues.length > 0 ? { issues } : { where }
}

function extractFirstIssueMessage(issues: unknown[] | undefined, fallback: string): string {
  if (!issues || issues.length === 0) return fallback
  const first = issues[0]
  if (
    typeof first === 'object' &&
    first !== null &&
    'message' in first &&
    typeof first.message === 'string'
  ) {
    return first.message
  }
  return fallback
}

export function formatValidationError(c: Context, err: ValidationError): Response {
  if (err.issues && err.issues.length > 0) {
    return c.json(
      {
        error: 'Validation failed',
        message: extractFirstIssueMessage(err.issues, err.message),
        issues: err.issues,
      },
      400,
    )
  }
  return c.json({ error: err.message }, 400)
}

interface FindQueryCheck {
  where?: Where
  errorResponse?: { error: string; message?: string; issues: unknown[] }
}

async function validateFindQuery(
  rawUrl: string,
  sort: string | undefined,
  collection: CollectionConfig,
  user: AuthUser | null,
  config: Config,
): Promise<FindQueryCheck> {
  const localization = config.localization
  const whereResult = resolveWhereFilter(rawUrl, collection, localization)
  if ('issues' in whereResult && whereResult.issues) {
    return {
      errorResponse: {
        error: 'Validation failed',
        message: whereResult.issues[0]?.message,
        issues: whereResult.issues,
      },
    }
  }

  if (sort) {
    const sortIssues = validateSort(sort, collection, localization)
    if (sortIssues.length > 0) {
      return {
        errorResponse: {
          error: 'Validation failed',
          message: sortIssues[0]?.message,
          issues: sortIssues,
        },
      }
    }
  }

  const accessIssues = await validateQueryAccess(whereResult.where, sort, collection, user)
  if (accessIssues.length > 0) {
    return {
      errorResponse: {
        error: 'Validation failed',
        message: accessIssues[0]?.message,
        issues: accessIssues,
      },
    }
  }

  return { where: whereResult.where }
}

async function handleFind(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const { page, limit } = resolvePagination((k) => c.req.query(k), collection, config)
  const sort = c.req.query('sort')
  const depth = parseDepth(c.req.query('depth'))
  const draft = c.req.query('draft') === 'true'
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  const queryCheck = await validateFindQuery(c.req.raw.url, sort, collection, user, config)
  if (queryCheck.errorResponse) {
    return c.json(queryCheck.errorResponse, 400)
  }

  try {
    const result = await findOperation({
      config,
      collection,
      where: queryCheck.where,
      sort,
      page,
      limit,
      depth,
      draft,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    return c.json(result, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof ValidationError) {
      return formatValidationError(c, err)
    }
    throw err
  }
}

async function handleFindByID(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const depth = parseDepth(c.req.query('depth'))
  const draft = c.req.query('draft') === 'true'
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const doc = await findByIDOperation({
      config,
      collection,
      id,
      depth,
      draft,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    if (!doc) {
      return c.json({ error: `Document with ID ${id} not found` }, 404)
    }
    return c.json(doc, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof ValidationError) {
      return formatValidationError(c, err)
    }
    throw err
  }
}

async function handleCreate(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  if (collection.upload) {
    const schema = clientFieldsToZod(toClientCollection(collection).fields)
    return handleUploadCreate({
      c,
      collection,
      config,
      schema,
      user,
      checkAccess,
      accessDenied,
      executeCreate,
    })
  }

  const body = await parseJsonBody(c)
  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const depth = parseDepth(c.req.query('depth'))
  const draft = c.req.query('draft') === 'true'
  const autosave = c.req.query('autosave') === 'true'

  try {
    const doc = await createOperation({
      config,
      collection,
      data: body as DocumentData,
      depth,
      draft,
      autosave,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    return c.json(doc, 201)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof ValidationError) {
      return formatValidationError(c, err)
    }
    throw err
  }
}

async function handleJsonUpdate(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
  id: number | null,
  user: AuthUser | null,
) {
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const body = await parseJsonBody(c)
  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const depth = parseDepth(c.req.query('depth'))
  const draft = c.req.query('draft') === 'true'
  const autosave = c.req.query('autosave') === 'true'
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const doc = await updateOperation({
      config,
      collection,
      id,
      data: body as DocumentData,
      depth,
      draft,
      autosave,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleMutationError(err, c, user)
  }
}

function handleMutationError(err: unknown, c: Context<LontarEnv>, user: AuthUser | null) {
  if (err instanceof AccessDeniedError) {
    return accessDenied(c, user)
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404)
  }
  if (err instanceof ValidationError) {
    return formatValidationError(c, err)
  }
  throw err
}

async function handlePublish(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const depth = parseDepth(c.req.query('depth'))
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const doc = await publishOperation({
      config,
      collection,
      id,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleMutationError(err, c, user)
  }
}

async function handleUnpublish(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const depth = parseDepth(c.req.query('depth'))
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const doc = await unpublishOperation({
      config,
      collection,
      id,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleMutationError(err, c, user)
  }
}

async function handleUpdate(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))

  if (collection.upload && isMultipartRequest(c)) {
    if (id === null) {
      return c.json({ error: 'Invalid document ID' }, 400)
    }
    return handleUploadUpdate({
      c,
      id,
      collection,
      config,
      user,
      checkAccess,
      accessDenied,
      executeUpdate,
    })
  }

  return handleJsonUpdate(c, collection, config, id, user)
}

async function handleDelete(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const doc = await deleteOperation({
      config,
      collection,
      id,
      overrideAccess: false,
      user,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    if (!doc) {
      return c.json({ error: `Document with ID ${id} not found` }, 404)
    }
    return c.json(doc, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof ValidationError) {
      return formatValidationError(c, err)
    }
    if (err instanceof ForeignKeyConstraintError) {
      const message = err.table
        ? `Cannot delete document referenced by "${err.table}"`
        : 'Cannot delete document referenced by other documents'
      return c.json({ error: message }, 409)
    }
    throw err
  }
}

async function handleFindVersions(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
) {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }
  const user = c.get('user') ?? null
  const { page, limit } = resolvePagination((k) => c.req.query(k), collection, config)
  const sort = c.req.query('sort')
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const result = await findVersionsOperation({
      config,
      collection,
      id,
      page,
      limit,
      sort,
      user,
      overrideAccess: false,
      locale,
      fallbackLocale,
    })
    return c.json(result, 200)
  } catch (err) {
    return handleMutationError(err, c, user)
  }
}

async function handleFindVersionByID(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
) {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }
  const versionId = parseId(c.req.param('versionId'))
  if (versionId === null) {
    return c.json({ error: 'Invalid version ID' }, 400)
  }
  const user = c.get('user') ?? null
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const result = await findVersionByIDOperation({
      config,
      collection,
      id,
      versionId,
      user,
      overrideAccess: false,
      locale,
      fallbackLocale,
    })
    return c.json(result, 200)
  } catch (err) {
    return handleMutationError(err, c, user)
  }
}

async function handleRestoreVersion(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
) {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }
  const versionId = parseId(c.req.param('versionId'))
  if (versionId === null) {
    return c.json({ error: 'Invalid version ID' }, 400)
  }
  const user = c.get('user') ?? null
  const depth = parseDepth(c.req.query('depth'))
  const draft = c.req.query('draft') !== undefined ? c.req.query('draft') === 'true' : undefined
  const locale = c.req.query('locale')
  const fallbackLocale = c.req.query('fallbackLocale')

  try {
    const doc = await restoreVersionOperation({
      config,
      collection,
      id,
      versionId,
      draft,
      depth,
      user,
      overrideAccess: false,
      req: c.req.raw,
      locale,
      fallbackLocale,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleMutationError(err, c, user)
  }
}

function getUploadMaxFileSize(upload: CollectionConfig['upload']): number {
  if (typeof upload === 'object' && upload?.maxFileSize) {
    return upload.maxFileSize
  }
  return DEFAULT_MAX_FILE_SIZE
}

function checkUploadBodyLimit(
  c: Context<LontarEnv>,
  next: Next,
  upload: CollectionConfig['upload'],
) {
  if (!upload || !isMultipartRequest(c)) {
    return next()
  }
  const maxFileSize = getUploadMaxFileSize(upload)
  return bodyLimit({
    maxSize: maxFileSize + 1024 * 1024,
    onError: () => c.json({ error: 'Payload too large' }, 413),
  })(c as never, next)
}

function createPostUploadLimitMiddleware(
  findCol: (c: Context<LontarEnv>) => CollectionConfig | null,
) {
  return async (c: Context<LontarEnv>, next: Next) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    const user = c.get('user') ?? null
    const allowed = await checkAccess(col.access?.create, { user })
    if (!allowed) return accessDenied(c, user)
    return checkUploadBodyLimit(c, next, col.upload)
  }
}

function createPatchUploadLimitMiddleware(
  findCol: (c: Context<LontarEnv>) => CollectionConfig | null,
) {
  return async (c: Context<LontarEnv>, next: Next) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    const id = parseId(c.req.param('id'))
    const user = c.get('user') ?? null
    const allowed = await checkAccess(col.access?.update, { user, id: id ?? undefined })
    if (!allowed) return accessDenied(c, user)
    return checkUploadBodyLimit(c, next, col.upload)
  }
}

export function registerCollectionRoutes(router: Hono<LontarEnv>, config: Config): void {
  const collections = new Map(config.collections.map((col) => [col.slug, col]))

  function findCol(c: Context<LontarEnv>): CollectionConfig | null {
    const slug = c.req.param('collection')
    if (!slug) return null
    return collections.get(slug) ?? null
  }

  const postLimit = createPostUploadLimitMiddleware(findCol)
  const patchLimit = createPatchUploadLimitMiddleware(findCol)

  router.get('/:collection', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleFind(c, col, config)
  })

  router.get('/:collection/file/:filename{.+}', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleServeFile(c, col, config)
  })

  router.get('/:collection/:id', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleFindByID(c, col, config)
  })

  router.get('/:collection/:id/versions', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleFindVersions(c, col, config)
  })

  router.get('/:collection/:id/versions/:versionId', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleFindVersionByID(c, col, config)
  })

  router.post('/:collection', postLimit, (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleCreate(c, col, config)
  })

  router.post('/:collection/:id/publish', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handlePublish(c, col, config)
  })

  router.post('/:collection/:id/unpublish', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleUnpublish(c, col, config)
  })

  router.post('/:collection/:id/versions/:versionId/restore', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleRestoreVersion(c, col, config)
  })

  router.patch('/:collection/:id', patchLimit, (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleUpdate(c, col, config)
  })

  router.delete('/:collection/:id', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleDelete(c, col, config)
  })
}
