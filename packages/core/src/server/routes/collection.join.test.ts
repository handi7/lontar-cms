import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { defineConfig } from '../../config/define-config'
import type {
  DatabaseAdapter,
  FindJoinedArgs,
  JoinFieldResult,
  PaginatedDocs,
  StoredDoc,
} from '../../database/adapter'
import { fields as f } from '../../fields'
import type { Where } from '../../query/types'
import { createLontar } from '../create-lontar'
import { createLontarClient } from '../../local'

function matchesFieldCond(docVal: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) return true
  const c = cond as Record<string, unknown>
  if ('equals' in c && docVal !== c.equals) return false
  if ('in' in c && Array.isArray(c.in) && !c.in.includes(docVal)) return false
  return true
}

function matchesSimpleWhere(doc: StoredDoc, where?: Where): boolean {
  if (!where) return true
  if (Array.isArray(where.and)) {
    return where.and.every((sub) => matchesSimpleWhere(doc, sub))
  }
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'and' || key === 'or') return true
    return matchesFieldCond(doc[key], cond)
  })
}

function createJoinMockAdapter(store: Record<string, StoredDoc[]>): DatabaseAdapter {
  return {
    name: 'mock',
    find({ collection: col, where, limit }): Promise<PaginatedDocs> {
      const all = (store[col.slug] ?? []).map((d) => ({ ...d }))
      const filtered = all.filter((d) => matchesSimpleWhere(d, where))
      const docs = limit > 0 ? filtered.slice(0, limit) : filtered
      return Promise.resolve({
        docs,
        totalDocs: filtered.length,
        limit,
        page: 1,
        totalPages: 1,
      })
    },
    findJoined(args: FindJoinedArgs): Promise<Map<number, JoinFieldResult>> {
      const all = (store[args.collection.slug] ?? []).map((d) => ({ ...d }))
      const filtered = all.filter((d) => matchesSimpleWhere(d, args.where))
      const sorted = [...filtered].sort((a, b) => b.id - a.id)
      const map = new Map<number, JoinFieldResult>()
      for (const pid of args.parentIds) {
        const matched = sorted.filter((d) => {
          const val = d[args.on]
          if (typeof val === 'number') return val === pid
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            const ref = val as { relationTo?: string; value?: number }
            return ref.relationTo === args.sourceCollection && ref.value === pid
          }
          return false
        })
        map.set(pid, {
          docs: args.includeDocs ? matched.slice(0, args.limit).map((d) => ({ ...d })) : [],
          totalDocs: matched.length,
        })
      }
      return Promise.resolve(map)
    },
    findByID({ collection: col, id }): Promise<StoredDoc | null> {
      const found = (store[col.slug] ?? []).find((d) => d.id === id)
      return Promise.resolve(found ? { ...found } : null)
    },
    create({ collection: col, data }): Promise<StoredDoc> {
      const items = store[col.slug] ?? []
      const created: StoredDoc = {
        id: items.length + 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...data,
      }
      items.push(created)
      return Promise.resolve({ ...created })
    },
    update({ collection: col, id, data }): Promise<StoredDoc | null> {
      const items = store[col.slug] ?? []
      const idx = items.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const updated: StoredDoc = {
        ...items[idx]!,
        ...data,
        updatedAt: '2026-01-02T00:00:00.000Z',
      }
      items[idx] = updated
      return Promise.resolve({ ...updated })
    },
    delete({ collection: col, id }): Promise<StoredDoc | null> {
      const items = store[col.slug] ?? []
      const idx = items.findIndex((d) => d.id === id)
      if (idx === -1) return Promise.resolve(null)
      const [removed] = items.splice(idx, 1)
      return Promise.resolve(removed ?? null)
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

describe('REST and Local API join fields (ADR 0033)', () => {
  const now = '2026-01-01T00:00:00.000Z'

  function createSetup() {
    const authors = collection({
      slug: 'authors',
      access: { read: () => true, create: () => true, update: () => true },
      fields: {
        name: f.text({ required: true }),
        posts: f.join({ collection: 'posts', on: 'author', limit: 2, sort: '-id' }),
      },
    })
    const posts = collection({
      slug: 'posts',
      versions: { drafts: true },
      access: {
        read: () => ({ published: { equals: true } }),
        create: () => true,
        update: () => true,
      },
      fields: {
        title: f.text({ required: true }),
        published: f.checkbox(),
        author: f.relationship({ relationTo: 'authors' }),
      },
    })

    const store: Record<string, StoredDoc[]> = {
      authors: [
        { id: 1, name: 'Alice', createdAt: now, updatedAt: now },
        { id: 2, name: 'Bob', createdAt: now, updatedAt: now },
      ],
      posts: [
        {
          id: 1,
          title: 'P1',
          published: true,
          _status: 'published',
          author: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 2,
          title: 'P2',
          published: false,
          _status: 'published',
          author: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 3,
          title: 'P3',
          published: true,
          _status: 'draft',
          author: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 4,
          title: 'P4',
          published: true,
          _status: 'published',
          author: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 5,
          title: 'P5',
          published: true,
          _status: 'published',
          author: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    const db = createJoinMockAdapter(store)
    const config = defineConfig({
      secret: 'test-secret',
      db,
      collections: [authors, posts],
    })
    return { config, db }
  }

  it('returns counts at depth 0, limited/constrained/published docs at depth 1, and batches queries', async () => {
    const { config, db } = createSetup()
    const findJoinedSpy = vi.spyOn(db, 'findJoined')
    const app = createLontar(config)

    // REST GET /api/authors?depth=0
    const res0 = await app.request('http://localhost/api/authors')
    expect(res0.status).toBe(200)
    const body0 = (await res0.json()) as { docs: StoredDoc[] }
    expect(findJoinedSpy).toHaveBeenCalledTimes(1)
    expect(body0.docs[0]?.posts).toEqual({ docs: [], totalDocs: 3 })
    expect(body0.docs[1]?.posts).toEqual({ docs: [], totalDocs: 0 })

    // REST GET /api/authors/1?depth=1
    const res1 = await app.request('http://localhost/api/authors/1?depth=1')
    expect(res1.status).toBe(200)
    const doc1 = (await res1.json()) as StoredDoc
    const postsJoin = doc1.posts as { docs: StoredDoc[]; totalDocs: number }
    expect(postsJoin.totalDocs).toBe(3)
    expect(postsJoin.docs.map((d) => d.id)).toEqual([5, 4])
  })

  it('rejects sending a value for a join field on REST POST/PATCH and Local create/update', async () => {
    const { config } = createSetup()
    const app = createLontar(config)
    const local = createLontarClient(config)

    const postRes = await app.request('http://localhost/api/authors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Carol', posts: [] }),
    })
    expect(postRes.status).toBe(400)
    const postErr = (await postRes.json()) as { message: string }
    expect(postErr.message).toContain('read-only')

    const patchRes = await app.request('http://localhost/api/authors/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: { docs: [], totalDocs: 0 } }),
    })
    expect(patchRes.status).toBe(400)

    await expect(
      local.create('authors', {
        data: { name: 'Carol', posts: [] } as never,
      }),
    ).rejects.toThrow(/Validation failed/)

    await expect(
      local.update('authors', {
        id: 1,
        data: { posts: null },
      }),
    ).rejects.toThrow(/Validation failed/)
  })

  it('rejects filtering or sorting by join fields in REST GET', async () => {
    const { config } = createSetup()
    const app = createLontar(config)

    const whereRes = await app.request('http://localhost/api/authors?where[posts][equals]=1')
    expect(whereRes.status).toBe(400)

    const sortRes = await app.request('http://localhost/api/authors?sort=posts')
    expect(sortRes.status).toBe(400)
  })
})
