import { afterEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { ConstraintAccessFunction } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { getDocumentPermissions, getPermissions } from './permissions'

// #470, ADR 0030 §10.
const user = { id: 'u1', role: 'author' } as never
const own: ConstraintAccessFunction = ({ user: u }) => ({ author: { equals: u?.id } })

function setup(
  access: {
    read?: ConstraintAccessFunction
    update?: ConstraintAccessFunction
    delete?: ConstraintAccessFunction
  },
  matches = true,
) {
  const find = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ docs: matches ? [{ id: 3 }] : [], totalDocs: matches ? 1 : 0, page: 1 }),
    )
  const posts = collection({
    slug: 'posts',
    access: { create: () => true, ...access },
    versions: { drafts: true },
    fields: { title: f.text(), author: f.text() },
  })
  const config = defineConfig({
    secret: 's'.repeat(24),
    db: { name: 'mock', find, findGlobal: vi.fn() } as unknown as DatabaseAdapter,
    collections: [posts],
  })
  return { config, posts, find }
}

afterEach(() => vi.restoreAllMocks())

describe('collection-level permissions with constraints (#470)', () => {
  it('reports true for "some documents" and marks what is constrained, without a query', async () => {
    const { config, find } = setup({ read: own, update: own, delete: () => true })

    const { collections } = await getPermissions(config, user)

    expect(collections.posts).toMatchObject({
      read: true,
      update: true,
      delete: true,
      readVersions: true,
      constrained: { read: true, update: true },
    })
    expect(find).not.toHaveBeenCalled()
  })

  it('leaves out `constrained` when every function returns a boolean', async () => {
    const { config } = setup({ read: () => true, update: () => true, delete: () => false })

    const { collections } = await getPermissions(config, user)

    expect(collections.posts).not.toHaveProperty('constrained')
    expect(collections.posts?.delete).toBe(false)
  })

  it('reports false for an invalid constraint', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { config } = setup({ read: () => ({ nope: { equals: 1 } }) })

    const { collections } = await getPermissions(config, user)

    expect(collections.posts?.read).toBe(false)
    expect(collections.posts?.readVersions).toBe(false)
  })
})

describe('document-level permissions with constraints (#470)', () => {
  it('is exact: true for a row inside the constraint', async () => {
    const { config, posts, find } = setup({ read: own, update: own, delete: own })

    const perm = await getDocumentPermissions(posts, { config, user, id: 3, doc: { id: 3 } })

    expect(perm).toMatchObject({ read: true, update: true, delete: true, readVersions: true })
    expect(perm).not.toHaveProperty('constrained')
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ id: { equals: 3 } }, { author: { equals: 'u1' } }] },
      }),
    )
  })

  it('is false for a row outside the constraint', async () => {
    const { config, posts } = setup({ read: own, update: own, delete: own }, false)

    const perm = await getDocumentPermissions(posts, { config, user, id: 3, doc: { id: 3 } })

    expect(perm).toMatchObject({ read: false, update: false, delete: false, readVersions: false })
  })

  it('mixes a constraint on one operation with a boolean on another', async () => {
    const { config, posts } = setup({ read: () => true, update: own, delete: () => false }, false)

    const perm = await getDocumentPermissions(posts, { config, user, id: 3, doc: { id: 3 } })

    expect(perm).toMatchObject({ read: true, update: false, delete: false })
  })
})
