import { describe, expect, it, vi } from 'vitest'
import { parseDepth, populateDoc, populateDocs } from './index'
import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData, PaginatedDocs, StoredDoc } from '../database/adapter'

function createMockAdapter(docsByCollection: Record<string, StoredDoc[]>): DatabaseAdapter {
  return {
    name: 'mock',
    find({ collection, where }): Promise<PaginatedDocs> {
      let items = (docsByCollection[collection.slug] ?? []).map((d) => ({ ...d }))
      if (where?.id && typeof where.id === 'object' && 'in' in where.id) {
        const inIds = Array.isArray(where.id.in) ? where.id.in : []
        items = items.filter((item) => inIds.includes(item.id))
      }
      return Promise.resolve({
        docs: items,
        totalDocs: items.length,
        limit: 100,
        page: 1,
        totalPages: 1,
      })
    },
    findByID({ collection, id }): Promise<StoredDoc | null> {
      const items = docsByCollection[collection.slug] ?? []
      const found = items.find((d) => d.id === id)
      return Promise.resolve(found ? { ...found } : null)
    },
    create(): Promise<StoredDoc> {
      return Promise.reject(new Error('Not implemented'))
    },
    update(): Promise<StoredDoc | null> {
      return Promise.reject(new Error('Not implemented'))
    },
    delete(): Promise<StoredDoc | null> {
      return Promise.reject(new Error('Not implemented'))
    },
    findGlobal(): Promise<StoredDoc | null> {
      return Promise.resolve(null)
    },
    updateGlobal(): Promise<StoredDoc> {
      return Promise.reject(new Error('Not implemented'))
    },
    toSchemaFile(): string {
      return ''
    },
    migrate(): Promise<void> {
      return Promise.resolve()
    },
  }
}

describe('parseDepth', () => {
  it('parses valid depth strings within 0 to 10', () => {
    expect(parseDepth(undefined)).toBe(0)
    expect(parseDepth('')).toBe(0)
    expect(parseDepth('0')).toBe(0)
    expect(parseDepth('1')).toBe(1)
    expect(parseDepth('2')).toBe(2)
    expect(parseDepth('10')).toBe(10)
    expect(parseDepth('15')).toBe(10) // capped at 10
  })

  it('handles invalid or negative depths safely', () => {
    expect(parseDepth('-1')).toBe(0)
    expect(parseDepth('-99')).toBe(0)
    expect(parseDepth('abc')).toBe(0)
    expect(parseDepth('NaN')).toBe(0)
  })
})

describe('populateDocs', () => {
  const usersCollection: CollectionConfig = {
    slug: 'users',
    access: { read: () => true },
    fields: {
      name: { type: 'text', required: true },
    },
  }

  const categoriesCollection: CollectionConfig = {
    slug: 'categories',
    access: { read: () => true },
    fields: {
      name: { type: 'text', required: true },
    },
  }

  const postsCollection: CollectionConfig = {
    slug: 'posts',
    fields: {
      title: { type: 'text', required: true },
      author: { type: 'relationship', relationTo: 'users' },
      categories: { type: 'relationship', relationTo: 'categories', hasMany: true },
    },
  }

  const mockUsers: StoredDoc[] = [
    { id: 1, name: 'Alice', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 2, name: 'Bob', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ]

  const mockCategories: StoredDoc[] = [
    { id: 10, name: 'Tech', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 20, name: 'Design', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 30, name: 'News', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ]

  it('returns docs unmodified when depth is 0', async () => {
    const db = createMockAdapter({ users: mockUsers, categories: mockCategories })
    const findSpy = vi.spyOn(db, 'find')

    const docs: DocumentData[] = [{ id: 100, title: 'Post 1', author: 1, categories: [10, 20] }]

    const result = await populateDocs({
      docs,
      collection: postsCollection,
      depth: 0,
      collections: [postsCollection, usersCollection, categoriesCollection],
      db,
    })

    expect(result).toEqual([{ id: 100, title: 'Post 1', author: 1, categories: [10, 20] }])
    expect(findSpy).not.toHaveBeenCalled()
  })

  it('populates single and hasMany relationships at depth 1', async () => {
    const db = createMockAdapter({ users: mockUsers, categories: mockCategories })

    const docs: DocumentData[] = [
      { id: 101, title: 'Post 1', author: 1, categories: [20, 10] },
      { id: 102, title: 'Post 2', author: 2, categories: [30] },
      { id: 103, title: 'Post 3', author: null, categories: [] },
    ]

    const result = await populateDocs({
      docs,
      collection: postsCollection,
      depth: 1,
      collections: [postsCollection, usersCollection, categoriesCollection],
      db,
    })

    expect(result[0]?.author).toEqual(mockUsers[0])
    expect(result[0]?.categories).toEqual([mockCategories[1], mockCategories[0]]) // preserves [20, 10] order

    expect(result[1]?.author).toEqual(mockUsers[1])
    expect(result[1]?.categories).toEqual([mockCategories[2]])

    expect(result[2]?.author).toBeNull()
    expect(result[2]?.categories).toEqual([])
  })

  it('handles non-existent target IDs safely', async () => {
    const db = createMockAdapter({ users: mockUsers, categories: mockCategories })

    const docs: DocumentData[] = [
      { id: 104, title: 'Post with missing refs', author: 999, categories: [10, 888] },
    ]

    const result = await populateDocs({
      docs,
      collection: postsCollection,
      depth: 1,
      collections: [postsCollection, usersCollection, categoriesCollection],
      db,
    })

    expect(result[0]?.author).toBeNull()
    expect(result[0]?.categories).toEqual([mockCategories[0]]) // 888 filtered out
  })

  it('recursively populates nested relationships at depth 2', async () => {
    const rolesCollection: CollectionConfig = {
      slug: 'roles',
      access: { read: () => true },
      fields: {
        title: { type: 'text', required: true },
      },
    }

    const usersWithRoleCol: CollectionConfig = {
      slug: 'users',
      access: { read: () => true },
      fields: {
        name: { type: 'text', required: true },
        role: { type: 'relationship', relationTo: 'roles' },
      },
    }

    const mockRoles: StoredDoc[] = [
      { id: 50, title: 'Admin', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]

    const usersWithRoleDocs: StoredDoc[] = [
      { id: 1, name: 'Alice', role: 50, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]

    const db = createMockAdapter({
      users: usersWithRoleDocs,
      roles: mockRoles,
      categories: [],
    })

    const docs: DocumentData[] = [
      { id: 201, title: 'Nested Depth Post', author: 1, categories: [] },
    ]

    const result = await populateDocs({
      docs,
      collection: postsCollection,
      depth: 2,
      collections: [postsCollection, usersWithRoleCol, rolesCollection],
      db,
    })

    expect(result[0]?.author).toEqual({
      id: 1,
      name: 'Alice',
      role: mockRoles[0],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
  })

  it('prevents infinite recursion on circular relationships', async () => {
    const nodeA: CollectionConfig = {
      slug: 'nodeA',
      access: { read: () => true },
      fields: {
        name: { type: 'text' },
        b: { type: 'relationship', relationTo: 'nodeB' },
      },
    }

    const nodeB: CollectionConfig = {
      slug: 'nodeB',
      access: { read: () => true },
      fields: {
        name: { type: 'text' },
        a: { type: 'relationship', relationTo: 'nodeA' },
      },
    }

    const mockNodeB: StoredDoc[] = [
      { id: 1, name: 'B1', a: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]
    const mockNodeA: StoredDoc[] = [
      { id: 1, name: 'A1', b: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]

    const db = createMockAdapter({
      nodeA: mockNodeA,
      nodeB: mockNodeB,
    })

    const docs: DocumentData[] = [{ id: 1, name: 'A1', b: 1 }]

    const result = await populateDocs({
      docs,
      collection: nodeA,
      depth: 5,
      collections: [nodeA, nodeB],
      db,
    })

    // Node A populates Node B. In Node B, Node A is already seen, so it remains id: 1.
    const bPopulated = result[0]?.b as DocumentData
    expect(bPopulated.name).toBe('B1')
    expect(bPopulated.a).toBe(1)
  })

  it('respects read access control on the target collection', async () => {
    const secretUsersCol: CollectionConfig = {
      slug: 'secret_users',
      access: {
        read: ({ user }) => Boolean(user && user.role === 'admin'),
      },
      fields: {
        name: { type: 'text' },
      },
    }

    const secretPostCol: CollectionConfig = {
      slug: 'posts',
      fields: {
        author: { type: 'relationship', relationTo: 'secret_users' },
      },
    }

    const db = createMockAdapter({
      secret_users: [
        { id: 1, name: 'Secret Agent', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
    })

    // Anonymous request (user = null)
    const anonResult = await populateDocs({
      docs: [{ id: 10, author: 1 }],
      collection: secretPostCol,
      depth: 1,
      collections: [secretPostCol, secretUsersCol],
      db,
      user: null,
    })
    // Access denied on secret_users -> remains unpopulated
    expect(anonResult[0]?.author).toBe(1)

    // Admin request
    const adminResult = await populateDocs({
      docs: [{ id: 10, author: 1 }],
      collection: secretPostCol,
      depth: 1,
      collections: [secretPostCol, secretUsersCol],
      db,
      user: {
        id: 'admin1',
        email: 'admin@example.com',
        name: 'Admin',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'admin',
      },
    })
    expect(adminResult[0]?.author).toEqual({
      id: 1,
      name: 'Secret Agent',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
  })

  it('executes afterRead hooks on populated target documents', async () => {
    const afterReadHook = vi.fn(({ doc }: { doc: DocumentData }): DocumentData => ({
      ...doc,
      computedField: 'computed',
    }))

    const hookedUsersCol: CollectionConfig = {
      slug: 'users',
      access: { read: () => true },
      fields: {
        name: { type: 'text' },
      },
      hooks: {
        afterRead: [afterReadHook],
      },
    }

    const db = createMockAdapter({ users: mockUsers })

    const result = await populateDocs({
      docs: [{ id: 1, author: 1 }],
      collection: postsCollection,
      depth: 1,
      collections: [postsCollection, hookedUsersCol],
      db,
    })

    expect(afterReadHook).toHaveBeenCalled()
    expect(result[0]?.author).toMatchObject({
      name: 'Alice',
      computedField: 'computed',
    })
  })

  it('denies relationship population on collections with default access for anonymous user and allows for authenticated user', async () => {
    const defaultUsersCol: CollectionConfig = {
      slug: 'default_users',
      fields: {
        name: { type: 'text' },
      },
    }

    const postCol: CollectionConfig = {
      slug: 'posts',
      fields: {
        author: { type: 'relationship', relationTo: 'default_users' },
      },
    }

    const db = createMockAdapter({
      default_users: [
        { id: 1, name: 'Normal User', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
    })

    // Anonymous request (user = null) -> denied because default access requires auth
    const anonResult = await populateDocs({
      docs: [{ id: 10, author: 1 }],
      collection: postCol,
      depth: 1,
      collections: [postCol, defaultUsersCol],
      db,
      user: null,
    })
    expect(anonResult[0]?.author).toBe(1)

    // Authenticated request -> allowed
    const authResult = await populateDocs({
      docs: [{ id: 10, author: 1 }],
      collection: postCol,
      depth: 1,
      collections: [postCol, defaultUsersCol],
      db,
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    expect(authResult[0]?.author).toEqual({
      id: 1,
      name: 'Normal User',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
  })

  it('populateDoc helper populates a single document', async () => {
    const db = createMockAdapter({ users: mockUsers })

    const doc: DocumentData = { id: 1, author: 1 }
    const result = await populateDoc(doc, {
      collection: postsCollection,
      depth: 1,
      collections: [postsCollection, usersCollection],
      db,
    })

    expect(result.author).toEqual(mockUsers[0])
  })
})
