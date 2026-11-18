import { describe, expect, it, vi } from 'vitest'
import { LockTimeoutError, withAdminMutationLock } from './lock'
import type { Auth } from './types'

interface Row {
  id: string
  value: string
  expiresAt: Date
}

function makeAuth(rows: Map<string, Row>): Auth {
  const adapter = {
    create: vi.fn(({ data }: { data: Row }) => {
      if (rows.has(data.id)) return Promise.reject(new Error('duplicate'))
      rows.set(data.id, { id: data.id, value: data.value, expiresAt: data.expiresAt })
      return Promise.resolve()
    }),
    findOne: vi.fn(({ where }: { where: Array<{ field: string; value: unknown }> }) =>
      Promise.resolve(rows.get(String(where[0]?.value)) ?? null),
    ),
    delete: vi.fn(({ where }: { where: Array<{ field: string; value: unknown }> }) => {
      const row = rows.get(String(where[0]?.value))
      if (
        row &&
        where.every((w) => (row as unknown as Record<string, unknown>)[w.field] === w.value)
      ) {
        rows.delete(row.id)
      }
      return Promise.resolve()
    }),
  }
  return { $context: Promise.resolve({ adapter }) } as unknown as Auth
}

const LOCK_ID = 'lontar:admin-mutation-lock'

describe('withAdminMutationLock', () => {
  it('throws instead of running unprotected when the lock is held by another instance', async () => {
    const rows = new Map<string, Row>([
      [LOCK_ID, { id: LOCK_ID, value: 'other-instance', expiresAt: new Date(Date.now() + 60000) }],
    ])
    const fn = vi.fn(() => Promise.resolve('ran'))
    vi.useFakeTimers()
    const promise = withAdminMutationLock(makeAuth(rows), fn)
    const assertion = expect(promise).rejects.toBeInstanceOf(LockTimeoutError)
    await vi.advanceTimersByTimeAsync(6000)
    await assertion
    vi.useRealTimers()
    expect(fn).not.toHaveBeenCalled()
    expect(rows.get(LOCK_ID)?.value).toBe('other-instance')
  })

  it('releases only its own lock row', async () => {
    const rows = new Map<string, Row>()
    const auth = makeAuth(rows)
    await withAdminMutationLock(auth, () => {
      // Simulate our lock expiring and a peer taking over while we are still running.
      rows.set(LOCK_ID, { id: LOCK_ID, value: 'peer', expiresAt: new Date(Date.now() + 15000) })
      return Promise.resolve()
    })
    expect(rows.get(LOCK_ID)?.value).toBe('peer')
  })

  it('removes the lock after a normal run', async () => {
    const rows = new Map<string, Row>()
    const result = await withAdminMutationLock(makeAuth(rows), () => Promise.resolve('ok'))
    expect(result).toBe('ok')
    expect(rows.size).toBe(0)
  })

  it('reclaims an expired lock from a crashed holder', async () => {
    const rows = new Map<string, Row>([
      [LOCK_ID, { id: LOCK_ID, value: 'dead', expiresAt: new Date(Date.now() - 1000) }],
    ])
    const result = await withAdminMutationLock(makeAuth(rows), () => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })
})
