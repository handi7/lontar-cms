import { afterEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { ConstraintAccessFunction } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import type { Where } from '../query/types'
import { populateDoc } from './index'

// #470, ADR 0030 §7: a related document outside the target collection's read constraint is treated
// as a missing one, like an unpublished target: a single relation becomes null and a hasMany drops
// it. Keeping the id would show that the document exists.
const user = { id: 'u1', role: 'author' } as never
const authors = [
  { id: 1, name: 'Ann', owner: 'u1' },
  { id: 2, name: 'Bob', owner: 'u2' },
]

function flatten(where: Where | undefined, out: Where[] = []): Where[] {
  if (!where) return out
  if (Array.isArray(where.and)) where.and.forEach((w) => flatten(w, out))
  else out.push(where)
  return out
}

function setup(read: ConstraintAccessFunction) {
  const find = vi.fn().mockImplementation(({ where }: { where?: Where }) => {
    const parts = flatten(where)
    const ids = parts.find((p) => p.id)?.id as { in: number[] } | undefined
    const owner = parts.find((p) => p.owner)?.owner as { equals: string } | undefined
    const docs = authors.filter(
      (a) => (!ids || ids.in.includes(a.id)) && (!owner || a.owner === owner.equals),
    )
    return Promise.resolve({ docs, totalDocs: docs.length, page: 1, totalPages: 1, limit: 100 })
  })
  const people = collection({
    slug: 'people',
    access: { read },
    fields: { name: f.text(), owner: f.text() },
  })
  const posts = collection({
    slug: 'posts',
    access: { read: () => true },
    fields: {
      title: f.text(),
      author: f.relationship({ relationTo: 'people' }),
      reviewers: f.relationship({ relationTo: 'people', hasMany: true }),
    },
  })
  const config = defineConfig({
    secret: 's'.repeat(24),
    db: { name: 'mock', find } as unknown as DatabaseAdapter,
    collections: [posts, people],
  })
  return { config, posts, find }
}

afterEach(() => vi.restoreAllMocks())

describe('population under a read constraint (#470)', () => {
  const own: ConstraintAccessFunction = ({ user: u }) => ({ owner: { equals: u?.id } })

  it('populates a related document inside the constraint and treats the others as missing', async () => {
    const { config, posts } = setup(own)

    const doc = await populateDoc(
      { id: 10, title: 'P', author: 2, reviewers: [1, 2] },
      {
        collection: posts,
        depth: 1,
        collections: config.collections,
        db: config.db,
        user,
      },
    )

    expect(doc.author).toBeNull()
    expect(doc.reviewers).toEqual([expect.objectContaining({ id: 1, name: 'Ann' })])
  })

  it('adds the constraint to the fetch by ids', async () => {
    const { config, posts, find } = setup(own)

    await populateDoc(
      { id: 10, title: 'P', author: 1 },
      { collection: posts, depth: 1, collections: config.collections, db: config.db, user },
    )

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ id: { in: [1] } }, { owner: { equals: 'u1' } }] },
      }),
    )
  })

  it('populates nothing from a collection whose read is false', async () => {
    const { config, posts, find } = setup(() => false)

    const doc = await populateDoc(
      { id: 10, title: 'P', author: 1 },
      { collection: posts, depth: 1, collections: config.collections, db: config.db, user },
    )

    expect(doc.author).toBe(1)
    expect(find).not.toHaveBeenCalled()
  })

  it('populates nothing when the constraint is invalid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { config, posts } = setup(() => ({ nope: { equals: 1 } }))

    const doc = await populateDoc(
      { id: 10, title: 'P', author: 1 },
      { collection: posts, depth: 1, collections: config.collections, db: config.db, user },
    )

    expect(doc.author).toBe(1)
  })

  it('applies no constraint with overrideAccess', async () => {
    const read = vi.fn(own)
    const { config, posts } = setup(read)

    const doc = await populateDoc(
      { id: 10, title: 'P', author: 2 },
      {
        collection: posts,
        depth: 1,
        collections: config.collections,
        db: config.db,
        overrideAccess: true,
      },
    )

    expect(doc.author).toEqual(expect.objectContaining({ id: 2 }))
    expect(read).not.toHaveBeenCalled()
  })
})
