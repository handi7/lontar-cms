import { describe, expect, it, vi } from 'vitest'
import { parseDepth, populateDoc, populateDocs } from './index'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData, PaginatedDocs, StoredDoc } from '../database/adapter'
import type { Where } from '../query/types'

function extractInIds(where?: Where): unknown[] | null {
  if (!where) return null
  if (where.id && typeof where.id === 'object' && 'in' in where.id) {
    const inCond = where.id as { in?: unknown }
    return Array.isArray(inCond.in) ? inCond.in : null
  }
  if (Array.isArray(where.and)) {
    for (const sub of where.and) {
      const ids = extractInIds(sub)
      if (ids) return ids
    }
  }
  return null
}

function checkPublishedFilter(where?: Where): boolean {
  if (!where) return false
  if (where._status && typeof where._status === 'object' && 'equals' in where._status) {
    return (where._status as { equals?: unknown }).equals === 'published'
  }
  if (Array.isArray(where.and)) {
    return where.and.some(checkPublishedFilter)
  }
  return false
}

function filterByWhere(items: StoredDoc[], where?: Where): StoredDoc[] {
  let result = items
  const inIds = extractInIds(where)
  if (inIds) {
    result = result.filter((item) => inIds.includes(item.id))
  }
  if (checkPublishedFilter(where)) {
    result = result.filter((item) => item._status === 'published')
  }
  return result
}

function resolveMockLimit(
  limit: number,
  maxLimit: number | undefined,
  overrideLimit: boolean | undefined,
): number {
  if (overrideLimit || maxLimit === undefined) return limit
  return Math.min(limit, maxLimit)
}

function createMockAdapter(docsByCollection: Record<string, StoredDoc[]>): DatabaseAdapter {
  return {
    name: 'mock',
    find({ collection, where, limit, overrideLimit }): Promise<PaginatedDocs> {
      const all = (docsByCollection[collection.slug] ?? []).map((d) => ({ ...d }))
      const filtered = filterByWhere(all, where)
      const effectiveLimit = resolveMockLimit(limit, collection.pagination?.maxLimit, overrideLimit)
      const docs = effectiveLimit >= 0 ? filtered.slice(0, effectiveLimit) : filtered
      return Promise.resolve({
        docs,
        totalDocs: docs.length,
        limit: effectiveLimit,
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
    access: { read: () => true },
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
        role: 'editor',
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

  describe('nested fields (group, array, blocks)', () => {
    const mediaCol: CollectionConfig = {
      slug: 'media',
      upload: true,
      access: { read: () => true },
      fields: {
        alt: { type: 'text' },
      },
    }

    const tagsCol: CollectionConfig = {
      slug: 'tags',
      access: { read: () => true },
      fields: {
        name: { type: 'text' },
      },
    }

    const complexCol: CollectionConfig = {
      slug: 'pages',
      fields: {
        title: { type: 'text', required: true },
        seo: {
          type: 'group',
          fields: {
            ogImage: { type: 'upload', relationTo: 'media' },
            author: { type: 'relationship', relationTo: 'users' },
            tags: { type: 'relationship', relationTo: 'tags', hasMany: true },
          },
        },
        gallery: {
          type: 'array',
          fields: {
            image: { type: 'upload', relationTo: 'media' },
            curator: { type: 'relationship', relationTo: 'users' },
            tags: { type: 'relationship', relationTo: 'tags', hasMany: true },
          },
        },
        layout: {
          type: 'blocks',
          blocks: [
            {
              slug: 'hero',
              fields: {
                headline: { type: 'text' },
                backgroundImage: { type: 'upload', relationTo: 'media' },
              },
            },
            {
              slug: 'featuredPosts',
              fields: {
                heading: { type: 'text' },
                posts: { type: 'relationship', relationTo: 'posts', hasMany: true },
              },
            },
          ],
        },
      },
    }

    const mockMedia: StoredDoc[] = [
      { id: 10, alt: 'Header Banner', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 20, alt: 'Photo 1', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 30, alt: 'Photo 2', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]

    const mockTags: StoredDoc[] = [
      { id: 100, name: 'Tech', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 200, name: 'Design', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]

    const mockPosts: StoredDoc[] = [
      { id: 301, title: 'First Post', author: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      {
        id: 302,
        title: 'Second Post',
        author: 2,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]

    it('populates relationships and uploads inside group, array, and blocks at depth 1', async () => {
      const db = createMockAdapter({
        media: mockMedia,
        users: mockUsers,
        tags: mockTags,
        posts: mockPosts,
      })

      const doc: DocumentData = {
        id: 1,
        title: 'Home Page',
        seo: {
          ogImage: 10,
          author: 1,
          tags: [200, 100],
        },
        gallery: [
          { id: 'g1', image: 20, curator: 2, tags: [100] },
          { id: 'g2', image: 30, curator: 1, tags: [200] },
        ],
        layout: [
          { id: 'b1', blockType: 'hero', headline: 'Welcome', backgroundImage: 10 },
          { id: 'b2', blockType: 'featuredPosts', heading: 'Recent', posts: [302, 301] },
        ],
      }

      const result = await populateDocs({
        docs: [doc],
        collection: complexCol,
        depth: 1,
        collections: [complexCol, mediaCol, usersCollection, tagsCol, postsCollection],
        db,
      })

      const populated = result[0]!
      // Group
      const seo = populated.seo as Record<string, unknown>
      expect(seo.ogImage).toEqual(mockMedia[0])
      expect(seo.author).toEqual(mockUsers[0])
      expect(seo.tags).toEqual([mockTags[1], mockTags[0]])

      // Array
      const gallery = populated.gallery as Array<Record<string, unknown>>
      expect(gallery[0]?.image).toEqual(mockMedia[1])
      expect(gallery[0]?.curator).toEqual(mockUsers[1])
      expect(gallery[0]?.tags).toEqual([mockTags[0]])

      expect(gallery[1]?.image).toEqual(mockMedia[2])
      expect(gallery[1]?.curator).toEqual(mockUsers[0])
      expect(gallery[1]?.tags).toEqual([mockTags[1]])

      // Blocks
      const layout = populated.layout as Array<Record<string, unknown>>
      expect(layout[0]?.backgroundImage).toEqual(mockMedia[0])
      expect(layout[1]?.posts).toEqual([mockPosts[1], mockPosts[0]])
    })

    it('recursively populates nested references at depth 2 (e.g. block -> post -> author)', async () => {
      const db = createMockAdapter({
        media: mockMedia,
        users: mockUsers,
        tags: mockTags,
        posts: mockPosts,
      })

      const doc: DocumentData = {
        id: 1,
        title: 'Home Page',
        layout: [{ id: 'b1', blockType: 'featuredPosts', heading: 'Recent', posts: [301] }],
      }

      const result = await populateDocs({
        docs: [doc],
        collection: complexCol,
        depth: 2,
        collections: [complexCol, mediaCol, usersCollection, tagsCol, postsCollection],
        db,
      })

      const layout = result[0]?.layout as Array<Record<string, unknown>>
      const posts = layout[0]?.posts as Array<Record<string, unknown>>
      expect(posts[0]?.id).toBe(301)
      expect(posts[0]?.author).toEqual(mockUsers[0]) // User Alice populated inside post inside block!
    })

    it('handles deleted/missing referenced documents inside group, array, and blocks safely', async () => {
      const db = createMockAdapter({
        media: [mockMedia[0]!], // 20 and 30 are missing/deleted
        users: [], // users deleted
        tags: [mockTags[0]!], // 200 is missing/deleted
        posts: [mockPosts[0]!], // 302 is missing/deleted
      })

      const doc: DocumentData = {
        id: 1,
        title: 'Home Page',
        seo: {
          ogImage: 999, // missing
          author: 888, // missing
          tags: [100, 200], // 200 missing
        },
        gallery: [
          { id: 'g1', image: 20, curator: 2, tags: [200] }, // all missing except tags is empty
        ],
        layout: [
          { id: 'b1', blockType: 'hero', headline: 'Welcome', backgroundImage: 999 }, // missing
          { id: 'b2', blockType: 'featuredPosts', heading: 'Recent', posts: [301, 302] }, // 302 missing
        ],
      }

      const result = await populateDocs({
        docs: [doc],
        collection: complexCol,
        depth: 1,
        collections: [complexCol, mediaCol, usersCollection, tagsCol, postsCollection],
        db,
      })

      const populated = result[0]!
      const seo = populated.seo as Record<string, unknown>
      expect(seo.ogImage).toBeNull()
      expect(seo.author).toBeNull()
      expect(seo.tags).toEqual([mockTags[0]]) // 200 omitted

      const gallery = populated.gallery as Array<Record<string, unknown>>
      expect(gallery[0]?.image).toBeNull()
      expect(gallery[0]?.curator).toBeNull()
      expect(gallery[0]?.tags).toEqual([])

      const layout = populated.layout as Array<Record<string, unknown>>
      expect(layout[0]?.backgroundImage).toBeNull()
      expect(layout[1]?.posts).toEqual([mockPosts[0]]) // 302 omitted
    })

    it('batches all target IDs across nested structures into a single query per collection', async () => {
      const db = createMockAdapter({
        media: mockMedia,
        users: mockUsers,
        tags: mockTags,
        posts: mockPosts,
      })
      const findSpy = vi.spyOn(db, 'find')

      const doc: DocumentData = {
        id: 1,
        title: 'Batched Page',
        seo: {
          ogImage: 10,
        },
        gallery: [
          { id: 'g1', image: 20 },
          { id: 'g2', image: 30 },
        ],
        layout: [{ id: 'b1', blockType: 'hero', backgroundImage: 10 }],
      }

      await populateDocs({
        docs: [doc],
        collection: complexCol,
        depth: 1,
        collections: [complexCol, mediaCol, usersCollection, tagsCol, postsCollection],
        db,
      })

      // Media IDs 10, 20, 30 across seo, gallery, and layout should be requested in a single find() call
      const mediaCalls = findSpy.mock.calls.filter(([args]) => args.collection.slug === 'media')
      expect(mediaCalls).toHaveLength(1)
      const whereId = mediaCalls[0]![0].where?.id as { in: number[] }
      expect(whereId.in.sort((a, b) => a - b)).toEqual([10, 20, 30])
    })

    it('respects read access control inside nested fields (leaves unpopulated when denied)', async () => {
      const restrictedMediaCol: CollectionConfig = {
        slug: 'media',
        upload: true,
        access: { read: () => false }, // Denied to all
        fields: {
          alt: { type: 'text' },
        },
      }

      const db = createMockAdapter({
        media: mockMedia,
        users: mockUsers,
        tags: mockTags,
        posts: mockPosts,
      })

      const doc: DocumentData = {
        id: 1,
        title: 'Restricted Page',
        seo: {
          ogImage: 10,
        },
        gallery: [{ id: 'g1', image: 20 }],
        layout: [{ id: 'b1', blockType: 'hero', backgroundImage: 10 }],
      }

      const result = await populateDocs({
        docs: [doc],
        collection: complexCol,
        depth: 1,
        collections: [complexCol, restrictedMediaCol, usersCollection, tagsCol, postsCollection],
        db,
      })

      const populated = result[0]!
      // When access denied on media, IDs remain unpopulated
      expect((populated.seo as Record<string, unknown>).ogImage).toBe(10)
      expect((populated.gallery as Array<Record<string, unknown>>)[0]!.image).toBe(20)
      expect((populated.layout as Array<Record<string, unknown>>)[0]!.backgroundImage).toBe(10)
    })

    it('is not truncated by target collection pagination.maxLimit', async () => {
      const mediaWithMaxLimit: CollectionConfig = {
        slug: 'media',
        access: { read: () => true },
        pagination: { maxLimit: 2 },
        fields: {
          filename: { type: 'text', required: true },
        },
      }

      const mediaItems: StoredDoc[] = [
        { id: 1, filename: '1.jpg', createdAt: '', updatedAt: '' },
        { id: 2, filename: '2.jpg', createdAt: '', updatedAt: '' },
        { id: 3, filename: '3.jpg', createdAt: '', updatedAt: '' },
        { id: 4, filename: '4.jpg', createdAt: '', updatedAt: '' },
        { id: 5, filename: '5.jpg', createdAt: '', updatedAt: '' },
      ]

      const galleryCol: CollectionConfig = {
        slug: 'gallery-pages',
        access: { read: () => true },
        fields: {
          title: { type: 'text', required: true },
          images: {
            type: 'relationship',
            relationTo: 'media',
            hasMany: true,
          },
        },
      }

      const db = createMockAdapter({
        media: mediaItems,
      })

      const doc: DocumentData = {
        id: 100,
        title: 'Vacation Photos',
        images: [1, 2, 3, 4, 5],
      }

      const result = await populateDocs({
        docs: [doc],
        collection: galleryCol,
        depth: 1,
        collections: [galleryCol, mediaWithMaxLimit],
        db,
      })

      const populated = result[0]!
      expect(populated.images).toEqual([
        expect.objectContaining({ id: 1, filename: '1.jpg' }),
        expect.objectContaining({ id: 2, filename: '2.jpg' }),
        expect.objectContaining({ id: 3, filename: '3.jpg' }),
        expect.objectContaining({ id: 4, filename: '4.jpg' }),
        expect.objectContaining({ id: 5, filename: '5.jpg' }),
      ])
    })
  })

  describe('draft population access and target hydration', () => {
    const authorsCol: CollectionConfig = {
      slug: 'authors',
      versions: { drafts: true },
      access: {
        read: () => true,
        update: ({ user }) => user?.id === 'admin',
      },
      fields: {
        name: { type: 'text', required: true },
      },
    }

    const postsCol: CollectionConfig = {
      slug: 'posts',
      access: { read: () => true, update: () => true },
      fields: {
        title: { type: 'text', required: true },
        author: { type: 'relationship', relationTo: 'authors' },
      },
    }

    it('projects a hydrated draft snapshot of the target to the requested locale', async () => {
      const localizedAuthors: CollectionConfig = {
        ...authorsCol,
        fields: { name: { type: 'text', required: true, localized: true } },
      }
      const now = new Date().toISOString()
      const db = createMockAdapter({
        authors: [{ id: 1, name: 'Live', _status: 'published', createdAt: now, updatedAt: now }],
      })
      db.findLatestDraftVersion = vi.fn().mockResolvedValue({
        id: 99,
        parentId: 1,
        versionNumber: 2,
        snapshot: { id: 1, name: { en: 'News', id: 'Berita' }, _status: 'draft' },
        _status: 'draft',
        autosave: false,
        createdAt: now,
        createdBy: null,
      })
      const adminUser = { id: 'admin', email: 'admin@example.com' } as unknown as AuthUser

      const result = await populateDocs({
        docs: [{ id: 10, title: 'Post 1', author: 1 }],
        collection: postsCol,
        depth: 1,
        collections: [postsCol, localizedAuthors],
        db,
        user: adminUser,
        draft: true,
        locale: 'id',
        fallbackLocale: 'en',
      })

      expect(result[0]!.author).toMatchObject({ id: 1, name: 'Berita' })
    })

    it('populates published target and hides draft-only target when user lacks update access on target', async () => {
      const now = new Date().toISOString()
      const mockAuthors: StoredDoc[] = [
        { id: 1, name: 'Live Author', _status: 'published', createdAt: now, updatedAt: now },
        { id: 2, name: 'Draft Only Author', _status: 'draft', createdAt: now, updatedAt: now },
      ]

      const db = createMockAdapter({ authors: mockAuthors })
      db.findLatestDraftVersion = vi.fn().mockImplementation(({ parentId }) => {
        if (parentId === 1) {
          return Promise.resolve({
            id: 99,
            parentId: 1,
            versionNumber: 2,
            snapshot: { id: 1, name: 'Live Author WIP', _status: 'draft' },
            _status: 'draft',
            autosave: false,
            createdAt: '2026-11-10T00:00:00.000Z',
            createdBy: null,
          })
        }
        return Promise.resolve(null)
      })

      const regularUser = { id: 'regular', email: 'regular@example.com' } as unknown as AuthUser

      // 1. Regular user has draft=true on posts, but only read on authors
      const result = await populateDocs({
        docs: [
          { id: 10, title: 'Post 1', author: 1 },
          { id: 20, title: 'Post 2', author: 2 },
        ],
        collection: postsCol,
        depth: 1,
        collections: [postsCol, authorsCol],
        db,
        user: regularUser,
        draft: true,
      })

      // Target with published row is populated as published, NOT the WIP draft snapshot
      expect(result[0]!.author).toMatchObject({ id: 1, name: 'Live Author', _status: 'published' })
      // Draft-only target resolves to null
      expect(result[1]!.author).toBeNull()

      // 2. Admin user with update access on authors gets hydrated pending draft and draft-only target
      const adminUser = { id: 'admin', email: 'admin@example.com' } as unknown as AuthUser
      const adminResult = await populateDocs({
        docs: [
          { id: 10, title: 'Post 1', author: 1 },
          { id: 20, title: 'Post 2', author: 2 },
        ],
        collection: postsCol,
        depth: 1,
        collections: [postsCol, authorsCol],
        db,
        user: adminUser,
        draft: true,
      })

      // Admin gets hydrated pending draft for author 1
      expect(adminResult[0]!.author).toMatchObject({
        id: 1,
        name: 'Live Author WIP',
        _status: 'draft',
      })
      // Admin gets draft-only target
      expect(adminResult[1]!.author).toMatchObject({
        id: 2,
        name: 'Draft Only Author',
        _status: 'draft',
      })
    })
  })

  describe('polymorphic relationships (ADR 0033)', () => {
    const authorsCol: CollectionConfig = {
      slug: 'authors',
      access: { read: () => true },
      fields: { name: { type: 'text', required: true } },
    }
    const editorsCol: CollectionConfig = {
      slug: 'editors',
      access: { read: () => true },
      fields: {
        name: { type: 'text', required: true },
        mentor: { type: 'relationship', relationTo: ['authors', 'editors'] },
      },
    }
    const secretCol: CollectionConfig = {
      slug: 'secrets',
      access: { read: () => false },
      fields: { label: { type: 'text' } },
    }
    const activitiesCol: CollectionConfig = {
      slug: 'activities',
      access: { read: () => true },
      fields: {
        owner: { type: 'relationship', relationTo: ['authors', 'editors', 'secrets'] },
        related: {
          type: 'relationship',
          relationTo: ['authors', 'editors', 'secrets'],
          hasMany: true,
        },
        items: {
          type: 'array',
          fields: {
            target: { type: 'relationship', relationTo: ['authors', 'editors'] },
          },
        },
      },
    }

    const now = '2026-01-01T00:00:00.000Z'
    const authorsDocs: StoredDoc[] = [
      { id: 1, name: 'Alice', createdAt: now, updatedAt: now },
      { id: 2, name: 'Bob', createdAt: now, updatedAt: now },
    ]
    const editorsDocs: StoredDoc[] = [
      {
        id: 10,
        name: 'Carol',
        mentor: { relationTo: 'authors', value: 2 },
        createdAt: now,
        updatedAt: now,
      },
    ]

    it('batches queries per target collection and preserves mixed order at depth 1 and 2', async () => {
      const db = createMockAdapter({
        authors: authorsDocs,
        editors: editorsDocs,
        secrets: [{ id: 99, label: 'Hidden', createdAt: now, updatedAt: now }],
      })
      const findSpy = vi.spyOn(db, 'find')

      const result = await populateDocs({
        docs: [
          {
            id: 100,
            owner: { relationTo: 'editors', value: 10 },
            related: [
              { relationTo: 'authors', value: 1 },
              { relationTo: 'editors', value: 10 },
              { relationTo: 'authors', value: 2 },
            ],
            items: [{ id: 'r1', target: { relationTo: 'authors', value: 1 } }],
          },
        ],
        collection: activitiesCol,
        depth: 2,
        collections: [activitiesCol, authorsCol, editorsCol, secretCol],
        db,
      })

      // 1 query for authors ([1, 2]) + 1 query for editors ([10]) at depth 1,
      // plus 1 query for authors ([2]) when populating editor.mentor at depth 2.
      expect(findSpy).toHaveBeenCalledTimes(3)
      expect(result[0]?.owner).toEqual({
        relationTo: 'editors',
        value: {
          id: 10,
          name: 'Carol',
          mentor: { relationTo: 'authors', value: authorsDocs[1] },
          createdAt: now,
          updatedAt: now,
        },
      })
      expect(result[0]?.related).toEqual([
        { relationTo: 'authors', value: authorsDocs[0] },
        {
          relationTo: 'editors',
          value: {
            id: 10,
            name: 'Carol',
            mentor: { relationTo: 'authors', value: authorsDocs[1] },
            createdAt: now,
            updatedAt: now,
          },
        },
        { relationTo: 'authors', value: authorsDocs[1] },
      ])
      expect(result[0]?.items).toEqual([
        { id: 'r1', target: { relationTo: 'authors', value: authorsDocs[0] } },
      ])
    })

    it('handles missing targets and denied collections safely', async () => {
      const db = createMockAdapter({
        authors: authorsDocs,
        editors: editorsDocs,
        secrets: [{ id: 99, label: 'Hidden', createdAt: now, updatedAt: now }],
      })

      const result = await populateDocs({
        docs: [
          {
            id: 101,
            owner: { relationTo: 'authors', value: 999 },
            related: [
              { relationTo: 'authors', value: 1 },
              { relationTo: 'authors', value: 999 },
              { relationTo: 'secrets', value: 99 },
            ],
          },
        ],
        collection: activitiesCol,
        depth: 1,
        collections: [activitiesCol, authorsCol, editorsCol, secretCol],
        db,
      })

      expect(result[0]?.owner).toEqual({ relationTo: 'authors', value: null })
      expect(result[0]?.related).toEqual([
        { relationTo: 'authors', value: authorsDocs[0] },
        { relationTo: 'secrets', value: 99 },
      ])
    })

    it('terminates circular polymorphic references at depth', async () => {
      const db = createMockAdapter({
        authors: authorsDocs,
        editors: [
          {
            id: 10,
            name: 'Carol',
            mentor: { relationTo: 'editors', value: 10 },
            createdAt: now,
            updatedAt: now,
          },
        ],
      })

      const result = await populateDocs({
        docs: [
          {
            id: 10,
            name: 'Carol',
            mentor: { relationTo: 'editors', value: 10 },
          },
        ],
        collection: editorsCol,
        depth: 3,
        collections: [editorsCol, authorsCol],
        db,
      })

      const populatedMentor = result[0]?.mentor as { relationTo: string; value: DocumentData }
      expect(populatedMentor.relationTo).toBe('editors')
      expect(populatedMentor.value.name).toBe('Carol')
      expect(populatedMentor.value.mentor).toEqual({ relationTo: 'editors', value: 10 })
    })
  })

  describe('join fields (ADR 0033)', () => {
    const now = '2026-01-01T00:00:00.000Z'

    it('populates counts only at depth 0 and full limited docs at depth >= 1', async () => {
      const authorsCol: CollectionConfig = {
        slug: 'authors',
        access: { read: () => true },
        fields: {
          name: { type: 'text', required: true },
          posts: { type: 'join', collection: 'posts', on: 'author', limit: 2, sort: '-id' },
        },
      }
      const postsCol: CollectionConfig = {
        slug: 'posts',
        versions: { drafts: true },
        access: { read: () => true },
        fields: {
          title: { type: 'text', required: true },
          author: { type: 'relationship', relationTo: 'authors' },
        },
      }
      const mockPosts: StoredDoc[] = [
        { id: 1, title: 'P1', author: 10, _status: 'published', createdAt: now, updatedAt: now },
        { id: 2, title: 'P2', author: 10, _status: 'published', createdAt: now, updatedAt: now },
        { id: 3, title: 'P3', author: 10, _status: 'published', createdAt: now, updatedAt: now },
        { id: 4, title: 'Draft', author: 10, _status: 'draft', createdAt: now, updatedAt: now },
        { id: 5, title: 'Other', author: 20, _status: 'published', createdAt: now, updatedAt: now },
      ]

      const db = createMockAdapter({ posts: mockPosts })
      const findJoinedSpy = vi.fn<NonNullable<DatabaseAdapter['findJoined']>>(
        ({ parentIds, includeDocs, limit, where }) => {
          const publishedOnly = checkPublishedFilter(where)
          const map = new Map<number, { docs: StoredDoc[]; totalDocs: number }>()
          for (const pid of parentIds) {
            const matching = mockPosts
              .filter((p) => p.author === pid && (!publishedOnly || p._status === 'published'))
              .sort((a, b) => b.id - a.id)
            map.set(pid, {
              docs: includeDocs ? matching.slice(0, limit).map((d) => ({ ...d })) : [],
              totalDocs: matching.length,
            })
          }
          return Promise.resolve(map)
        },
      )
      db.findJoined = findJoinedSpy

      // Depth 0: counts only, docs empty, draft excluded
      const atZero = await populateDocs({
        docs: [
          { id: 10, name: 'Alice', createdAt: now, updatedAt: now },
          { id: 20, name: 'Bob', createdAt: now, updatedAt: now },
        ],
        collection: authorsCol,
        depth: 0,
        collections: [authorsCol, postsCol],
        db,
      })
      expect(findJoinedSpy).toHaveBeenCalledTimes(1)
      expect(atZero[0]?.posts).toEqual({ docs: [], totalDocs: 3 })
      expect(atZero[1]?.posts).toEqual({ docs: [], totalDocs: 1 })

      // Depth 1: up to limit (2), drafts still excluded
      const atOne = await populateDocs({
        docs: [
          { id: 10, name: 'Alice', createdAt: now, updatedAt: now },
          { id: 20, name: 'Bob', createdAt: now, updatedAt: now },
        ],
        collection: authorsCol,
        depth: 1,
        collections: [authorsCol, postsCol],
        db,
      })
      expect(findJoinedSpy).toHaveBeenCalledTimes(2)
      const alicePosts = atOne[0]?.posts as { docs: StoredDoc[]; totalDocs: number }
      expect(alicePosts.totalDocs).toBe(3)
      expect(alicePosts.docs.map((d) => d.id)).toEqual([3, 2])
    })

    it('enforces target read access, field-level read access, and terminates cycles at depth', async () => {
      const authorsCol: CollectionConfig = {
        slug: 'authors',
        access: { read: () => true },
        fields: {
          name: { type: 'text', required: true },
          posts: { type: 'join', collection: 'posts', on: 'author' },
          secretPosts: {
            type: 'join',
            collection: 'posts',
            on: 'author',
            access: { read: ({ user }) => user?.role === 'admin' },
          },
        },
      }
      const postsCol: CollectionConfig = {
        slug: 'posts',
        access: { read: () => true },
        fields: {
          title: { type: 'text', required: true },
          secretNote: { type: 'text', access: { read: () => false } },
          author: { type: 'relationship', relationTo: 'authors' },
        },
      }
      const db = createMockAdapter({
        authors: [{ id: 1, name: 'Alice', createdAt: now, updatedAt: now }],
        posts: [
          {
            id: 10,
            title: 'Post 10',
            secretNote: 'classified',
            author: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      })
      const findJoinedSpy = vi.fn<NonNullable<DatabaseAdapter['findJoined']>>(
        ({ parentIds, includeDocs }) => {
          const map = new Map<number, { docs: StoredDoc[]; totalDocs: number }>()
          for (const pid of parentIds) {
            map.set(pid, {
              docs: includeDocs
                ? [
                    {
                      id: 10,
                      title: 'Post 10',
                      secretNote: 'classified',
                      author: 1,
                      createdAt: now,
                      updatedAt: now,
                    },
                  ]
                : [],
              totalDocs: 1,
            })
          }
          return Promise.resolve(map)
        },
      )
      db.findJoined = findJoinedSpy

      const res = await populateDocs({
        docs: [{ id: 1, name: 'Alice', createdAt: now, updatedAt: now }],
        collection: authorsCol,
        depth: 3,
        collections: [authorsCol, postsCol],
        db,
        user: {
          id: 'u1',
          email: 'u1@example.com',
          name: 'User One',
          emailVerified: true,
          role: 'editor',
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      })

      // secretPosts denied for editor -> never queried
      expect(findJoinedSpy).toHaveBeenCalledTimes(1)
      expect(res[0]?.secretPosts).toBeUndefined()
      const postsRes = res[0]?.posts as { docs: DocumentData[]; totalDocs: number }
      expect(postsRes.totalDocs).toBe(1)
      expect(postsRes.docs[0]?.secretNote).toBeUndefined()
      // Cycle terminates: post.author remains id 1 because authors:1 is already in seen
      expect(postsRes.docs[0]?.author).toBe(1)
    })

    it('returns empty join result when target collection read access is denied', async () => {
      const authorsCol: CollectionConfig = {
        slug: 'authors',
        access: { read: () => true },
        fields: {
          name: { type: 'text' },
          posts: { type: 'join', collection: 'posts', on: 'author' },
        },
      }
      const postsCol: CollectionConfig = {
        slug: 'posts',
        access: { read: () => false },
        fields: {
          title: { type: 'text' },
          author: { type: 'relationship', relationTo: 'authors' },
        },
      }
      const db = createMockAdapter({ posts: [] })
      const findJoinedSpy = vi.fn<NonNullable<DatabaseAdapter['findJoined']>>()
      db.findJoined = findJoinedSpy

      const res = await populateDocs({
        docs: [{ id: 1, name: 'Alice', createdAt: now, updatedAt: now }],
        collection: authorsCol,
        depth: 1,
        collections: [authorsCol, postsCol],
        db,
      })

      expect(findJoinedSpy).not.toHaveBeenCalled()
      expect(res[0]?.posts).toEqual({ docs: [], totalDocs: 0 })
    })
  })
})
