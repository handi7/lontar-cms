import { describe, expect, it, vi } from 'vitest'
import { deliverWebhook } from './deliver'
import type { WebhookPayload } from './types'

describe('deliverWebhook', () => {
  const samplePayload: WebhookPayload = {
    event: 'publish',
    collection: 'posts',
    id: 123,
    status: 'published',
    previousStatus: 'draft',
    timestamp: '2026-11-10T00:00:00.000Z',
  }

  it('delivers successfully on first attempt with signing header', async () => {
    let capturedRequest: { url: string; headers: Headers; body: string } | undefined

    const mockFetch = vi.fn<typeof fetch>((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : 'url' in url ? url.url : url.toString()
      capturedRequest = {
        url: urlStr,
        headers: new Headers(init?.headers),
        body: (init?.body as string) ?? '',
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })

    const result = await deliverWebhook({
      url: 'https://example.com/api/revalidate',
      payload: samplePayload,
      secret: 'my-secret',
      fetchFn: mockFetch,
    })

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.statusCode).toBe(200)

    expect(capturedRequest?.url).toBe('https://example.com/api/revalidate')
    expect(capturedRequest?.headers.get('content-type')).toBe('application/json')
    expect(capturedRequest?.headers.get('x-lontar-timestamp')).toBeTruthy()
    expect(capturedRequest?.headers.get('x-lontar-signature-256')).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(JSON.parse(capturedRequest?.body ?? '')).toEqual(samplePayload)
  })

  it('omits signature header when no secret is configured', async () => {
    let capturedHeaders: Headers | undefined
    const mockFetch = vi.fn<typeof fetch>((_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers)
      return Promise.resolve(new Response(null, { status: 204 }))
    })

    const result = await deliverWebhook({
      url: 'https://example.com/api/revalidate',
      payload: samplePayload,
      fetchFn: mockFetch,
    })

    expect(result.success).toBe(true)
    expect(capturedHeaders?.get('x-lontar-signature-256')).toBeNull()
    expect(capturedHeaders?.get('x-lontar-timestamp')).toBeTruthy()
  })

  it('retries on 5xx status codes and succeeds on recovery', async () => {
    let attemptCount = 0
    const mockFetch = vi.fn<typeof fetch>(() => {
      attemptCount++
      if (attemptCount < 3) {
        return Promise.resolve(new Response('Server busy', { status: 503 }))
      }
      return Promise.resolve(new Response('OK', { status: 200 }))
    })

    const result = await deliverWebhook({
      url: 'https://example.com/api/revalidate',
      payload: samplePayload,
      retryDelays: [1, 2], // 1ms, 2ms for fast unit test
      fetchFn: mockFetch,
    })

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(3)
    expect(result.statusCode).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 4xx client errors', async () => {
    const logger = vi.fn()
    const mockFetch = vi.fn<typeof fetch>(() => {
      return Promise.resolve(new Response('Unauthorized', { status: 401 }))
    })

    const result = await deliverWebhook({
      url: 'https://example.com/api/revalidate',
      payload: samplePayload,
      retryDelays: [1, 2],
      fetchFn: mockFetch,
      logger,
    })

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(1)
    expect(result.statusCode).toBe(401)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalled()
  })

  it('retries on network exceptions and returns terminal failure without throwing', async () => {
    const logger = vi.fn()
    const mockFetch = vi.fn<typeof fetch>(() => {
      return Promise.reject(new Error('Connection refused (ECONNREFUSED)'))
    })

    const result = await deliverWebhook({
      url: 'https://example.com/api/revalidate',
      payload: samplePayload,
      retryDelays: [1, 2],
      fetchFn: mockFetch,
      logger,
    })

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(3)
    expect(result.error).toContain('Connection refused')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('failed after 3 attempts'))
  })
})
