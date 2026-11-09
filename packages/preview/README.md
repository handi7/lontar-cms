# @lontar/preview

Frontend live preview helper for Lontar CMS.

Subscribes to draft form updates streamed from the Lontar admin preview pane over `postMessage`, updating the view in real time as editors type.

## Installation

```bash
pnpm add @lontar/preview
```

## React Usage

```tsx
'use client'
import { useLivePreview } from '@lontar/preview/react'

export function PostView({ post: initialPost }) {
  const { data: post } = useLivePreview({
    initialData: initialPost,
    serverURL: 'http://localhost:3000', // Lontar admin URL
  })

  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  )
}
```

## Vanilla JS Usage

```ts
import { subscribeLivePreview } from '@lontar/preview'

const unsubscribe = subscribeLivePreview({
  initialData: post,
  serverURL: 'http://localhost:3000',
  onChange: (updatedPost) => {
    renderPost(updatedPost)
  },
})

// When tearing down:
unsubscribe()
```
