import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type { DatabaseAdapter, StoredDoc } from '../../database/adapter'
import { fields as f } from '../../fields'
import { getLontar } from '../../local'
import { createLontar } from '../create-lontar'

interface EmployeeDoc {
  id: number
  name: string
  salary?: number
  meta?: { publicBio?: string; ssn?: string }
  notes?: Array<{ id: string; text: string; isConfidential?: boolean }>
  blocks?: Array<{ id?: string; blockType: string; rating?: number; managerNote?: string }>
}

interface ProjectDoc {
  id: number
  title: string
  lead?: EmployeeDoc
}

let store: Record<string, Record<number, Record<string, unknown>>> = {}

function resetStore(): void {
  store = {
    employees: {
      1: {
        id: 1,
        name: 'Alice',
        salary: 100000,
        meta: { publicBio: 'Software Engineer', ssn: '000-11-2222' },
        notes: [{ id: 'n1', text: 'Great worker', isConfidential: true }],
        blocks: [{ id: 'b1', blockType: 'review', rating: 5, managerNote: 'Top performer' }],
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    },
    projects: {
      1: {
        id: 1,
        title: 'Project Apollo',
        lead: 1,
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
    },
  }
}

function createMockAdapter(): DatabaseAdapter {
  resetStore()

  return {
    name: 'mock',
    find: vi
      .fn()
      .mockImplementation(
        ({ collection: col }: { collection: { slug: string }; where?: unknown }) => {
          const records = Object.values(store[col.slug] ?? {})
          return Promise.resolve({
            docs: records,
            totalDocs: records.length,
            limit: 10,
            page: 1,
            totalPages: 1,
          })
        },
      ),
    findByID: vi
      .fn()
      .mockImplementation(
        ({ collection: col, id }: { collection: { slug: string }; id: number }) => {
          const doc = store[col.slug]?.[id]
          return Promise.resolve(doc ? { ...doc } : null)
        },
      ),
    create: vi
      .fn()
      .mockImplementation(
        ({
          collection: col,
          data,
        }: {
          collection: { slug: string }
          data: Record<string, unknown>
        }) => {
          const id = 2
          const created = {
            id,
            ...data,
            createdAt: '2026-10-31T00:00:00.000Z',
            updatedAt: '2026-10-31T00:00:00.000Z',
          }
          const colStore = store[col.slug] ?? (store[col.slug] = {})
          colStore[id] = created
          return Promise.resolve(created as StoredDoc)
        },
      ),
    update: vi
      .fn()
      .mockImplementation(
        ({
          collection: col,
          id,
          data,
        }: {
          collection: { slug: string }
          id: number
          data: Record<string, unknown>
        }) => {
          const colStore = store[col.slug]
          const existing = colStore?.[id]
          if (!existing) return Promise.resolve(null)
          const updated = {
            ...existing,
            ...data,
            updatedAt: '2026-10-31T01:00:00.000Z',
          }
          if (colStore) {
            colStore[id] = updated
          }
          return Promise.resolve(updated as StoredDoc)
        },
      ),
    delete: vi
      .fn()
      .mockImplementation(
        ({ collection: col, id }: { collection: { slug: string }; id: number }) => {
          const colStore = store[col.slug]
          const existing = colStore?.[id]
          if (colStore && existing) {
            delete colStore[id]
            return Promise.resolve(existing as StoredDoc)
          }
          return Promise.resolve(null)
        },
      ),
    findGlobal: vi.fn().mockResolvedValue(null),
    updateGlobal: vi.fn().mockResolvedValue(null),
    toSchemaFile: vi.fn().mockReturnValue(''),
    migrate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Field-Level Access Control Integration', () => {
  beforeEach(() => {
    resetStore()
  })

  const employees = collection({
    slug: 'employees',
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
    fields: {
      name: f.text({ required: true }),
      salary: f.number({
        access: {
          read: ({ user }) => user?.role === 'admin',
          create: ({ user }) => user?.role === 'admin',
          update: ({ user }) => user?.role === 'admin',
        },
      }),
      meta: f.group({
        fields: {
          publicBio: f.text(),
          ssn: f.text({
            access: {
              read: ({ user }) => user?.role === 'admin',
              create: ({ user }) => user?.role === 'admin',
              update: ({ user }) => user?.role === 'admin',
            },
          }),
        },
      }),
      notes: f.array({
        fields: {
          text: f.text(),
          isConfidential: f.checkbox({
            access: {
              read: ({ user }) => user?.role === 'admin',
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
                },
              }),
            },
          },
        ],
      }),
    },
  })

  const projects = collection({
    slug: 'projects',
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
    fields: {
      title: f.text({ required: true }),
      lead: f.relationship({
        relationTo: 'employees',
      }),
    },
  })

  const config = defineConfig({
    secret: 'test-secret-at-least-32-characters-long!',
    db: createMockAdapter(),
    collections: [employees, projects],
  })

  it('strips unreadable top-level, group, array, and blocks fields on read for non-admin', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    const res = await app.request('/api/employees/1')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as EmployeeDoc

    expect(doc.name).toBe('Alice')
    expect(doc.salary).toBeUndefined()
    expect(doc.meta).toEqual({ publicBio: 'Software Engineer' })
    expect(doc.notes).toEqual([{ id: 'n1', text: 'Great worker' }])
    expect(doc.blocks).toEqual([{ id: 'b1', blockType: 'review', rating: 5 }])
  })

  it('preserves all fields for admin user', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    // Sign up initial admin user
    const signUpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin',
      }),
    })
    expect(signUpRes.status).toBe(200)
    const cookie = signUpRes.headers.get('set-cookie')!

    const res = await app.request('/api/employees/1', {
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    const doc = (await res.json()) as EmployeeDoc

    expect(doc.name).toBe('Alice')
    expect(doc.salary).toBe(100000)
    expect(doc.meta?.ssn).toBe('000-11-2222')
    expect(doc.notes?.[0]?.isConfidential).toBe(true)
    expect(doc.blocks?.[0]?.managerNote).toBe('Top performer')
  })

  it('silently drops forbidden fields on create and update', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    // Create with forbidden salary
    const createRes = await app.request('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        salary: 80000,
        meta: { publicBio: 'Junior Dev', ssn: '999-99-9999' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as EmployeeDoc
    expect(created.name).toBe('Bob')
    expect(created.salary).toBeUndefined()
    expect(created.meta?.ssn).toBeUndefined()

    // Update with forbidden salary on employee 1
    const updateRes = await app.request('/api/employees/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Cooper',
        salary: 200000,
        meta: { ssn: 'changed' },
      }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as EmployeeDoc
    expect(updated.name).toBe('Alice Cooper')
    expect(updated.salary).toBeUndefined()
    expect(updated.meta?.ssn).toBeUndefined()
  })

  it('preserves hidden/locked array and blocks subfields in database when non-admin updates document (#364)', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    // Non-admin user updates employee 1 with array and block edits, omitting hidden fields
    const updateRes = await app.request('/api/employees/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Cooper',
        notes: [{ id: 'n1', text: 'Great worker modified' }],
        blocks: [{ id: 'b1', blockType: 'review', rating: 4 }],
      }),
    })
    expect(updateRes.status).toBe(200)

    // Verify stored document in database preserved the hidden/locked subfields
    const stored = store['employees']![1]!
    expect(stored['name']).toBe('Alice Cooper')
    const storedNotes = stored['notes'] as Array<{
      id: string
      text: string
      isConfidential?: boolean
    }>
    expect(storedNotes[0]?.text).toBe('Great worker modified')
    expect(storedNotes[0]?.isConfidential).toBe(true)

    const storedBlocks = stored['blocks'] as Array<{
      id: string
      blockType: string
      rating?: number
      managerNote?: string
    }>
    expect(storedBlocks[0]?.rating).toBe(4)
    expect(storedBlocks[0]?.managerNote).toBe('Top performer')
  })

  it('rejects where filter on unreadable field with 400 Bad Request', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    const res = await app.request('/api/employees?where[salary][greater_than]=50000')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      message: "Field 'salary' cannot be filtered or sorted by current user",
      issues: [
        {
          path: 'salary',
          message: "Field 'salary' cannot be filtered or sorted by current user",
        },
      ],
    })
  })

  it('rejects sort on unreadable field with 400 Bad Request', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    const res = await app.request('/api/employees?sort=-salary')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      message: "Field 'salary' cannot be filtered or sorted by current user",
      issues: [
        {
          path: 'salary',
          message: "Field 'salary' cannot be filtered or sorted by current user",
        },
      ],
    })
  })

  it('strips forbidden fields from populated related documents', async () => {
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    const res = await app.request('/api/projects/1?depth=1')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as ProjectDoc

    expect(doc.title).toBe('Project Apollo')
    expect(doc.lead).toBeDefined()
    expect(doc.lead?.name).toBe('Alice')
    expect(doc.lead?.salary).toBeUndefined()
    expect(doc.lead?.meta?.ssn).toBeUndefined()
  })

  it('respects overrideAccess in Local API', async () => {
    const lontar = await getLontar(config)

    // With overrideAccess: true (default) -> returns all fields
    const full = await lontar.findByID<EmployeeDoc>('employees', 1)
    expect(full?.salary).toBe(100000)
    expect(full?.meta?.ssn).toBe('000-11-2222')

    // With overrideAccess: false, user: null -> strips forbidden fields
    const restricted = await lontar.findByID<EmployeeDoc>('employees', 1, {
      overrideAccess: false,
      user: null,
    })
    expect(restricted?.salary).toBeUndefined()
    expect(restricted?.meta?.ssn).toBeUndefined()

    // With overrideAccess: false, where on unreadable field -> throws ValidationError
    await expect(
      lontar.find('employees', {
        where: { salary: { greater_than: 50000 } },
        overrideAccess: false,
        user: null,
      }),
    ).rejects.toThrow('Validation failed')
  })
})
