import { describe, expect, it } from 'vitest'
import { signWebhookPayload, verifyWebhookSignature } from './sign'

describe('webhook signing and verification', () => {
  const secret = 'super-secret-key-123'
  const payload = JSON.stringify({
    event: 'publish',
    collection: 'posts',
    id: 42,
    status: 'published',
    timestamp: '2026-11-10T00:00:00.000Z',
  })

  it('signs payload with sha256 prefix and hex digest', () => {
    const signature = signWebhookPayload(payload, secret)
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('verifies valid signature', () => {
    const signature = signWebhookPayload(payload, secret)
    const valid = verifyWebhookSignature({ payload, signature, secret })
    expect(valid).toBe(true)
  })

  it('rejects tampered payload', () => {
    const signature = signWebhookPayload(payload, secret)
    const tampered = JSON.stringify({
      event: 'publish',
      collection: 'posts',
      id: 999, // tampered ID
      status: 'published',
      timestamp: '2026-11-10T00:00:00.000Z',
    })
    const valid = verifyWebhookSignature({ payload: tampered, signature, secret })
    expect(valid).toBe(false)
  })

  it('rejects wrong secret', () => {
    const signature = signWebhookPayload(payload, secret)
    const valid = verifyWebhookSignature({ payload, signature, secret: 'wrong-secret' })
    expect(valid).toBe(false)
  })

  it('rejects malformed signature or different length safely', () => {
    expect(verifyWebhookSignature({ payload, signature: 'short', secret })).toBe(false)
    expect(verifyWebhookSignature({ payload, signature: '', secret })).toBe(false)
    expect(
      verifyWebhookSignature({
        payload,
        signature: 'sha256=' + 'a'.repeat(64),
        secret,
      }),
    ).toBe(false)
  })

  it('returns false when secret is empty', () => {
    const signature = signWebhookPayload(payload, secret)
    expect(verifyWebhookSignature({ payload, signature, secret: '' })).toBe(false)
  })
})
