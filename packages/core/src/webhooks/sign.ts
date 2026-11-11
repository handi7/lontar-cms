import { createHmac, timingSafeEqual } from 'node:crypto'

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300

/**
 * Computes the HMAC-SHA256 signature for a webhook payload.
 * If a timestamp is provided, signs `${timestamp}.${payload}` to prevent replay attacks.
 * Returns the format `sha256=<hex_digest>`.
 */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp?: string | number,
): string {
  const dataToSign = timestamp !== undefined ? `${timestamp}.${payload}` : payload
  const digest = createHmac('sha256', secret).update(dataToSign).digest('hex')
  return `sha256=${digest}`
}

export interface VerifyWebhookSignatureArgs {
  payload: string
  signature: string
  secret: string
  timestamp?: string | number | null
  toleranceSeconds?: number
  now?: number
}

function isTimestampValid(
  timestamp: string | number,
  toleranceSeconds: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  now?: number,
): boolean {
  const tsNum = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10)
  if (!Number.isFinite(tsNum)) {
    return false
  }
  if (toleranceSeconds <= 0) {
    return true
  }
  const currentSeconds = now ?? Math.floor(Date.now() / 1000)
  return Math.abs(currentSeconds - tsNum) <= toleranceSeconds
}

/**
 * Verifies a webhook signature using constant-time comparison to prevent timing attacks.
 * When `timestamp` is provided, also checks that the timestamp is within `toleranceSeconds`
 * (defaults to 300 seconds) of the current time.
 */
export function verifyWebhookSignature(args: VerifyWebhookSignatureArgs): boolean {
  if (!args.signature || !args.secret) {
    return false
  }

  if (args.timestamp !== undefined && args.timestamp !== null) {
    if (!isTimestampValid(args.timestamp, args.toleranceSeconds, args.now)) {
      return false
    }
  }

  const expected = signWebhookPayload(args.payload, args.secret, args.timestamp ?? undefined)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(args.signature)

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer)
}
