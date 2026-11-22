import { describe, expect, it } from 'vitest'
import { createLontar } from '../server/create-lontar'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { collection } from './collection'
import { defineConfig, LontarConfigError } from './define-config'
import { global } from './global'
import type { Endpoint } from './types'
import {
  RESERVED_COLLECTION_FIRST_SEGMENTS,
  RESERVED_DOCUMENT_SEGMENTS,
  RESERVED_GLOBAL_SEGMENTS,
  RESERVED_ROOT_SEGMENTS,
} from './validate-endpoints'

const db = { name: 'mock' } as unknown as DatabaseAdapter

function ep(path: string, extra: Partial<Endpoint> = {}): Endpoint {
  return { name: 'e', method: 'get', path, handler: (c) => c.json({}), ...extra }
}

function issuesFor(opts: { root?: Endpoint[]; posts?: Endpoint[]; site?: Endpoint[] }): string[] {
  try {
    defineConfig({
      secret: 'test-secret-value-1234567890',
      db,
      endpoints: opts.root,
      collections: [collection({ slug: 'posts', endpoints: opts.posts, fields: { t: f.text() } })],
      globals: [global({ slug: 'site', endpoints: opts.site, fields: { n: f.text() } })],
    })
    return []
  } catch (err) {
    if (err instanceof LontarConfigError) return [...err.issues]
    throw err
  }
}

describe('endpoint validation (#464)', () => {
  it('accepts the paths from ADR 0029', () => {
    expect(
      issuesFor({
        root: [ep('/stats/pending')],
        posts: [
          ep('/:id/approve', { name: 'approve', method: 'post' }),
          ep('/export', { name: 'x' }),
        ],
        site: [ep('/refresh')],
      }),
    ).toEqual([])
  })

  it.each([
    ['/posts', 'collection "posts"'],
    ['/posts/stats', 'collection "posts"'],
    ['/auth/x', '"/auth"'],
    ['/globals/x', '"/globals"'],
    ['/_lontar/x', '"/_lontar"'],
    ['/:anything', 'parameter'],
  ])('rejects root path %s', (path, expected) => {
    const issues = issuesFor({ root: [ep(path)] })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(expected)
  })

  it.each([
    ['/file/x', '"/file"'],
    ['/42', 'number'],
    ['/:id', 'static segment'],
    ['/:id/:other', 'static segment'],
    ['/:id/versions', '/:id/versions'],
    ['/:id/publish', '/:id/publish'],
    ['/:id/unpublish', '/:id/unpublish'],
    ['/:other/x', '":id"'],
  ])('rejects collection path %s', (path, expected) => {
    const issues = issuesFor({ posts: [ep(path)] })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(expected)
  })

  it.each(['/versions', '/publish', '/unpublish'])('rejects global path %s', (path) => {
    expect(issuesFor({ site: [ep(path)] })).toHaveLength(1)
  })

  it('names the endpoint and where it is declared', () => {
    const [issue] = issuesFor({ posts: [ep('/file/x', { name: 'bad' })] })
    expect(issue).toContain('Collection "posts" endpoint "bad"')
  })

  it('rejects malformed paths, wildcards and trailing slashes', () => {
    for (const path of ['stats', '/', '/stats/', '/a/*', '/a/(.*)', '/a//b', '/a/:x{[0-9]+}']) {
      expect(issuesFor({ root: [ep(path)] }), path).not.toEqual([])
    }
  })

  it('rejects bad names, methods, handlers, access, apiKey and rateLimit', () => {
    const bad = [
      ep('/a', { name: '1x' }),
      ep('/b', { method: 'trace' as never }),
      ep('/c', { handler: undefined as never }),
      ep('/d', { access: true as never }),
      ep('/e', { apiKey: 'yes' as never }),
      ep('/f', { rateLimit: { window: 0, max: 1 } }),
      ep('/g', { rateLimit: { window: 1, max: 1.5 } }),
    ]
    const issues = issuesFor({
      root: bad.map((e, i) => ({ ...e, name: e.name === '1x' ? '1x' : `n${i}` })),
    })
    expect(issues).toHaveLength(bad.length)
  })

  it('rejects a repeated name and a repeated route in one list', () => {
    const issues = issuesFor({
      root: [ep('/a', { name: 'same' }), ep('/b', { name: 'same' }), ep('/a', { name: 'again' })],
    })
    expect(issues.some((i) => i.includes('name is used twice'))).toBe(true)
    expect(issues.some((i) => i.includes('declared twice'))).toBe(true)
  })

  it('allows the same name on different collections', () => {
    const c = (slug: string) =>
      collection({ slug, endpoints: [ep('/x', { name: 'same' })], fields: { t: f.text() } })
    expect(() =>
      defineConfig({ secret: 'test-secret-value-1234567890', db, collections: [c('a'), c('b')] }),
    ).not.toThrow()
  })
})

describe('reserved paths cover the built-in routes (#464)', () => {
  const config = defineConfig({
    secret: 'test-secret-value-1234567890',
    db,
    collections: [collection({ slug: 'posts', fields: { t: f.text() } })],
    globals: [global({ slug: 'site', fields: { n: f.text() } })],
  })
  const routes = createLontar(config, { baseURL: 'http://localhost:3000' })
    .routes.map((r) => r.path.replace(/^\/api/, ''))
    .filter((p) => p !== '' && p !== '/*')

  const segments = (p: string) => p.split('/').filter(Boolean)

  it('finds the built-in routes', () => {
    expect(routes).toContain('/:collection/:id')
    expect(routes).toContain('/globals/:slug')
    expect(routes).toContain('/_lontar/config')
  })

  it('reserves the first segment of every static root route', () => {
    for (const path of routes) {
      const [first] = segments(path)
      if (!first || first.startsWith(':')) continue
      expect(RESERVED_ROOT_SEGMENTS.has(first), path).toBe(true)
    }
  })

  it('reserves every static segment of `/:collection/...` routes a custom path could collide with', () => {
    for (const path of routes) {
      const [first, second, third] = segments(path)
      if (first !== ':collection' || second === undefined) continue
      if (second === ':id') {
        if (third !== undefined && !third.startsWith(':')) {
          expect(RESERVED_DOCUMENT_SEGMENTS.has(third), path).toBe(true)
        }
      } else if (!second.startsWith(':')) {
        expect(RESERVED_COLLECTION_FIRST_SEGMENTS.has(second), path).toBe(true)
      }
    }
  })

  it('reserves every static segment of `/globals/:slug/...` routes', () => {
    for (const path of routes) {
      const [first, second, third] = segments(path)
      if (first !== 'globals' || second !== ':slug' || third === undefined) continue
      if (!third.startsWith(':')) expect(RESERVED_GLOBAL_SEGMENTS.has(third), path).toBe(true)
    }
  })
})
