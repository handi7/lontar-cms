import { createLontar, type Config, type CreateLontarOptions } from '@lontar/core'

export type RouteHandlerOptions = CreateLontarOptions

export type RouteHandler = (request: Request, context?: unknown) => Response | Promise<Response>

export interface RouteHandlers {
  GET: RouteHandler
  POST: RouteHandler
  PATCH: RouteHandler
  DELETE: RouteHandler
  PUT: RouteHandler
  OPTIONS: RouteHandler
}

export function createRouteHandlers(
  config: Config,
  options: RouteHandlerOptions = {},
): RouteHandlers {
  const app = createLontar(config, options)
  const handler: RouteHandler = (request: Request) => app.fetch(request)

  return {
    GET: handler,
    POST: handler,
    PATCH: handler,
    DELETE: handler,
    PUT: handler,
    OPTIONS: handler,
  }
}
