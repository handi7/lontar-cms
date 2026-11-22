import { describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../api/client'
import { BULK_CONCURRENCY, runBulk } from './bulk'

describe('runBulk (#460)', () => {
  it('calls the worker for every id and reports them as succeeded', async () => {
    const worker = vi.fn().mockResolvedValue(undefined)
    const result = await runBulk([1, 2, 3], worker)
    expect(worker).toHaveBeenCalledTimes(3)
    expect(result.succeeded.sort()).toEqual([1, 2, 3])
    expect(result.failed).toEqual([])
  })

  it('keeps going after a failure and reports which document failed and why', async () => {
    const worker = vi.fn((id: number | string) =>
      id === 2 ? Promise.reject(new ApiClientError('Forbidden', 403)) : Promise.resolve(),
    )
    const result = await runBulk([1, 2, 3], worker)
    expect(result.succeeded.sort()).toEqual([1, 3])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ id: 2 })
    expect(result.failed[0]?.message).toBeTruthy()
  })

  it('never has more calls in flight than the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    const worker = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    }
    await runBulk(
      Array.from({ length: 12 }, (_, i) => i + 1),
      worker,
    )
    expect(peak).toBeLessThanOrEqual(BULK_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
  })

  it('handles an empty list', async () => {
    expect(await runBulk([], vi.fn())).toEqual({ succeeded: [], failed: [] })
  })
})
