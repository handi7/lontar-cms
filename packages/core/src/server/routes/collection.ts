import type { Context, Hono } from 'hono'
import type { z } from 'zod'
import type { AuthUser, LontarVariables } from '../../auth/types'
import { clientFieldsToZod } from '../../client/zod'
import { toClientCollection } from '../../config/to-client-config'
import type { AccessArgs, AccessFunction, CollectionConfig, Config } from '../../config/types'
import type { DatabaseAdapter, DocumentData } from '../../database/adapter'
import { parseWhereFromSearchParams } from '../../query/parser'

type LontarEnv = { Variables: LontarVariables }

function parseId(param: string | undefined): number | null {
  if (!param) return null
  const id = parseInt(param, 10)
  return isNaN(id) || id <= 0 ? null : id
}

async function checkAccess(fn: AccessFunction | undefined, args: AccessArgs): Promise<boolean> {
  if (!fn) return true
  try {
    const result = await fn(args)
    return Boolean(result)
  } catch {
    return false
  }
}

function accessDenied(c: Context<LontarEnv>, user: AuthUser | null) {
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json({ error: 'Forbidden' }, 403)
}

async function parseJsonBody(c: Context<LontarEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

async function handleFind(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  db: DatabaseAdapter,
) {
  const user = c.get('user') ?? null
  const allowed = await checkAccess(collection.access?.read, { user })
  if (!allowed) {
    return accessDenied(c, user)
  }

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1)
  const limit = Math.max(1, parseInt(c.req.query('limit') ?? '10', 10) || 10)
  const sort = c.req.query('sort')

  const url = new URL(c.req.raw.url)
  const where = parseWhereFromSearchParams(url.searchParams)

  const result = await db.find({ collection, limit, page, sort, where })
  return c.json(result, 200)
}

async function handleFindByID(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  db: DatabaseAdapter,
) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))
  const allowed = await checkAccess(collection.access?.read, {
    user,
    id: id ?? undefined,
  })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const doc = await db.findByID({ collection, id })
  if (!doc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }
  return c.json(doc, 200)
}

async function handleCreate(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  db: DatabaseAdapter,
  schema: z.ZodType,
) {
  const user = c.get('user') ?? null
  const body = await parseJsonBody(c)

  const allowed = await checkAccess(collection.access?.create, {
    user,
    data: body,
  })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
  }

  const doc = await db.create({ collection, data: parsed.data as DocumentData })
  return c.json(doc, 201)
}

async function handleUpdate(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  db: DatabaseAdapter,
  partialSchema: z.ZodType,
) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))
  const body = await parseJsonBody(c)

  const allowed = await checkAccess(collection.access?.update, {
    user,
    id: id ?? undefined,
    data: body,
  })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }
  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = partialSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
  }

  const doc = await db.update({ collection, id, data: parsed.data as DocumentData })
  if (!doc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }
  return c.json(doc, 200)
}

async function handleDelete(
  c: Context<LontarEnv>,
  collection: CollectionConfig,
  db: DatabaseAdapter,
) {
  const user = c.get('user') ?? null
  const id = parseId(c.req.param('id'))

  const allowed = await checkAccess(collection.access?.delete, {
    user,
    id: id ?? undefined,
  })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (id === null) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const doc = await db.delete({ collection, id })
  if (!doc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }
  return c.json(doc, 200)
}

export function registerCollectionRoutes(router: Hono<LontarEnv>, config: Config): void {
  const collections = new Map(config.collections.map((col) => [col.slug, col]))

  function findCol(c: Context<LontarEnv>): CollectionConfig | null {
    const slug = c.req.param('collection')
    if (!slug) return null
    return collections.get(slug) ?? null
  }

  router.get('/:collection', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleFind(c, col, config.db)
  })

  router.get('/:collection/:id', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleFindByID(c, col, config.db)
  })

  router.post('/:collection', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    const schema = clientFieldsToZod(toClientCollection(col).fields)
    return handleCreate(c, col, config.db, schema)
  })

  router.patch('/:collection/:id', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    const partialSchema = clientFieldsToZod(toClientCollection(col).fields).partial()
    return handleUpdate(c, col, config.db, partialSchema)
  })

  router.delete('/:collection/:id', (c) => {
    const col = findCol(c)
    if (!col) return c.json({ error: `Collection "${c.req.param('collection')}" not found` }, 404)
    return handleDelete(c, col, config.db)
  })
}
