import { afterEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { ConstraintAccessFunction } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { AccessDeniedError } from './errors'
import { findOperation } from './find'
import { findByIDOperation } from './find-by-id'

const user = { id: 'u1', role: 'author' } as never
const own = ({ user: u }: { user: { id?: string } | null }) => ({ author: { equals: u?.id } })

function setup(
  access: { read?: ConstraintAccessFunction; update?: ConstraintAccessFunction },
  options: { drafts?: boolean } = {},
) {
  const find = vi.fn().mockResolvedValue({ docs: [], totalDocs: 0, page: 1, totalPages: 1 })
  const findByID = vi.fn().mockResolvedValue({ id: 3, title: 'T', author: 'u1' })
  const posts = collection({
    slug: 'posts',
    access,
    versions: options.drafts ? { drafts: true } : undefined,
    fields: { title: f.text(), author: f.text() },
  })
  const config = defineConfig({
    secret: 's'.repeat(24),
    db: { name: 'mock', find, findByID } as unknown as DatabaseAdapter,
    collections: [posts],
  })
  return { posts, config, find, findByID }
}

afterEach(() => vi.restoreAllMocks())

describe('find with a read constraint (#470)', () => {
  it('limits the query to the constraint', async () => {
    const { posts, config, find } = setup({ read: own })

    await findOperation({ config, collection: posts, user })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { author: { equals: 'u1' } } }),
    )
  })

  it('ands the constraint with the request filter, outside it', async () => {
    const { posts, config, find } = setup({ read: own })
    const requestWhere = {
      or: [{ author: { equals: 'someone-else' } }, { title: { contains: 'x' } }],
    }

    await findOperation({ config, collection: posts, user, where: requestWhere })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [requestWhere, { author: { equals: 'u1' } }] },
      }),
    )
  })

  it('composes with the published filter of a collection with drafts', async () => {
    const { posts, config, find } = setup({ read: own }, { drafts: true })

    await findOperation({ config, collection: posts, user })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ _status: { equals: 'published' } }, { author: { equals: 'u1' } }] },
      }),
    )
  })

  it('needs both constraints for a draft read', async () => {
    const { posts, config, find } = setup(
      { read: own, update: () => ({ title: { contains: 'wip' } }) },
      { drafts: true },
    )

    await findOperation({ config, collection: posts, user, draft: true })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ author: { equals: 'u1' } }, { title: { contains: 'wip' } }] },
      }),
    )
  })

  it('applies no constraint, and calls no function, with overrideAccess', async () => {
    const read = vi.fn(() => ({ author: { equals: 'x' } }))
    const { posts, config, find } = setup({ read })

    await findOperation({ config, collection: posts, overrideAccess: true })

    expect(read).not.toHaveBeenCalled()
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
  })

  it('denies when the constraint is invalid, and never queries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { posts, config, find } = setup({ read: () => ({ owner: { equals: 'u1' } }) })

    await expect(findOperation({ config, collection: posts, user })).rejects.toBeInstanceOf(
      AccessDeniedError,
    )
    expect(find).not.toHaveBeenCalled()
  })

  it('still queries as before for a boolean', async () => {
    const { posts, config, find } = setup({ read: () => true })

    await findOperation({ config, collection: posts, user, where: { title: { equals: 'a' } } })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { title: { equals: 'a' } } }),
    )
  })
})

describe('findByID with a read constraint (#470, ADR 0030 §5 and §6)', () => {
  it('reads the document with the constraint, in one query', async () => {
    const { posts, config, find, findByID } = setup({ read: own })
    find.mockResolvedValue({ docs: [{ id: 3, title: 'T', author: 'u1' }], totalDocs: 1 })

    const doc = await findByIDOperation({ config, collection: posts, id: 3, user })

    expect(doc).toMatchObject({ id: 3 })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ id: { equals: 3 } }, { author: { equals: 'u1' } }] },
        limit: 1,
      }),
    )
    expect(findByID).not.toHaveBeenCalled()
  })

  it('returns null, as for a missing document, when the row is outside the constraint', async () => {
    const { posts, config, find, findByID } = setup({ read: own })
    find.mockResolvedValue({ docs: [], totalDocs: 0 })
    const outside = await findByIDOperation({ config, collection: posts, id: 3, user })

    findByID.mockResolvedValue(null)
    const { posts: p2, config: c2 } = setup({ read: () => true })
    const missing = await findByIDOperation({
      config: { ...c2, db: { name: 'mock', findByID } as unknown as DatabaseAdapter },
      collection: p2,
      id: 99,
      user,
    })

    expect(outside).toBeNull()
    expect(missing).toBeNull()
  })

  it('reads by id as before for a boolean', async () => {
    const { posts, config, find, findByID } = setup({ read: () => true })

    await findByIDOperation({ config, collection: posts, id: 3, user })

    expect(findByID).toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
  })

  it('stays denied (not found) with false', async () => {
    const { posts, config } = setup({ read: () => false })

    await expect(
      findByIDOperation({ config, collection: posts, id: 3, user }),
    ).rejects.toBeInstanceOf(AccessDeniedError)
  })
})
