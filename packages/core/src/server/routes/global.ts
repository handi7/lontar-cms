import type { Context, Hono } from 'hono'
import { accessDenied } from '../../access'
import type { AuthUser, LontarVariables } from '../../auth/types'
import { DEFAULT_LIMIT, MAX_LIMIT, type Config, type GlobalConfig } from '../../config/types'
import type { DocumentData } from '../../database/adapter'
import {
  AccessDeniedError,
  findGlobalOperation,
  findGlobalVersionByIDOperation,
  findGlobalVersionsOperation,
  NotFoundError,
  publishGlobalOperation,
  restoreGlobalVersionOperation,
  unpublishGlobalOperation,
  updateGlobalOperation,
  ValidationError,
} from '../../operations'
import { parseDepth } from '../../populate'

type LontarEnv = { Variables: LontarVariables }

function parseId(raw: string | undefined): number | null {
  if (!raw) return null
  const parsed = parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

async function parseJsonBody(c: Context<LontarEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

function handleGlobalError(err: unknown, c: Context<LontarEnv>, user: AuthUser | null): Response {
  if (err instanceof AccessDeniedError) {
    return accessDenied(c, user)
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404)
  }
  if (err instanceof ValidationError) {
    return c.json({ error: 'Validation failed', issues: err.issues }, 400)
  }
  if (err instanceof Error) {
    return c.json({ error: err.message }, 400)
  }
  throw err
}

async function handleGetGlobal(c: Context<LontarEnv>, global: GlobalConfig, config: Config) {
  const user = c.get('user') ?? null
  const draft = c.req.query('draft') === 'true'
  const depth = parseDepth(c.req.query('depth'))

  try {
    const doc = await findGlobalOperation({
      config,
      global,
      depth,
      draft,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

async function handleUpdateGlobal(c: Context<LontarEnv>, global: GlobalConfig, config: Config) {
  const user = c.get('user') ?? null
  const body = await parseJsonBody(c)

  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const depth = parseDepth(c.req.query('depth'))
  const rawBody = body as Record<string, unknown>
  const draft = c.req.query('draft') === 'true' || Boolean(rawBody?.draft)
  const autosave = c.req.query('autosave') === 'true' || Boolean(rawBody?.autosave)

  try {
    const doc = await updateGlobalOperation({
      config,
      global,
      data: body as DocumentData,
      depth,
      draft,
      autosave,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

async function handlePublishGlobal(c: Context<LontarEnv>, global: GlobalConfig, config: Config) {
  const user = c.get('user') ?? null
  const depth = parseDepth(c.req.query('depth'))

  try {
    const doc = await publishGlobalOperation({
      config,
      global,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

async function handleUnpublishGlobal(c: Context<LontarEnv>, global: GlobalConfig, config: Config) {
  const user = c.get('user') ?? null
  const depth = parseDepth(c.req.query('depth'))

  try {
    const doc = await unpublishGlobalOperation({
      config,
      global,
      depth,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

async function handleFindGlobalVersions(
  c: Context<LontarEnv>,
  global: GlobalConfig,
  config: Config,
) {
  const user = c.get('user') ?? null
  const rawPage = parseInt(c.req.query('page') ?? '1', 10)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1

  const rawLimit = parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT), 10)
  const limit = Math.min(
    Math.max(1, Number.isInteger(rawLimit) ? rawLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  const sort = c.req.query('sort')

  try {
    const result = await findGlobalVersionsOperation({
      config,
      global,
      page,
      limit,
      sort,
      user,
      overrideAccess: false,
    })
    return c.json(result, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

async function handleFindGlobalVersionByID(
  c: Context<LontarEnv>,
  global: GlobalConfig,
  config: Config,
) {
  const versionId = parseId(c.req.param('versionId'))
  if (versionId === null) {
    return c.json({ error: 'Invalid version ID' }, 400)
  }
  const user = c.get('user') ?? null

  try {
    const result = await findGlobalVersionByIDOperation({
      config,
      global,
      versionId,
      user,
      overrideAccess: false,
    })
    return c.json(result, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

async function handleRestoreGlobalVersion(
  c: Context<LontarEnv>,
  global: GlobalConfig,
  config: Config,
) {
  const versionId = parseId(c.req.param('versionId'))
  if (versionId === null) {
    return c.json({ error: 'Invalid version ID' }, 400)
  }
  const user = c.get('user') ?? null
  const body = (await parseJsonBody(c)) as Record<string, unknown> | undefined
  const depth = parseDepth(c.req.query('depth'))
  const draft =
    c.req.query('draft') !== undefined
      ? c.req.query('draft') === 'true'
      : typeof body?.draft === 'boolean'
        ? body.draft
        : undefined

  try {
    const result = await restoreGlobalVersionOperation({
      config,
      global,
      versionId,
      draft,
      depth,
      user,
      overrideAccess: false,
      req: c.req.raw,
    })
    return c.json(result, 200)
  } catch (err) {
    return handleGlobalError(err, c, user)
  }
}

export function registerGlobalRoutes(router: Hono<LontarEnv>, config: Config) {
  const globals = config.globals ?? []
  if (globals.length === 0) return

  const globalBySlug = new Map<string, GlobalConfig>()
  for (const g of globals) {
    globalBySlug.set(g.slug, g)
  }

  const resolve = (c: Context<LontarEnv>): GlobalConfig | null => {
    const slug = c.req.param('slug')
    return slug ? (globalBySlug.get(slug) ?? null) : null
  }

  router.get('/globals/:slug', async (c) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handleGetGlobal(c, global, config)
  })

  const updateHandler = async (c: Context<LontarEnv>) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handleUpdateGlobal(c, global, config)
  }

  router.post('/globals/:slug', updateHandler)
  router.patch('/globals/:slug', updateHandler)

  router.post('/globals/:slug/publish', async (c) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handlePublishGlobal(c, global, config)
  })

  router.post('/globals/:slug/unpublish', async (c) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handleUnpublishGlobal(c, global, config)
  })

  router.get('/globals/:slug/versions', async (c) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handleFindGlobalVersions(c, global, config)
  })

  router.get('/globals/:slug/versions/:versionId', async (c) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handleFindGlobalVersionByID(c, global, config)
  })

  router.post('/globals/:slug/versions/:versionId/restore', async (c) => {
    const global = resolve(c)
    if (!global) return c.json({ error: `Global "${c.req.param('slug')}" not found` }, 404)
    return handleRestoreGlobalVersion(c, global, config)
  })
}
