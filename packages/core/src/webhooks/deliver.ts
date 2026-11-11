import { signWebhookPayload } from './sign'
import type { WebhookDeliveryResult, WebhookPayload } from './types'

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000
export const DEFAULT_WEBHOOK_RETRY_DELAYS = [1000, 2000]

export interface DeliverWebhookArgs {
  url: string
  payload: WebhookPayload
  secret?: string
  timeoutMs?: number
  retryDelays?: number[]
  fetchFn?: typeof fetch
  logger?: (message: string, ...args: unknown[]) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildWebhookHeaders(
  rawBody: string,
  secret?: string,
  timestampInput?: string | number,
): Record<string, string> {
  const timestamp = (timestampInput ?? Math.floor(Date.now() / 1000)).toString()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-lontar-timestamp': timestamp,
  }

  if (secret) {
    headers['x-lontar-signature-256'] = signWebhookPayload(rawBody, secret, timestamp)
  }

  return headers
}

type AttemptResult =
  | { kind: 'success'; statusCode: number }
  | { kind: 'terminal'; statusCode?: number; error: string }
  | { kind: 'retryable'; statusCode?: number; error: string }

async function executeAttempt(args: {
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
  fetchFn: typeof fetch
}): Promise<AttemptResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs)

  try {
    const res = await args.fetchFn(args.url, {
      method: 'POST',
      headers: args.headers,
      body: args.body,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.ok) {
      return { kind: 'success', statusCode: res.status }
    }
    if (res.status >= 400 && res.status < 500) {
      return { kind: 'terminal', statusCode: res.status, error: `HTTP ${res.status}` }
    }
    return { kind: 'retryable', statusCode: res.status, error: `HTTP ${res.status}` }
  } catch (err) {
    clearTimeout(timeoutId)
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { kind: 'retryable', error: errorMsg }
  }
}

/**
 * Delivers a webhook payload to the target URL with automatic retry and exponential backoff.
 * Isolates all errors so callers never throw.
 */
export async function deliverWebhook(args: DeliverWebhookArgs): Promise<WebhookDeliveryResult> {
  const fetchFn = args.fetchFn ?? globalThis.fetch
  const timeoutMs = args.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS
  const retryDelays = args.retryDelays ?? DEFAULT_WEBHOOK_RETRY_DELAYS
  const logger = args.logger ?? console.error
  const rawBody = JSON.stringify(args.payload)
  const headers = buildWebhookHeaders(rawBody, args.secret)

  const maxAttempts = retryDelays.length + 1
  let lastError = 'Unknown delivery error'
  let lastStatusCode: number | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await executeAttempt({
      url: args.url,
      headers,
      body: rawBody,
      timeoutMs,
      fetchFn,
    })

    if (result.kind === 'success') {
      return { url: args.url, success: true, attempts: attempt, statusCode: result.statusCode }
    }

    lastError = result.error
    lastStatusCode = result.statusCode

    if (result.kind === 'terminal') {
      logger(`[lontar:webhook] Delivery to ${args.url} failed with client error: ${result.error}`)
      return {
        url: args.url,
        success: false,
        attempts: attempt,
        statusCode: lastStatusCode,
        error: lastError,
      }
    }

    if (attempt < maxAttempts) {
      const delay = retryDelays[attempt - 1] ?? 1000
      await sleep(delay)
    }
  }

  logger(
    `[lontar:webhook] Delivery to ${args.url} failed after ${maxAttempts} attempts: ${lastError}`,
  )
  return {
    url: args.url,
    success: false,
    attempts: maxAttempts,
    statusCode: lastStatusCode,
    error: lastError,
  }
}
