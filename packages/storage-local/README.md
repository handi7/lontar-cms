# @lontar/storage-local

Local disk storage adapter for [Lontar](https://github.com/handi7/lontar-cms) uploads.

```bash
pnpm add @lontar/storage-local
```

```ts
import { defineConfig } from '@lontar/core'
import { localStorage } from '@lontar/storage-local'

export default defineConfig({
  // Files go to ./uploads and are served from /uploads by default.
  storage: localStorage({ uploadDir: './uploads', baseUrl: '/uploads' }),
  // ...
})
```

Requires `@lontar/core` as a peer dependency. See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
