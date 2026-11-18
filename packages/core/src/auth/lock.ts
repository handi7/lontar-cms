import { randomUUID } from 'node:crypto'
import type { Auth } from './types'

/**
 * An in-process mutex to serialize async operations per critical section.
 */
export class AsyncLock {
  private queue: Promise<void> = Promise.resolve()

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const prev = this.queue
    this.queue = this.queue.then(
      () => next,
      () => next,
    )
    await prev
    try {
      return await fn()
    } finally {
      release!()
    }
  }
}

const adminLock = new AsyncLock()
const firstUserLock = new AsyncLock()

interface VerificationAdapter {
  create?: (args: {
    model: string
    data: {
      id: string
      identifier: string
      value: string
      expiresAt: Date
      createdAt: Date
      updatedAt: Date
    }
    forceAllowId?: boolean
  }) => Promise<unknown>
  delete?: (args: {
    model: string
    where: Array<{ field: string; value: unknown }>
  }) => Promise<unknown>
  findOne?: (args: {
    model: string
    where: Array<{ field: string; value: unknown }>
  }) => Promise<{ expiresAt?: Date | string | number; value?: string } | null>
}

const LOCK_TTL_MS = 15000
const LOCK_TIMEOUT_MS = 5000

export class LockTimeoutError extends Error {
  constructor(lockId: string) {
    super(`Could not acquire lock "${lockId}"; another operation is in progress`)
    this.name = 'LockTimeoutError'
  }
}

async function tryAcquireDbLock(
  adapter: VerificationAdapter,
  lockId: string,
  owner: string,
): Promise<boolean> {
  if (!adapter.create) return true
  try {
    await adapter.create({
      model: 'verification',
      data: {
        id: lockId,
        identifier: lockId,
        value: owner,
        expiresAt: new Date(Date.now() + LOCK_TTL_MS),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      forceAllowId: true,
    })
    return true
  } catch {
    try {
      const existing = await adapter.findOne?.({
        model: 'verification',
        where: [{ field: 'id', value: lockId }],
      })
      if (existing?.expiresAt && new Date(existing.expiresAt).getTime() < Date.now()) {
        // Only remove the exact stale row we observed, never a lock a peer just took.
        await adapter.delete?.({
          model: 'verification',
          where: [
            { field: 'id', value: lockId },
            { field: 'value', value: existing.value },
          ],
        })
      }
    } catch {
      // Ignore check errors
    }
    return false
  }
}

async function getLockAdapter(auth: Auth): Promise<VerificationAdapter | null> {
  try {
    const ctx = await auth.$context
    const adapter = ctx.adapter as VerificationAdapter | undefined
    return adapter?.create && adapter?.delete ? adapter : null
  } catch {
    return null
  }
}

/**
 * Takes a cross-instance lock stored in the `verification` table. When the adapter cannot
 * store locks, only the in-process lock applies. When the lock cannot be taken within the
 * timeout this throws instead of continuing unprotected.
 */
async function acquireDbLock(
  auth: Auth,
  lockId: string,
  timeoutMs = LOCK_TIMEOUT_MS,
): Promise<() => Promise<void>> {
  const adapter = await getLockAdapter(auth)
  if (!adapter) {
    return async () => {}
  }

  const owner = randomUUID()
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await tryAcquireDbLock(adapter, lockId, owner)) {
      return async () => {
        try {
          // Match on the owner token so an expired holder cannot delete a newer holder's lock.
          await adapter.delete?.({
            model: 'verification',
            where: [
              { field: 'id', value: lockId },
              { field: 'value', value: owner },
            ],
          })
        } catch {
          // Ignore release errors; the lock expires on its own
        }
      }
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new LockTimeoutError(lockId)
}

export async function withAdminMutationLock<T>(auth: Auth, fn: () => Promise<T>): Promise<T> {
  return await adminLock.acquire(async () => {
    const releaseDb = await acquireDbLock(auth, 'lontar:admin-mutation-lock')
    try {
      return await fn()
    } finally {
      await releaseDb()
    }
  })
}

export async function withFirstUserLock<T>(auth: Auth, fn: () => Promise<T>): Promise<T> {
  return await firstUserLock.acquire(async () => {
    const releaseDb = await acquireDbLock(auth, 'lontar:first-user-lock')
    try {
      return await fn()
    } finally {
      await releaseDb()
    }
  })
}
