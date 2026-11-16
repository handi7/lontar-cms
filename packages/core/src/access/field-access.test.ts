import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../auth/types'
import { fields as f } from '../fields'
import type { Field } from '../fields/types'
import { checkFieldAccess, sanitizeDocRead, sanitizeDocWrite } from './field-access'

function makeUser(role = 'user', email = 'u@example.com'): AuthUser {
  return {
    id: `${role}-${email}`,
    name: 'User',
    email,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    role,
  }
}

describe('checkFieldAccess', () => {
  it('returns true when no access function is provided', async () => {
    const res = await checkFieldAccess(undefined, { user: null })
    expect(res).toBe(true)
  })

  it('calls access function with provided args', async () => {
    const fn = vi.fn().mockReturnValue(true)
    const user = makeUser('admin', 'test@example.com')
    const res = await checkFieldAccess(fn, {
      user,
      id: 'doc-1',
      data: { title: 'Hello' },
    })
    expect(res).toBe(true)
    expect(fn).toHaveBeenCalled()
  })

  it('memoizes user-only checks across calls', async () => {
    const fn = vi
      .fn()
      .mockImplementation(({ user }: { user: AuthUser | null }) => user?.role === 'admin')
    const admin = makeUser('admin', 'admin@example.com')

    const res1 = await checkFieldAccess(fn, { user: admin })
    const res2 = await checkFieldAccess(fn, { user: admin })
    expect(res1).toBe(true)
    expect(res2).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not memoize when document properties are accessed', async () => {
    const fn = vi.fn().mockImplementation(({ doc }: { doc?: unknown }) => Boolean(doc))
    const user = makeUser('user', 'u@example.com')

    await checkFieldAccess(fn, { user, doc: { status: 'published' } })
    await checkFieldAccess(fn, { user, doc: { status: 'draft' } })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('catches thrown error, logs warning and returns false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = vi.fn().mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await checkFieldAccess(fn, { user: null })
    expect(res).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('sanitizeDocRead', () => {
  const fields: Record<string, Field> = {
    title: f.text(),
    secretNote: f.text({
      access: {
        read: ({ user }) => user?.role === 'admin',
      },
    }),
    meta: f.group({
      fields: {
        publicInfo: f.text(),
        privateInfo: f.text({
          access: {
            read: ({ user }) => user?.role === 'admin',
          },
        }),
      },
    }),
    comments: f.array({
      fields: {
        text: f.text(),
        internalFlag: f.checkbox({
          access: {
            read: ({ user }) => user?.role === 'admin',
          },
        }),
      },
    }),
    content: f.blocks({
      blocks: [
        {
          slug: 'callout',
          fields: {
            message: f.text(),
            internalId: f.text({
              access: {
                read: ({ user }) => user?.role === 'admin',
              },
            }),
          },
        },
      ],
    }),
  }

  const sampleDoc = {
    id: 1,
    title: 'Post Title',
    secretNote: 'Super secret',
    meta: {
      publicInfo: 'visible',
      privateInfo: 'hidden from normal users',
    },
    comments: [
      { text: 'Great post', internalFlag: true },
      { text: 'Second comment', internalFlag: false },
    ],
    content: [{ blockType: 'callout', message: 'Note here', internalId: 'CID-123' }],
  }

  it('preserves all fields for admin user', async () => {
    const admin = makeUser('admin', 'admin@example.com')
    const res = await sanitizeDocRead(fields, sampleDoc, admin)
    expect(res).toEqual(sampleDoc)
  })

  it('strips unreadable fields at top level and inside group, array, and blocks for non-admin', async () => {
    const regularUser = makeUser('user', 'user@example.com')
    const res = await sanitizeDocRead(fields, sampleDoc, regularUser)

    expect(res.title).toBe('Post Title')
    expect(res.secretNote).toBeUndefined()
    expect(res.meta).toEqual({
      publicInfo: 'visible',
    })
    expect(res.comments).toEqual([{ text: 'Great post' }, { text: 'Second comment' }])
    expect(res.content).toEqual([{ blockType: 'callout', message: 'Note here' }])
  })
})

describe('sanitizeDocWrite', () => {
  const fields: Record<string, Field> = {
    title: f.text(),
    salary: f.number({
      access: {
        create: ({ user }) => user?.role === 'admin',
        update: ({ user }) => user?.role === 'admin',
      },
    }),
    role: f.text({
      access: {
        create: () => true,
        update: ({ user }) => user?.role === 'admin',
      },
    }),
    details: f.group({
      fields: {
        bio: f.text(),
        ssn: f.text({
          access: {
            create: ({ user }) => user?.role === 'admin',
            update: ({ user }) => user?.role === 'admin',
          },
        }),
      },
    }),
  }

  it('drops forbidden fields on create', async () => {
    const user = makeUser('user', 'user@example.com')
    const input = {
      title: 'Alice',
      salary: 100000,
      role: 'editor',
      details: {
        bio: 'Hello world',
        ssn: '000-00-0000',
      },
    }

    const sanitized = await sanitizeDocWrite(fields, input, 'create', { user })
    expect(sanitized.title).toBe('Alice')
    expect(sanitized.salary).toBeUndefined()
    expect(sanitized.role).toBe('editor')
    expect(sanitized.details).toEqual({
      bio: 'Hello world',
    })
  })

  it('drops forbidden fields on update', async () => {
    const user = makeUser('user', 'user@example.com')
    const input = {
      title: 'Alice Updated',
      role: 'admin',
      details: {
        bio: 'Updated bio',
        ssn: '111-22-3333',
      },
    }

    const sanitized = await sanitizeDocWrite(fields, input, 'update', { user })
    expect(sanitized.title).toBe('Alice Updated')
    expect(sanitized.role).toBeUndefined()
    expect(sanitized.details).toEqual({
      bio: 'Updated bio',
    })
  })
})
