# @lontar/storage-s3

S3-compatible storage adapter for [Lontar](https://github.com/handi7/lontar-cms) uploads. Works with AWS S3, Cloudflare R2, MinIO and other S3-compatible services.

```bash
pnpm add @lontar/storage-s3
```

```ts
import { defineConfig } from '@lontar/core'
import { s3Storage } from '@lontar/storage-s3'

export default defineConfig({
  storage: s3Storage({ bucket: 'media', endpoint: process.env.S3_ENDPOINT! }),
  // ...
})
```

Requires `@lontar/core` as a peer dependency. See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
