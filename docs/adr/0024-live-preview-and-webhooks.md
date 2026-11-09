# 0024: Live preview and outgoing webhooks

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Milestone 8 introduces live preview and outgoing webhooks ([#146](https://github.com/handi7/lontar-cms/issues/146), [#197](https://github.com/handi7/lontar-cms/issues/197)):

1. **Live preview**: Editors need to view how unsaved content looks in the real frontend application in real time as they type, without publishing the changes or refreshing the page.
2. **Outgoing webhooks**: External systems (such as Next.js On-Demand Revalidation, static site builders like Vercel/Netlify, search indexes, or notification services) must be notified when content is published, unpublished, updated, or deleted.

Both features cross boundaries outside the core admin:

- Live preview crosses the boundary between the client-side Admin SPA and the host/remote frontend application.
- Outgoing webhooks cross the boundary from the Lontar backend server to third-party HTTP endpoints.

Two core architecture rules apply:

- **Rule 1 & 2 (`ClientConfig` is plain JSON)**: `defineConfig()` and server configs never reach the admin SPA. The admin receives serialized `ClientConfig` via `GET /api/_lontar/config`. Therefore, `admin.preview.url` must be a plain JSON string template, never a JavaScript function. Webhook configurations and signing secrets are server-only and must never leak into `ClientConfig`.
- **Rule 4 (Core is framework-agnostic)**: `packages/core` must not import React or Next.js. Any React-specific preview hook must live in a separate package or frontend-facing client module.

## Decision

---

### Part 1: Live Preview

#### 1. URL Template in `ClientConfig`

Preview URLs are configured in collection and global options using a string template with `{placeholder}` tokens:

```ts
// lontar.config.ts
const Posts = collection({
  slug: 'posts',
  admin: {
    preview: {
      url: 'https://mysite.com/posts/{slug}?preview=1',
    },
  },
  fields: { ... },
})
```

- **Placeholder tokens**:
  - Tokens reference top-level document fields: `{id}`, `{slug}`, `{title}`, etc.
  - The admin replaces tokens using URL encoding: `encodeURIComponent(String(fieldValue))`.
- **Handling empty or unset tokens**:
  - When creating a new document (or before required tokens like `{slug}` are filled in by the editor), the placeholder value is empty.
  - If a required token in the URL path is empty, the admin preview pane pauses loading and displays an informative placeholder:
    > "Fill in `{slug}` to start live preview."
  - This avoids firing 404 requests or crashing the frontend iframe on initial document creation.

#### 2. Transport Protocol: Versioned `postMessage`

When the editor types into the admin form, the admin SPA streams unsaved form state to the embedded `<iframe>` via `postMessage`.

The message contract is strictly versioned:

```ts
export interface LontarPreviewMessage<T = unknown> {
  source: 'lontar-preview'
  version: 1
  collection: string
  document: T
}
```

- **`source`**: Identifies the message as coming from Lontar preview.
- **`version`**: Protocol version (starts at `1`). Allows the frontend helper and admin SPA to evolve independently across releases.
- **`collection`**: Slug of the collection being previewed.
- **`document`**: Complete form state object, matching the canonical document structure (including nested groups, arrays, and blocks).

#### 3. Origin Verification & Security

Embedding a remote frontend inside an iframe and transmitting draft content across window boundaries is a critical security surface.

- **Admin to Iframe (Posting)**:
  - The admin parses the target origin directly from the configured preview URL:
    `const targetOrigin = new URL(previewUrl).origin`
  - The admin dispatches messages strictly with `iframe.contentWindow.postMessage(message, targetOrigin)`.
  - The admin **never** passes `'*'` as `targetOrigin`.
- **Frontend Receiver (Listening)**:
  - The frontend helper verifies `event.origin` against configured allowed origins (e.g., the Lontar backend/admin URL).
  - The helper rejects any message where `event.data?.source !== 'lontar-preview'` or `event.data?.version !== 1`.
- **Frame Ancestors Protection**:
  - The frontend application should set `Content-Security-Policy: frame-ancestors 'self' <lontar-admin-origin>` on preview routes to prevent clickjacking by unauthorized third parties.

#### 4. Frontend Helper Surface: `@lontar/preview`

To preserve framework neutrality (Rule 4), the frontend preview helper is packaged separately:

- **Package**: `@lontar/preview` (lightweight, zero-dependency client package).
- **React Hook**:
  ```tsx
  import { useLivePreview } from '@lontar/preview/react'

  export default function PostPage({ post: initialPost }) {
    const { data: post } = useLivePreview({
      initialData: initialPost,
      serverURL: 'http://localhost:3000', // admin origin
    })

    return (
      <article>
        <h1>{post.title}</h1>...
      </article>
    )
  }
  ```
- **Behavior**:
  1. If running outside an iframe (normal visitor), `useLivePreview` immediately returns `initialData` without registering listeners.
  2. If running inside an iframe on an active preview route:
     - Subscribes to `window.addEventListener('message', ...)`.
     - Validates origin and message shape.
     - Merges received form data over `initialData` in React state.
     - Unsubscribes on component unmount.
- **Vanilla JS Core**:
  `@lontar/preview` also exports `subscribeLivePreview({ initialData, serverURL, onChange })` for non-React frontends (Vue, Svelte, vanilla JS).

#### 5. Initial Draft Fetching

When the preview iframe loads:

- The page fetches initial data via SSR or client fetch with `?draft=true` (or passes the editor's auth session cookie).
- Once loaded, `postMessage` takes over and updates the DOM synchronously on every keystroke.
- This ensures the iframe never renders blank or flashes stale published content while waiting for the first user edit.

---

### Part 2: Outgoing Webhooks

#### 1. Configuration Shape

Webhooks are configured in `lontar.config.ts`:

```ts
import { defineConfig } from '@lontar/core'

export default defineConfig({
  // ...
  webhooks: [
    {
      url: 'https://mysite.com/api/revalidate',
      collections: ['posts', 'pages'], // or '*' for all collections
      events: ['publish', 'unpublish', 'create', 'update', 'delete'],
      secret: process.env.WEBHOOK_SECRET, // HMAC signing secret
    },
  ],
})
```

Webhooks can also be configured directly on a collection:

```ts
const Posts = collection({
  slug: 'posts',
  webhooks: [
    {
      url: 'https://mysite.com/api/revalidate',
      events: ['publish', 'unpublish'],
      secret: process.env.WEBHOOK_SECRET,
    },
  ],
  fields: { ... },
})
```

- **Server-Only Security**: All `webhooks` configurations are stripped by `toClientConfig()`. Webhook URLs and signing secrets are never exposed in `ClientConfig` or sent to the admin SPA.

#### 2. Event Payload

The webhook HTTP POST payload transmits structured metadata:

```json
{
  "event": "publish",
  "collection": "posts",
  "id": 123,
  "status": "published",
  "previousStatus": "draft",
  "timestamp": "2026-11-09T14:00:00.000Z"
}
```

- **Payload Minimalism**: By default, only metadata (`event`, `collection`, `id`, `status`, `previousStatus`, `timestamp`) is sent.
- **Why exclude the full document by default**:
  - Webhooks frequently target public endpoints (e.g. Next.js revalidation route handlers or hosting deploy hooks). Sending the entire document body risks exposing private fields and inflates network payloads.
  - Most receivers only require the ID and collection to invalidate cache tags (e.g. `revalidateTag('posts-123')`).
- If a consumer requires full document data, an optional `includeDoc: true` option on the webhook config sends the document snapshot.

#### 3. Cryptographic Signing (HMAC-SHA256)

Every webhook request includes cryptographic headers to prevent forgery and replay attacks:

- **`x-lontar-signature-256`**: Hex-encoded HMAC-SHA256 digest of the raw request body using the configured `secret`:
  `sha256=<hex_digest>`
- **`x-lontar-timestamp`**: Unix epoch timestamp in seconds at the time of delivery.

Receivers verify the signature using constant-time comparison (`crypto.timingSafeEqual`).

#### 4. Delivery Lifecycle & Error Resilience

- **Transaction Boundary**: Webhooks fire **strictly after the database transaction has committed** (ADR 0009). If a database mutation or hook throws and rolls back the transaction, no webhook is delivered.
- **Fire-and-Forget**: Webhook delivery does not block the editor's save request. Delivery runs asynchronously in the background.
- **Failure Isolation**: An unreachable or failing webhook receiver (500 error or network timeout) **never** causes the editor's save operation to fail.
- **Timeouts & Retries**:
  - Request timeout: 5 seconds per attempt.
  - Automatic retry: Up to 3 attempts with exponential backoff (`1s`, `2s`, `4s`) for network timeouts or 5xx HTTP responses.
  - Terminal failures are logged to the backend console logger.

#### 5. Interaction with Draft Saves

Per ADR 0023 §8, `statusTransition` is explicitly defined:

- When an editor saves a draft without publishing:
  - If the webhook is subscribed to `events: ['publish']`, **no webhook is sent**.
  - If the webhook is subscribed to `events: ['update']` or `events: ['change']`, the webhook fires with `"event": "update"` and `"status": "draft"`.
- This ensures production static site rebuilds and public cache invalidations only trigger when content is truly published or unpublished.

---

## Alternatives Considered

1. **JavaScript function for `admin.preview.url`:**
   - _Why rejected_: Violates Architecture Rule 2 (`ClientConfig` is plain JSON). A function cannot be serialized over `GET /api/_lontar/config`. A string template with `{placeholder}` tokens is declarative, portable, and serializable.
2. **Synchronous webhook delivery awaiting HTTP response:**
   - _Why rejected_: If an external webhook endpoint is slow or down, the editor's save operation would hang or fail, causing perceived data loss and poor editing UX.
3. **`postMessage(data, '*')` wildcard origin:**
   - _Why rejected_: Major security vulnerability. Any malicious page could frame the admin and intercept sensitive unpublished draft content.
4. **Sending full document payload in all webhooks:**
   - _Why rejected_: Leaks draft/internal fields to external receivers and adds unnecessary payload weight for cache invalidation endpoints.

---

## Consequences

### Easier

- **Real-time authoring UX**: Instant visual feedback in the admin iframe as authors type.
- **Clean deployment integration**: Straightforward revalidation for Next.js, Nuxt, Astro, and headless hosting providers.
- **Strong security**: Strict origin validation on preview postMessages and HMAC-SHA256 signing on webhook deliveries.

### Harder

- **Hosting CSP configuration**: Host frontend applications must configure `frame-ancestors` CSP headers to permit being embedded by the admin domain.

---

## Public API (Spec for README.md)

### Live Preview Configuration

```ts
import { collection, fields as f } from '@lontar/core'

const Posts = collection({
  slug: 'posts',
  admin: {
    preview: {
      url: 'https://mysite.com/posts/{slug}?preview=1',
    },
  },
  fields: {
    title: f.text({ required: true }),
    slug: f.slug({ from: 'title' }),
  },
})
```

### Frontend Live Preview Hook (`@lontar/preview`)

```tsx
import { useLivePreview } from '@lontar/preview/react'

export default function PostPage({ post: initialPost }) {
  const { data: post } = useLivePreview({
    initialData: initialPost,
    serverURL: 'http://localhost:3000',
  })

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  )
}
```

### Outgoing Webhooks Configuration

```ts
import { defineConfig } from '@lontar/core'

export default defineConfig({
  // Global or per-collection outgoing webhooks
  webhooks: [
    {
      url: 'https://mysite.com/api/revalidate',
      collections: ['posts', 'pages'],
      events: ['publish', 'unpublish', 'delete'],
      secret: process.env.WEBHOOK_SECRET,
    },
  ],
})
```
