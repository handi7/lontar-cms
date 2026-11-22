import type { Context, Hono } from 'hono'
import type { LontarVariables } from '../../auth/types'
import type { Config } from '../../config/types'
import { searchOperation, ValidationError } from '../../operations'
import { formatValidationError } from './collection'

type LontarEnv = { Variables: LontarVariables }

async function handleSearch(c: Context<LontarEnv>, config: Config): Promise<Response> {
  try {
    const results = await searchOperation({
      config,
      user: c.get('user') ?? null,
      q: c.req.query('q') ?? '',
      req: c.req.raw,
      locale: c.req.query('locale'),
    })
    return c.json({ results }, 200)
  } catch (err) {
    if (err instanceof ValidationError) return formatValidationError(c, err)
    throw err
  }
}

export function registerSearchRoutes(router: Hono<LontarEnv>, config: Config): void {
  router.get('/_lontar/search', (c) => handleSearch(c, config))
}
