import { afterEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { AccessFunction, ConstraintAccessFunction } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { checkAccess } from './index'
import {
  combineWhere,
  constraintOf,
  findConstrained,
  matchesConstraint,
  resolveAccess,
} from './constraint'

function setup(read?: ConstraintAccessFunction, find = vi.fn(), findByID = vi.fn()) {
  const posts = collection({
    slug: 'posts',
    access: read ? { read } : undefined,
    fields: {
      title: f.text(),
      author: f.text(),
      seo: f.group({ fields: { keywords: f.text() } }),
    },
  })
  const config = defineConfig({
    secret: 's'.repeat(24),
    db: { name: 'mock', find, findByID } as unknown as DatabaseAdapter,
    collections: [posts],
  })
  return { posts, config, find, findByID }
}

const user = { id: 'u1', role: 'author' } as never

afterEach(() => vi.restoreAllMocks())

describe('resolveAccess (#470, ADR 0030)', () => {
  it('reads a boolean as before', async () => {
    const yes = setup(() => true)
    expect(await resolveAccess(yes.posts, 'read', { user }, yes.config)).toEqual({ allowed: true })
    const no = setup(() => false)
    expect(await resolveAccess(no.posts, 'read', { user }, no.config)).toEqual({ allowed: false })
  })

  it('falls back to requiring a user when the operation has no function', async () => {
    const { posts, config } = setup()
    expect(await resolveAccess(posts, 'read', { user }, config)).toEqual({ allowed: true })
    expect(await resolveAccess(posts, 'read', { user: null }, config)).toEqual({ allowed: false })
  })

  it('returns a valid constraint, computed for this caller', async () => {
    const { posts, config } = setup(({ user: u }) => ({ author: { equals: u?.id } }))
    expect(await resolveAccess(posts, 'read', { user }, config)).toEqual({
      allowed: true,
      constraint: { author: { equals: 'u1' } },
    })
  })

  it('accepts nested paths and logical groups', async () => {
    const { posts, config } = setup(() => ({
      or: [{ 'seo.keywords': { contains: 'a' } }, { author: { equals: 'x' } }],
    }))
    expect((await resolveAccess(posts, 'read', { user }, config)).allowed).toBe(true)
  })

  it('denies an empty constraint, however it is spelled', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const empty of [{}, { and: [] }, { or: [] }, { and: [{ or: [] }] }]) {
      const { posts, config } = setup(() => empty)
      expect(await resolveAccess(posts, 'read', { user }, config)).toEqual({ allowed: false })
    }
  })

  it('denies a constraint that names an unknown field', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { posts, config } = setup(() => ({ owner: { equals: 'u1' } }))

    expect(await resolveAccess(posts, 'read', { user }, config)).toEqual({ allowed: false })
    expect(warn.mock.calls[0]?.[0]).toContain('Unknown field "owner"')
  })

  it('does not apply field read access to the constraint', async () => {
    const posts = collection({
      slug: 'posts',
      access: { read: () => ({ owner: { equals: 'u1' } }) },
      fields: { title: f.text(), owner: f.text({ access: { read: () => false } }) },
    })
    const config = defineConfig({
      secret: 's'.repeat(24),
      db: { name: 'mock' } as unknown as DatabaseAdapter,
      collections: [posts],
    })

    expect((await resolveAccess(posts, 'read', { user }, config)).allowed).toBe(true)
  })

  it('denies a function that throws or rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const thrower = setup(() => {
      throw new Error('boom')
    })
    expect(await resolveAccess(thrower.posts, 'read', { user }, thrower.config)).toEqual({
      allowed: false,
    })
    const rejecter = setup(() => Promise.reject(new Error('boom')))
    expect(await resolveAccess(rejecter.posts, 'read', { user }, rejecter.config)).toEqual({
      allowed: false,
    })
  })

  it('denies a result that is neither a boolean nor a plain object', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const odd of [user, 1, 'yes', [{ author: { equals: 'x' } }], new Date(), null]) {
      const { posts, config } = setup((() => odd) as unknown as ConstraintAccessFunction)
      expect(await resolveAccess(posts, 'read', { user }, config)).toEqual({ allowed: false })
    }
  })
})

describe('checkAccess with a non-boolean result (#470)', () => {
  it('denies an object instead of reading it as truthy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const returnsObject = (() => ({ author: { equals: 'x' } })) as unknown as AccessFunction

    expect(await checkAccess(returnsObject, { user })).toBe(false)
    expect(await checkAccess(() => true, { user })).toBe(true)
    expect(await checkAccess(() => Promise.resolve(false), { user })).toBe(false)
  })
})

describe('combining constraints (#470)', () => {
  it('ands the parts that are present', () => {
    const a = { a: { equals: 1 } }
    const b = { b: { equals: 2 } }
    expect(combineWhere()).toBeUndefined()
    expect(combineWhere(undefined, a)).toBe(a)
    expect(combineWhere(a, undefined, b)).toEqual({ and: [a, b] })
  })

  it('takes the constraints of every decision', () => {
    const a = { a: { equals: 1 } }
    expect(constraintOf({ allowed: true }, { allowed: true, constraint: a })).toBe(a)
    expect(constraintOf({ allowed: true })).toBeUndefined()
  })
})

describe('findConstrained (#470, ADR 0030 §5)', () => {
  it('reads by id when there is no constraint', async () => {
    const { posts, config, find, findByID } = setup()
    findByID.mockResolvedValue({ id: 3 })

    expect(
      await findConstrained({ config, collection: posts, id: 3, constraint: undefined }),
    ).toEqual({
      id: 3,
    })
    expect(find).not.toHaveBeenCalled()
  })

  it('queries by id and constraint, so it means what it means in a list', async () => {
    const { posts, config, find } = setup()
    find.mockResolvedValue({ docs: [{ id: 3 }], totalDocs: 1 })
    const constraint = { author: { equals: 'u1' } }

    const doc = await findConstrained({
      config,
      collection: posts,
      id: 3,
      constraint,
      locale: 'en',
    })

    expect(doc).toEqual({ id: 3 })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ id: { equals: 3 } }, constraint] },
        limit: 1,
        locale: 'en',
      }),
    )
  })

  it('returns null for a document outside the constraint', async () => {
    const { posts, config, find } = setup()
    find.mockResolvedValue({ docs: [], totalDocs: 0 })

    expect(
      await matchesConstraint({
        config,
        collection: posts,
        id: 3,
        constraint: { author: { equals: 'u1' } },
      }),
    ).toBe(false)
  })
})
