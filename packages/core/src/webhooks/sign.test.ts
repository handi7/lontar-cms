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

  describe('replay attack mitigation with timestamp', () => {
    const now = 1700000000
    const currentTimestamp = now.toString()

    it('signs ${timestamp}.${payload} when timestamp is provided', () => {
      const signatureWithTs = signWebhookPayload(payload, secret, currentTimestamp)
      const signatureWithoutTs = signWebhookPayload(payload, secret)
      expect(signatureWithTs).toMatch(/^sha256=[a-f0-9]{64}$/)
      expect(signatureWithTs).not.toBe(signatureWithoutTs)

      const expectedDirect = signWebhookPayload(`${currentTimestamp}.${payload}`, secret)
      expect(signatureWithTs).toBe(expectedDirect)
    })

    it('verifies valid timestamp within default tolerance', () => {
      const signature = signWebhookPayload(payload, secret, currentTimestamp)
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret,
        timestamp: currentTimestamp,
        now,
      })
      expect(valid).toBe(true)
    })

    it('rejects expired timestamp (older than toleranceSeconds)', () => {
      const oldTimestamp = (now - 301).toString()
      const signature = signWebhookPayload(payload, secret, oldTimestamp)
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret,
        timestamp: oldTimestamp,
        toleranceSeconds: 300,
        now,
      })
      expect(valid).toBe(false)
    })

    it('rejects future timestamp exceeding toleranceSeconds', () => {
      const futureTimestamp = (now + 301).toString()
      const signature = signWebhookPayload(payload, secret, futureTimestamp)
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret,
        timestamp: futureTimestamp,
        toleranceSeconds: 300,
        now,
      })
      expect(valid).toBe(false)
    })

    it('rejects replayed request when attacker updates timestamp header', () => {
      // Attacker captured delivery sent at now - 1000
      const originalTs = (now - 1000).toString()
      const capturedSignature = signWebhookPayload(payload, secret, originalTs)

      // Attacker replays with forged fresh timestamp in header
      const tamperedTimestamp = now.toString()
      const valid = verifyWebhookSignature({
        payload,
        signature: capturedSignature,
        secret,
        timestamp: tamperedTimestamp,
        now,
      })
      expect(valid).toBe(false)
    })

    it('rejects non-numeric or malformed timestamp header', () => {
      const signature = signWebhookPayload(payload, secret)
      expect(
        verifyWebhookSignature({
          payload,
          signature,
          secret,
          timestamp: 'invalid-not-a-number',
          now,
        }),
      ).toBe(false)
      expect(
        verifyWebhookSignature({
          payload,
          signature,
          secret,
          timestamp: '',
          now,
        }),
      ).toBe(false)
    })
  })
})
