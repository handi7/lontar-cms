import { describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { ValidationError } from './errors'
import {
  resolveSearchTitleField,
  searchOperation,
  SEARCH_LIMIT_PER_COLLECTION,
  SEARCH_LIMIT_TOTAL,
} from './search'

type Row = Record<string, unknown>

function containsClause(where: Row | undefined): [string, string] | undefined {
  for (const [key, value] of Object.entries(where ?? {})) {
    if (key === 'and') {
      for (const part of value as Row[]) {
        const found = containsClause(part)
        if (found) return found
      }
    } else if (value && typeof value === 'object' && 'contains' in value) {
      return [key, String(value.contains)]
    }
  }
  return undefined
}

// Applies the `contains` the way an adapter does, so the operation's own filtering is visible.
function createAdapter(rows: Record<string, Row[]>) {
  const find = vi
    .fn()
    .mockImplementation((args: { collection: { slug: string }; where?: Row; limit?: number }) => {
      const [field, text] = containsClause(args.where) ?? ['', '']
      const all = (rows[args.collection.slug] ?? []).filter((r) =>
        String(r[field]).toLowerCase().includes(text.toLowerCase()),
      )
      return Promise.resolve({
        docs: all.slice(0, args.limit ?? 100),
        totalDocs: all.length,
        page: 1,
      })
    })
  return { adapter: { name: 'mock', find } as unknown as DatabaseAdapter, find }
}

const open = { read: () => true }
const user = { id: 'u1', role: 'editor' } as never

function makeRows(prefix: string, count: number, extra: Row = {}): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `${prefix} ${i + 1}`,
    ...extra,
  }))
}

describe('searchOperation (#463)', () => {
  it('returns id, title, collection and status per hit, in config order', async () => {
    const posts = collection({
      slug: 'posts',
      access: open,
      versions: { drafts: true },
      fields: { title: f.text() },
    })
    const pages = collection({ slug: 'pages', access: open, fields: { title: f.text() } })
    const { adapter } = createAdapter({
      posts: [{ id: 7, title: 'Hello world', _status: 'published' }],
      pages: [{ id: 2, title: 'Hello page' }],
    })
    const config = defineConfig({
      secret: 's'.repeat(24),
      db: adapter,
      collections: [posts, pages],
    })

    const results = await searchOperation({ config, user, q: 'hello' })

    expect(results).toEqual([
      { id: 7, title: 'Hello world', collection: 'posts', status: 'published' },
      { id: 2, title: 'Hello page', collection: 'pages' },
    ])
  })

  it('only searches published documents of a collection with drafts', async () => {
    const posts = collection({
      slug: 'posts',
      access: open,
      versions: { drafts: true },
      fields: { title: f.text() },
    })
    const { adapter, find } = createAdapter({ posts: [] })
    const config = defineConfig({ secret: 's'.repeat(24), db: adapter, collections: [posts] })

    await searchOperation({ config, user, q: 'x' })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ title: { contains: 'x' } }, { _status: { equals: 'published' } }] },
      }),
    )
  })

  it('skips a collection the user cannot read', async () => {
    const secret = collection({
      slug: 'secrets',
      access: { read: () => false },
      fields: { title: f.text() },
    })
    const posts = collection({ slug: 'posts', access: open, fields: { title: f.text() } })
    const { adapter, find } = createAdapter({
      secrets: [{ id: 1, title: 'launch codes' }],
      posts: [{ id: 1, title: 'launch day' }],
    })
    const config = defineConfig({
      secret: 's'.repeat(24),
      db: adapter,
      collections: [secret, posts],
    })

    const results = await searchOperation({ config, user, q: 'launch' })

    expect(results.map((r) => r.collection)).toEqual(['posts'])
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('skips a collection whose title field the user cannot read', async () => {
    const people = collection({
      slug: 'people',
      access: open,
      fields: { name: f.text({ access: { read: ({ user: u }) => u?.role === 'admin' } }) },
    })
    const { adapter, find } = createAdapter({ people: [{ id: 1, name: 'Alice' }] })
    const config = defineConfig({ secret: 's'.repeat(24), db: adapter, collections: [people] })

    expect(await searchOperation({ config, user, q: 'ali' })).toEqual([])
    expect(find).not.toHaveBeenCalled()

    const admin = { id: 'a1', role: 'admin' } as never
    const results = await searchOperation({ config, user: admin, q: 'ali' })
    expect(results).toEqual([{ id: 1, title: 'Alice', collection: 'people' }])
  })

  it('passes the text to the adapter unchanged, so its escaping of % and _ applies', async () => {
    const posts = collection({ slug: 'posts', access: open, fields: { title: f.text() } })
    const { adapter, find } = createAdapter({ posts: [] })
    const config = defineConfig({ secret: 's'.repeat(24), db: adapter, collections: [posts] })

    await searchOperation({ config, user, q: '  100%_done\\ ' })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { title: { contains: '100%_done\\' } } }),
    )
  })

  it('returns nothing for an empty query and trims an overlong one', async () => {
    const posts = collection({ slug: 'posts', access: open, fields: { title: f.text() } })
    const { adapter, find } = createAdapter({ posts: [] })
    const config = defineConfig({ secret: 's'.repeat(24), db: adapter, collections: [posts] })

    expect(await searchOperation({ config, user, q: '   ' })).toEqual([])
    expect(find).not.toHaveBeenCalled()

    await searchOperation({ config, user, q: 'a'.repeat(500) })
    const where = (find.mock.calls[0]?.[0] as { where: unknown }).where as {
      title: { contains: string }
    }
    expect(where.title.contains).toHaveLength(200)
  })

  it('limits the hits per collection and in total', async () => {
    const collections = Array.from({ length: 6 }, (_, i) =>
      collection({ slug: `c${i}`, access: open, fields: { title: f.text() } }),
    )
    const { adapter, find } = createAdapter(
      Object.fromEntries(collections.map((c) => [c.slug, makeRows('doc', 30)])),
    )
    const config = defineConfig({ secret: 's'.repeat(24), db: adapter, collections })

    const results = await searchOperation({ config, user, q: 'doc' })

    expect(find.mock.calls[0]?.[0]).toMatchObject({ limit: SEARCH_LIMIT_PER_COLLECTION })
    // 6 collections x 5 hits would be 30; the total is capped, in collection order.
    expect(results).toHaveLength(SEARCH_LIMIT_TOTAL)
    expect(results.filter((r) => r.collection === 'c0')).toHaveLength(5)
    expect(results.some((r) => r.collection === 'c5')).toBe(false)
  })

  it('uses the requested locale for a localized title and rejects an unknown one', async () => {
    const posts = collection({
      slug: 'posts',
      access: open,
      fields: { title: f.text({ localized: true }) },
    })
    const { adapter, find } = createAdapter({ posts: [{ id: 1, title: 'Halo' }] })
    const config = defineConfig({
      secret: 's'.repeat(24),
      db: adapter,
      collections: [posts],
      localization: { locales: ['en', 'id'], defaultLocale: 'en' },
    })

    await searchOperation({ config, user, q: 'halo', locale: 'id' })
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ locale: 'id' }))

    await searchOperation({ config, user, q: 'halo' })
    expect(find).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'en' }))

    await expect(searchOperation({ config, user, q: 'halo', locale: 'xx' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('falls back to #id when the title is empty', async () => {
    const posts = collection({ slug: 'posts', access: open, fields: { title: f.text() } })
    const adapter = {
      name: 'mock',
      find: vi.fn().mockResolvedValue({ docs: [{ id: 4, title: null }], totalDocs: 1, page: 1 }),
    } as unknown as DatabaseAdapter
    const config = defineConfig({ secret: 's'.repeat(24), db: adapter, collections: [posts] })

    expect(await searchOperation({ config, user, q: 'x' })).toEqual([
      { id: 4, title: '#4', collection: 'posts' },
    ])
  })
})

describe('resolveSearchTitleField (#463)', () => {
  it('prefers admin.useAsTitle, then the first text-like field, then filename for uploads', () => {
    expect(
      resolveSearchTitleField(
        collection({
          slug: 'a',
          admin: { useAsTitle: 'headline' },
          fields: { title: f.text(), headline: f.text() },
        }),
      ),
    ).toBe('headline')
    expect(
      resolveSearchTitleField(
        collection({ slug: 'b', fields: { n: f.number(), title: f.text() } }),
      ),
    ).toBe('title')
    expect(resolveSearchTitleField(collection({ slug: 'c', upload: true, fields: {} }))).toBe(
      'filename',
    )
  })

  it('has none for a collection with nothing text-like to search', () => {
    expect(resolveSearchTitleField(collection({ slug: 'd', fields: { n: f.number() } }))).toBe(
      undefined,
    )
    expect(
      resolveSearchTitleField(
        collection({ slug: 'e', admin: { useAsTitle: 'n' }, fields: { n: f.number() } }),
      ),
    ).toBe(undefined)
  })
})
