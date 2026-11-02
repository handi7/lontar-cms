import type { Context, Hono, Next } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { z } from 'zod'
import { accessDenied, checkAccess } from '../../access'
import type { AuthUser, LontarVariables } from '../../auth/types'
import { clientFieldsToZod } from '../../client/zod'
import { toClientCollection } from '../../config/to-client-config'
import { DEFAULT_LIMIT, MAX_LIMIT, type CollectionConfig, type Config } from '../../config/types'
import type { DocumentData } from '../../database/adapter'
import {
  AccessDeniedError,
  createOperation,
  deleteOperation,
  executeCreate,
  executeUpdate,
  findByIDOperation,
  findOperation,
  NotFoundError,
  updateOperation,
  ValidationError,
} from '../../operations'
import { parseDepth } from '../../populate'
import { parseWhereFromSearchParams } from '../../query/parser'
import { validateWhere } from '../../query/validator'
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

function resolveWhereFilter(rawUrl: string, collection: CollectionConfig) {
  const url = new URL(rawUrl)
  const where = parseWhereFromSearchParams(url.searchParams)
  if (!where) return { where: undefined }
  const issues = validateWhere(where, collection)
  return issues.length > 0 ? { issues } : { where }
}

async function handleFind(c: Context<LontarEnv>, collection: CollectionConfig, config: Config) {
  const user = c.get('user') ?? null
  const { page, limit } = resolvePagination((k) => c.req.query(k), collection, config)
  const sort = c.req.query('sort')
  const depth = parseDepth(c.req.query('depth'))

  const whereResult = resolveWhereFilter(c.req.raw.url, collection)
  if ('issues' in whereResult && whereResult.issues) {
    return c.json({ error: 'Validation failed', issues: whereResult.issues }, 400)
  }

  try {
    const result = await findOperation({
      config,
      collection,
      where: whereResult.where,
      sort,
      page,
      limit,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(result, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof ValidationError) {
      return c.json({ error: 'Validation failed', issues: err.issues }, 400)
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

  try {
    const doc = await findByIDOperation({
      config,
      collection,
      id,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    if (!doc) {
      return c.json({ error: `Document with ID ${id} not found` }, 404)
    }
    return c.json(doc, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    throw err
  }
}

async function handleCreate(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
  schema: z.ZodType,
) {
  const user = c.get('user') ?? null

  if (collection.upload) {
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

  try {
    const doc = await createOperation({
      config,
      collection,
      data: body as DocumentData,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 201)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof ValidationError) {
      return c.json({ error: 'Validation failed', issues: err.issues }, 400)
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

  try {
    const doc = await updateOperation({
      config,
      collection,
      id,
      data: body as DocumentData,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: err.message }, 404)
    }
    if (err instanceof ValidationError) {
      return c.json({ error: 'Validation failed', issues: err.issues }, 400)
    }
    throw err
  }
}

async function handleUpdate(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  config: Config,
  partialSchema: z.ZodType,
) {
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
      partialSchema,
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

  try {
    const doc = await deleteOperation({
      config,
      collection,
      id,
      overrideAccess: false,
      user,
    })
    if (!doc) {
      return c.json({ error: `Document with ID ${id} not found` }, 404)
    }
    return c.json(doc, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    throw err
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

  router.post('/:collection', postLimit, (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    const schema = clientFieldsToZod(toClientCollection(col).fields)
    return handleCreate(c, col, config, schema)
  })

  router.patch('/:collection/:id', patchLimit, (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    const partialSchema = clientFieldsToZod(toClientCollection(col).fields).partial()
    return handleUpdate(c, col, config, partialSchema)
  })

  router.delete('/:collection/:id', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleDelete(c, col, config)
  })
}
