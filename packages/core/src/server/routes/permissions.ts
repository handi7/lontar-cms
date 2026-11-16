import type { Context, Hono } from 'hono'
import type { LontarVariables } from '../../auth/types'
import type { Config } from '../../config/types'
import {
  getDocumentPermissions,
  getGlobalPermissions,
  getPermissions,
  type PermissionsResponse,
} from '../../access/permissions'
import { resolveOriginalDoc } from '../../operations/mutation'

type LontarEnv = { Variables: LontarVariables }

async function handleDocumentPermissions(
  c: Context<LontarEnv>,
  config: Config,
  collectionSlug: string,
  idParam: string,
): Promise<Response> {
  const collection = config.collections?.find((col) => col.slug === collectionSlug)
  if (!collection) {
    return c.json({ error: `Collection "${collectionSlug}" not found` }, 404)
  }

  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid document ID' }, 400)
  }

  const isDraft = c.req.query('draft') === 'true'
  const doc = await resolveOriginalDoc(config.db, collection, id, isDraft)
  if (!doc) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }

  const user = c.get('user')
  const permissions = await getDocumentPermissions(collection, {
    user,
    id,
    doc,
    data: doc,
    req: c.req.raw,
  })

  return c.json(permissions)
}

async function handleGlobalPermissions(
  c: Context<LontarEnv>,
  config: Config,
  globalSlug: string,
): Promise<Response> {
  const global = config.globals?.find((g) => g.slug === globalSlug)
  if (!global) {
    return c.json({ error: `Global "${globalSlug}" not found` }, 404)
  }

  let doc: Record<string, unknown> | undefined
  try {
    doc = (await config.db.findGlobal({ global })) ?? undefined
  } catch {
    doc = undefined
  }

  const user = c.get('user')
  const permissions = await getGlobalPermissions(global, {
    user,
    doc,
    data: doc,
    req: c.req.raw,
  })

  return c.json(permissions)
}

async function handleGetPermissions(c: Context<LontarEnv>, config: Config): Promise<Response> {
  const collectionSlug = c.req.query('collection')
  const idParam = c.req.query('id')

  if (collectionSlug && idParam) {
    return handleDocumentPermissions(c, config, collectionSlug, idParam)
  }

  const user = c.get('user')
  const cached = c.get('permissions') as PermissionsResponse | undefined
  if (cached) {
    return c.json(cached)
  }

  const permissions = await getPermissions(config, user, { req: c.req.raw })
  c.set('permissions', permissions)
  return c.json(permissions)
}

export function registerPermissionsRoutes(router: Hono<LontarEnv>, config: Config): void {
  router.get('/_lontar/permissions/globals/:slug', (c) =>
    handleGlobalPermissions(c, config, c.req.param('slug')),
  )
  router.get('/_lontar/access/globals/:slug', (c) =>
    handleGlobalPermissions(c, config, c.req.param('slug')),
  )

  router.get('/_lontar/permissions/:collection/:id', (c) =>
    handleDocumentPermissions(c, config, c.req.param('collection'), c.req.param('id')),
  )
  router.get('/_lontar/access/:collection/:id', (c) =>
    handleDocumentPermissions(c, config, c.req.param('collection'), c.req.param('id')),
  )

  router.get('/_lontar/permissions', (c) => handleGetPermissions(c, config))
  router.get('/_lontar/access', (c) => handleGetPermissions(c, config))
}
