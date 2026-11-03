# @lontar/admin

Admin panel for [Lontar](https://github.com/handi7/lontar-cms): a prebuilt, client-side React SPA. It fetches the serialized `ClientConfig` from your Lontar API and renders lists and edit forms from it. Its styles are scoped, so they don't leak into your app.

```bash
pnpm add @lontar/admin
```

```tsx
// app/admin/[[...path]]/page.tsx
'use client'
import { Admin } from '@lontar/admin'
import '@lontar/admin/styles.css'

export default function AdminPage() {
  return <Admin apiBase="/api" basePath="/admin" />
}
```

Requires `react` and `react-dom` 19, and `@lontar/core` (for types). See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
