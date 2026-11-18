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
  }) => Promise<{ expiresAt?: Date | string | number } | null>
}

async function tryAcquireDbLock(adapter: VerificationAdapter, lockId: string): Promise<boolean> {
  if (!adapter.create) return true
  try {
    await adapter.create({
      model: 'verification',
      data: {
        id: lockId,
        identifier: lockId,
        value: String(Date.now()),
        expiresAt: new Date(Date.now() + 15000),
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
        await adapter.delete?.({
          model: 'verification',
          where: [{ field: 'id', value: lockId }],
        })
      }
    } catch {
      // Ignore check errors
    }
    return false
  }
}

async function acquireDbLock(
  auth: Auth,
  lockId: string,
  timeoutMs = 5000,
): Promise<() => Promise<void>> {
  try {
    const ctx = await auth.$context
    const adapter = ctx.adapter as VerificationAdapter | undefined
    if (!adapter?.create || !adapter?.delete) {
      return async () => {}
    }

    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const acquired = await tryAcquireDbLock(adapter, lockId)
      if (acquired) {
        return async () => {
          try {
            await adapter.delete?.({
              model: 'verification',
              where: [{ field: 'id', value: lockId }],
            })
          } catch {
            // Ignore release errors
          }
        }
      }
      await new Promise((r) => setTimeout(r, 25))
    }
  } catch {
    // Ignore adapter setup errors
  }
  return async () => {}
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
