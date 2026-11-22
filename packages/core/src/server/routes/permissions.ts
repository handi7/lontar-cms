import type { Context, Hono } from 'hono'
import { checkAccess } from '../../access'
import {
  getDocumentPermissions,
  getGlobalPermissions,
  getPermissions,
  type PermissionsResponse,
} from '../../access/permissions'
import type { AuthUser, LontarVariables } from '../../auth/types'
import type { CollectionConfig, Config, GlobalConfig } from '../../config/types'
import type { DocumentData } from '../../database/adapter'
import { resolveOriginalGlobalDoc } from '../../operations/global'
import { AccessDeniedError, NotFoundError } from '../../operations/errors'
import { resolveOriginalDoc } from '../../operations/mutation'
import { assertRowAccess } from '../../operations/row-access'

type LontarEnv = { Variables: LontarVariables }

// Read access to the document, plus update access for a draft, as `findByID` needs. A constraint is
// checked against the stored row, and a miss is the same "not found" as a missing id (ADR 0030 §6).
async function checkDocAccess(
  config: Config,
  collection: CollectionConfig,
  id: number,
  user: AuthUser | null,
  isDraft: boolean,
  doc: DocumentData,
): Promise<boolean> {
  try {
    await assertRowAccess({
      config,
      collection,
      id,
      user,
      operations: isDraft ? ['read', 'update'] : ['read'],
      data: doc,
    })
    return true
  } catch (err) {
    if (err instanceof AccessDeniedError || err instanceof NotFoundError) return false
    throw err
  }
}

function isDocDraftHidden(
  collection: CollectionConfig,
  doc: DocumentData,
  isDraft: boolean,
): boolean {
  return Boolean(collection.versions?.drafts && !isDraft && doc._status !== 'published')
}

async function checkGlobalAccess(
  global: GlobalConfig,
  user: AuthUser | null,
  isDraft: boolean,
  doc?: DocumentData,
): Promise<boolean> {
  const readAllowed = await checkAccess(global.access?.read, { user, data: doc })
  if (!readAllowed) return false

  if (isDraft) {
    const updateAllowed = await checkAccess(global.access?.update, { user, data: doc })
    if (!updateAllowed) return false
  }

  return true
}

function isGlobalDraftHidden(
  global: GlobalConfig,
  doc: DocumentData | undefined,
  isDraft: boolean,
): boolean {
  return Boolean(global.versions?.drafts && !isDraft && doc && doc._status !== 'published')
}

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

  const user = c.get('user') ?? null
  const req = c.req.raw
  const isDraft = c.req.query('draft') === 'true'

  const doc = await resolveOriginalDoc(config.db, collection, id, isDraft)
  if (!doc || isDocDraftHidden(collection, doc, isDraft)) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }

  if (!(await checkDocAccess(config, collection, id, user, isDraft, doc))) {
    return c.json({ error: `Document with ID ${id} not found` }, 404)
  }

  const permissions = await getDocumentPermissions(collection, {
    config,
    user,
    id,
    doc,
    data: doc,
    req,
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

  const user = c.get('user') ?? null
  const req = c.req.raw
  const isDraft = c.req.query('draft') === 'true'

  let doc: Record<string, unknown> | undefined
  try {
    doc = (await resolveOriginalGlobalDoc(config.db, global, isDraft)) ?? undefined
  } catch {
    doc = undefined
  }

  if (isGlobalDraftHidden(global, doc, isDraft)) {
    return c.json({ error: `Global "${globalSlug}" not found` }, 404)
  }

  if (!(await checkGlobalAccess(global, user, isDraft, doc))) {
    return c.json({ error: `Global "${globalSlug}" not found` }, 404)
  }

  const permissions = await getGlobalPermissions(global, {
    user,
    doc,
    data: doc,
    req,
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
