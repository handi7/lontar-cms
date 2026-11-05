# @lontar/next

Next.js adapter for [Lontar](https://github.com/handi7/lontar-cms). It serves the Lontar REST API from App Router route handlers.

```bash
pnpm add @lontar/next
```

```ts
// app/api/[...lontar]/route.ts
import config from '@/lontar.config'
import { createRouteHandlers } from '@lontar/next'

export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config, {
  baseURL: process.env.LONTAR_URL, // e.g. http://localhost:3000
})
```

`baseURL` is your app's public origin, used by Better Auth for redirects and origin checks. Without it (or the `BETTER_AUTH_URL` env variable), Better Auth logs a warning on every request.

Requires `@lontar/core` as a peer dependency. For the admin panel, see [`@lontar/admin`](https://www.npmjs.com/package/@lontar/admin). See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
