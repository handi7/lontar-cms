import type { Context, Hono } from 'hono'
import { accessDenied, checkAccess } from '../../access'
import type { LontarVariables } from '../../auth/types'
import { clientFieldsToZod } from '../../client/zod'
import { toClientGlobal } from '../../config/to-client-config'
import type { Config, GlobalConfig } from '../../config/types'
import type { DatabaseAdapter, DocumentData, StoredDoc } from '../../database/adapter'
import { runAfterChangeHooks, runAfterReadHooks, runBeforeChangeHooks } from '../../hooks'

type LontarEnv = { Variables: LontarVariables }

async function parseJsonBody(c: Context<LontarEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

async function executeGlobalUpdate(args: {
  global: GlobalConfig
  db: DatabaseAdapter
  existing: StoredDoc | null
  data: DocumentData
  req: Request
}): Promise<{ doc?: DocumentData; error?: string }> {
  try {
    const operation = args.existing ? 'update' : 'create'
    const data = await runBeforeChangeHooks({
      global: args.global,
      data: args.data,
      operation,
      originalDoc: args.existing ?? undefined,
      req: args.req,
    })
    const saved = await args.db.updateGlobal({ global: args.global, data })
    const doc = await runAfterChangeHooks({
      global: args.global,
      doc: saved,
      operation,
      previousDoc: args.existing ?? undefined,
      req: args.req,
    })
    return { doc }
  } catch (err) {
    return { error: getErrorMessage(err, 'Global update failed') }
  }
}

async function handleGetGlobal(c: Context<LontarEnv>, global: GlobalConfig, db: DatabaseAdapter) {
  const user = c.get('user') ?? null
  const allowed = await checkAccess(global.access?.read, { user })
  if (!allowed) {
    return accessDenied(c, user)
  }

  const doc = await db.findGlobal({ global })
  const targetDoc = doc ?? {}
  const transformed = await runAfterReadHooks({ global, doc: targetDoc, req: c.req.raw })
  return c.json(transformed, 200)
}

async function handleUpdateGlobal(
  c: Context<LontarEnv>,
  global: GlobalConfig,
  db: DatabaseAdapter,
) {
  const user = c.get('user') ?? null
  const body = await parseJsonBody(c)

  const allowed = await checkAccess(global.access?.update, { user, data: body })
  if (!allowed) {
    return accessDenied(c, user)
  }

  if (body === undefined) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const clientGlobal = toClientGlobal(global)
  const schema = clientFieldsToZod(clientGlobal.fields).partial()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
  }

  const existing = await db.findGlobal({ global })
  const result = await executeGlobalUpdate({
    global,
    db,
    existing,
    data: parsed.data,
    req: c.req.raw,
  })

  if (result.error) {
    return c.json({ error: result.error }, 400)
  }
  return c.json(result.doc, 200)
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
    return handleGetGlobal(c, global, config.db)
  })

  const updateHandler = async (c: Context<LontarEnv>) => {
    const slug = c.req.param('slug')
    const global = slug ? globalBySlug.get(slug) : undefined
    if (!global) {
      return c.json({ error: `Global "${slug}" not found` }, 404)
    }
    return handleUpdateGlobal(c, global, config.db)
  }

  router.post('/globals/:slug', updateHandler)
  router.patch('/globals/:slug', updateHandler)
}
