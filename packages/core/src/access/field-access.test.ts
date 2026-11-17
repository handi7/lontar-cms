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

  describe('Preservation of locked/hidden subfields inside containers (#364)', () => {
    const complexFields: Record<string, Field> = {
      title: f.text(),
      notes: f.array({
        fields: {
          text: f.text(),
          isConfidential: f.checkbox({
            access: {
              read: ({ user }) => user?.role === 'admin',
              update: ({ user }) => user?.role === 'admin',
            },
          }),
        },
      }),
      blocks: f.blocks({
        blocks: [
          {
            slug: 'review',
            fields: {
              rating: f.number(),
              managerNote: f.text({
                access: {
                  read: ({ user }) => user?.role === 'admin',
                  update: ({ user }) => user?.role === 'admin',
                },
              }),
            },
          },
        ],
      }),
      meta: f.group({
        fields: {
          publicBio: f.text(),
          secretKey: f.text({
            access: {
              read: ({ user }) => user?.role === 'admin',
              update: ({ user }) => user?.role === 'admin',
            },
          }),
        },
      }),
    }

    const storedDoc = {
      id: 1,
      title: 'Original Title',
      notes: [
        { id: 'n1', text: 'Public note 1', isConfidential: true },
        { id: 'n2', text: 'Public note 2', isConfidential: false },
      ],
      blocks: [{ id: 'b1', blockType: 'review', rating: 5, managerNote: 'Promote soon' }],
      meta: {
        publicBio: 'Bio text',
        secretKey: 'Secret 12345',
      },
    }

    it('preserves denied array and blocks subfields from stored doc when omitted by caller', async () => {
      const user = makeUser('user', 'user@example.com')
      // Non-admin user submits an update where isConfidential and managerNote are omitted
      const input = {
        title: 'New Title',
        notes: [
          { id: 'n1', text: 'Updated public note 1' },
          { id: 'n2', text: 'Updated public note 2' },
        ],
        blocks: [{ id: 'b1', blockType: 'review', rating: 4 }],
        meta: {
          publicBio: 'Updated bio',
        },
      }

      const sanitized = await sanitizeDocWrite(complexFields, input, 'update', {
        user,
        id: 1,
        data: input,
        doc: storedDoc,
      })

      expect(sanitized.title).toBe('New Title')
      // Array row subfield is preserved
      expect(sanitized.notes).toEqual([
        { id: 'n1', text: 'Updated public note 1', isConfidential: true },
        { id: 'n2', text: 'Updated public note 2', isConfidential: false },
      ])
      // Block row subfield is preserved
      expect(sanitized.blocks).toEqual([
        { id: 'b1', blockType: 'review', rating: 4, managerNote: 'Promote soon' },
      ])
      // Group subfield is preserved
      expect(sanitized.meta).toEqual({
        publicBio: 'Updated bio',
        secretKey: 'Secret 12345',
      })
    })

    it('overwrites unauthorized changes to protected subfields with stored values', async () => {
      const user = makeUser('user', 'user@example.com')
      // Non-admin user tries to tamper with isConfidential, managerNote, and secretKey
      const input = {
        notes: [{ id: 'n1', text: 'Tampered note', isConfidential: false }],
        blocks: [{ id: 'b1', blockType: 'review', rating: 1, managerNote: 'Tampered review' }],
        meta: {
          publicBio: 'Tampered bio',
          secretKey: 'HACKED',
        },
      }

      const sanitized = await sanitizeDocWrite(complexFields, input, 'update', {
        user,
        id: 1,
        data: input,
        doc: storedDoc,
      })

      // Stored values remain untouched
      expect(sanitized.notes).toEqual([{ id: 'n1', text: 'Tampered note', isConfidential: true }])
      expect(sanitized.blocks).toEqual([
        { id: 'b1', blockType: 'review', rating: 1, managerNote: 'Promote soon' },
      ])
      expect(sanitized.meta).toEqual({
        publicBio: 'Tampered bio',
        secretKey: 'Secret 12345',
      })
    })

    it('strips unauthorized fields on newly added rows that have no stored match', async () => {
      const user = makeUser('user', 'user@example.com')
      const input = {
        notes: [{ id: 'brand-new-row', text: 'New Row', isConfidential: true }],
        blocks: [
          {
            id: 'brand-new-block',
            blockType: 'review',
            rating: 3,
            managerNote: 'Unauthorized Note',
          },
        ],
      }

      const sanitized = await sanitizeDocWrite(complexFields, input, 'update', {
        user,
        id: 1,
        data: input,
        doc: storedDoc,
      })

      // Unauthorized fields are stripped because there is no matching stored row to restore from
      expect(sanitized.notes).toEqual([{ id: 'brand-new-row', text: 'New Row' }])
      expect(sanitized.blocks).toEqual([{ id: 'brand-new-block', blockType: 'review', rating: 3 }])
    })
  })
})
