import { Hono } from 'hono'
import { toClientConfig } from '../config/to-client-config'
import type { Config } from '../config/types'
import { registerCollectionRoutes } from './routes/collection'

export interface CreateLontarOptions {
  basePath?: string
}

export function createLontar(config: Config, options: CreateLontarOptions = {}): Hono {
  const app = new Hono()
  const basePath = options.basePath ?? '/api'
  const router = new Hono()

  // ClientConfig endpoint
  router.get('/_lontar/config', (c) => {
    return c.json(toClientConfig(config))
  })

  // Collection CRUD routes
  registerCollectionRoutes(router, config)

  app.route(basePath, router)
  return app
}
