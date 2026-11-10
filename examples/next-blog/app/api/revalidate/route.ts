import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { verifyWebhookSignature, type WebhookPayload } from '@lontar/core'

function parsePayload(rawBody: string): WebhookPayload | null {
  try {
    return JSON.parse(rawBody) as WebhookPayload
  } catch {
    return null
  }
}

function revalidatePosts(slug?: unknown): void {
  revalidatePath('/')
  revalidatePath('/posts/[slug]', 'page')
  if (typeof slug === 'string' && slug.length > 0) {
    revalidatePath(`/posts/${slug}`)
  }
  revalidateTag('posts')
}

function revalidatePages(slug?: unknown): void {
  revalidatePath('/[slug]', 'page')
  if (typeof slug === 'string' && slug.length > 0) {
    revalidatePath(`/${slug}`)
  }
  revalidateTag('pages')
}

function revalidateTarget(collection?: string, doc?: WebhookPayload['doc']): void {
  if (collection === 'posts') {
    revalidatePosts(doc?.slug)
  } else if (collection === 'pages') {
    revalidatePages(doc?.slug)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.REVALIDATION_SECRET || 'dev-webhook-secret-key-12345'
  const signature = request.headers.get('x-lontar-signature-256') ?? ''
  const rawBody = await request.text()

  const isValid = verifyWebhookSignature({
    payload: rawBody,
    signature,
    secret,
  })

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const payload = parsePayload(rawBody)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  revalidateTarget(payload.collection, payload.doc)

  return NextResponse.json({
    revalidated: true,
    event: payload.event,
    target: payload.collection || payload.global,
    now: Date.now(),
  })
}
