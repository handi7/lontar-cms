import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Computes the HMAC-SHA256 signature for a webhook payload.
 * Returns the format `sha256=<hex_digest>`.
 */
export function signWebhookPayload(payload: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(payload).digest('hex')
  return `sha256=${digest}`
}

export interface VerifyWebhookSignatureArgs {
  payload: string
  signature: string
  secret: string
}

/**
 * Verifies a webhook signature using constant-time comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(args: VerifyWebhookSignatureArgs): boolean {
  if (!args.signature || !args.secret) {
    return false
  }

  const expected = signWebhookPayload(args.payload, args.secret)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(args.signature)

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer)
}
