import { describe, expect, it, vi } from 'vitest'
import { defineConfig, fields, type DatabaseAdapter } from '@lontar/core'
import { createRouteHandlers } from './index'

const mockFind = vi.fn().mockResolvedValue({
  docs: [{ id: 1, title: 'Hello', views: 5, createdAt: '2026-10-31T00:00:00.000Z' }],
  totalDocs: 1,
  limit: 10,
  page: 1,
  totalPages: 1,
})

const mockCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
  return Promise.resolve({
    id: 2,
    title: data.title,
    views: data.views ?? null,
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  })
})

const mockAdapter: DatabaseAdapter = {
  name: 'mock',
  find: mockFind,
  findByID: vi.fn(),
  create: mockCreate,
  update: vi.fn(),
  delete: vi.fn(),
  findGlobal: vi.fn(),
  updateGlobal: vi.fn(),
  toSchemaFile: () => '',
  migrate: vi.fn(),
}

const config = defineConfig({
  secret: 'test-secret-at-least-32-chars-long!',
  db: mockAdapter,
  collections: [
    {
      slug: 'posts',
      access: {
        read: () => true,
        create: () => true,
      },
      fields: {
        title: fields.text({ required: true }),
        views: fields.number(),
      },
    },
  ],
})

describe('createRouteHandlers', () => {
  it('returns Next.js route handlers for all standard HTTP methods', () => {
    const handlers = createRouteHandlers(config)
    expect(typeof handlers.GET).toBe('function')
    expect(typeof handlers.POST).toBe('function')
    expect(typeof handlers.PATCH).toBe('function')
    expect(typeof handlers.DELETE).toBe('function')
    expect(typeof handlers.PUT).toBe('function')
    expect(typeof handlers.OPTIONS).toBe('function')
  })

  it('handles GET requests to _lontar/config', async () => {
    const { GET } = createRouteHandlers(config)
    const req = new Request('http://localhost:3000/api/_lontar/config')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { version: number; collections: Array<{ slug: string }> }
    expect(json.version).toBe(1)
    expect(json.collections[0]?.slug).toBe('posts')
  })

  it('handles GET requests to collection routes', async () => {
    const { GET } = createRouteHandlers(config)
    const req = new Request('http://localhost:3000/api/posts')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { docs: Array<{ title: string }> }
    expect(json.docs[0]?.title).toBe('Hello')
  })

  it('handles POST requests to collection routes', async () => {
    const { POST } = createRouteHandlers(config)
    const req = new Request('http://localhost:3000/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Post', views: 42 }),
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: number; title: string }
    expect(json.id).toBe(2)
    expect(json.title).toBe('New Post')
  })
})
