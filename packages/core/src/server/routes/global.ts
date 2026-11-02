import type { Context, Hono } from 'hono'
import { accessDenied } from '../../access'
import type { LontarVariables } from '../../auth/types'
import type { Config, GlobalConfig } from '../../config/types'
import type { DocumentData } from '../../database/adapter'
import {
  AccessDeniedError,
  findGlobalOperation,
  updateGlobalOperation,
  ValidationError,
} from '../../operations'

type LontarEnv = { Variables: LontarVariables }

async function parseJsonBody(c: Context<LontarEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

async function handleGetGlobal(c: Context<LontarEnv>, global: GlobalConfig, config: Config) {
  const user = c.get('user') ?? null
  try {
    const doc = await findGlobalOperation({
      config,
      global,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return accessDenied(c, user)
    }
    throw err
  }
}

async function handleUpdateGlobal(c: Context<LontarEnv>, global: GlobalConfig, config: Config) {
  const user = c.get('user') ?? null
  const body = await parseJsonBody(c)

  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  try {
    const doc = await updateGlobalOperation({
      config,
      global,
      data: body as DocumentData,
      overrideAccess: false,
      user,
      req: c.req.raw,
    })
    return c.json(doc, 200)
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

export function registerGlobalRoutes(router: Hono<LontarEnv>, config: Config) {
  const globals = config.globals ?? []
  if (globals.length === 0) return

  const globalBySlug = new Map<string, GlobalConfig>()
  for (const g of globals) {
    globalBySlug.set(g.slug, g)
  }

  router.get('/globals/:slug', async (c) => {
    const slug = c.req.param('slug')
    const global = slug ? globalBySlug.get(slug) : undefined
    if (!global) {
      return c.json({ error: `Global "${slug}" not found` }, 404)
    }
    return handleGetGlobal(c, global, config)
  })

  const updateHandler = async (c: Context<LontarEnv>) => {
    const slug = c.req.param('slug')
    const global = slug ? globalBySlug.get(slug) : undefined
    if (!global) {
      return c.json({ error: `Global "${slug}" not found` }, 404)
    }
    return handleUpdateGlobal(c, global, config)
  }

  router.post('/globals/:slug', updateHandler)
  router.patch('/globals/:slug', updateHandler)
}
