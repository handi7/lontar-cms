import { afterEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { ConstraintAccessFunction } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { AccessDeniedError, NotFoundError } from './errors'
import { deleteOperation } from './delete'
import { publishOperation, unpublishOperation } from './publish'
import { assertRowAccess } from './row-access'
import { updateOperation } from './update'
import { findVersionByIDOperation, findVersionsOperation } from './versions'

const user = { id: 'u1', role: 'author' } as never
const own: ConstraintAccessFunction = ({ user: u }) => ({ author: { equals: u?.id } })
const row = { id: 3, title: 'T', author: 'u1', _status: 'draft' }

interface Setup {
  access: {
    read?: ConstraintAccessFunction
    update?: ConstraintAccessFunction
    delete?: ConstraintAccessFunction
  }
  /** What the constraint query finds. Empty means the row is outside it. */
  matches?: boolean
}

function setup({ access, matches = true }: Setup) {
  const find = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ docs: matches ? [row] : [], totalDocs: matches ? 1 : 0, page: 1 }),
    )
  const findByID = vi.fn().mockResolvedValue(row)
  const update = vi.fn().mockResolvedValue({ ...row, title: 'New' })
  const del = vi.fn().mockResolvedValue(row)
  const findVersions = vi.fn().mockResolvedValue({ docs: [], totalDocs: 0, page: 1, totalPages: 1 })
  const findVersionByID = vi.fn().mockResolvedValue({ id: 1, parentId: 3, snapshot: row })
  const posts = collection({
    slug: 'posts',
    access,
    versions: { drafts: true },
    fields: { title: f.text(), author: f.text() },
  })
  const db = {
    name: 'mock',
    find,
    findByID,
    update,
    delete: del,
    findVersions,
    findVersionByID,
  } as unknown as DatabaseAdapter
  const config = defineConfig({ secret: 's'.repeat(24), db, collections: [posts] })
  return { posts, config, find, findByID, update, del, findVersions, findVersionByID }
}

afterEach(() => vi.restoreAllMocks())

describe('assertRowAccess (#470, ADR 0030 §5 and §6)', () => {
  it('passes for a boolean without any query', async () => {
    const { posts, config, find } = setup({ access: { update: () => true } })

    await expect(
      assertRowAccess({ config, collection: posts, id: 3, user, operations: ['update'] }),
    ).resolves.toBeUndefined()
    expect(find).not.toHaveBeenCalled()
  })

  it('is access denied for false, before any query', async () => {
    const { posts, config, find } = setup({ access: { update: () => false } })

    await expect(
      assertRowAccess({ config, collection: posts, id: 3, user, operations: ['update'] }),
    ).rejects.toBeInstanceOf(AccessDeniedError)
    expect(find).not.toHaveBeenCalled()
  })

  it('is not found for a row outside the constraint, with the message of a missing id', async () => {
    const { posts, config } = setup({ access: { update: own }, matches: false })

    await expect(
      assertRowAccess({ config, collection: posts, id: 3, user, operations: ['update'] }),
    ).rejects.toThrow(new NotFoundError('Document with ID 3 not found'))
  })

  it('checks every operation, and ands their constraints', async () => {
    const { posts, config, find } = setup({
      access: { read: own, update: () => ({ title: { contains: 'T' } }) },
    })

    await assertRowAccess({
      config,
      collection: posts,
      id: 3,
      user,
      operations: ['read', 'update'],
    })

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          and: [
            { id: { equals: 3 } },
            { and: [{ author: { equals: 'u1' } }, { title: { contains: 'T' } }] },
          ],
        },
      }),
    )
  })

  it('hands the access function the same arguments as before', async () => {
    const update = vi.fn(() => true)
    const { posts, config } = setup({ access: { update } })

    await assertRowAccess({
      config,
      collection: posts,
      id: 3,
      user,
      operations: ['update'],
      data: { title: 'x' },
    })

    expect(update).toHaveBeenCalledWith({ user, id: 3, data: { title: 'x' } })
  })
})

describe('update and delete under a constraint (#470)', () => {
  it('updates a row inside the constraint', async () => {
    const { posts, config, update } = setup({ access: { update: own } })

    await updateOperation({ config, collection: posts, id: 3, data: { title: 'New' }, user })

    expect(update).toHaveBeenCalled()
  })

  it('does not touch a row outside the constraint, and says not found', async () => {
    const { posts, config, update, findByID } = setup({ access: { update: own }, matches: false })

    await expect(
      updateOperation({ config, collection: posts, id: 3, data: { title: 'New' }, user }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(update).not.toHaveBeenCalled()
    expect(findByID).not.toHaveBeenCalled()
  })

  it('does not delete a row outside the constraint', async () => {
    const { posts, config, del } = setup({ access: { delete: own }, matches: false })

    await expect(
      deleteOperation({ config, collection: posts, id: 3, user }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(del).not.toHaveBeenCalled()
  })

  it('deletes a row inside the constraint', async () => {
    const { posts, config, del } = setup({ access: { delete: own } })

    await deleteOperation({ config, collection: posts, id: 3, user })

    expect(del).toHaveBeenCalled()
  })

  it('ignores constraints, and calls no function, with overrideAccess', async () => {
    const updateFn = vi.fn(() => ({ author: { equals: 'x' } }))
    const { posts, config, update, find } = setup({ access: { update: updateFn }, matches: false })

    await updateOperation({
      config,
      collection: posts,
      id: 3,
      data: { title: 'New' },
      overrideAccess: true,
    })

    expect(updateFn).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalled()
  })
})

describe('publish and unpublish under a constraint (#470)', () => {
  it('does not publish or unpublish a row outside the update constraint', async () => {
    const { posts, config, update } = setup({ access: { update: own }, matches: false })

    await expect(
      publishOperation({ config, collection: posts, id: 3, user }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      unpublishOperation({ config, collection: posts, id: 3, user }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('version history under constraints (#470, ADR 0030 §7)', () => {
  it('lists versions only for a parent inside both constraints', async () => {
    const inside = setup({ access: { read: own, update: own } })
    await findVersionsOperation({ config: inside.config, collection: inside.posts, id: 3, user })
    expect(inside.findVersions).toHaveBeenCalled()

    const outside = setup({ access: { read: own, update: own }, matches: false })
    await expect(
      findVersionsOperation({ config: outside.config, collection: outside.posts, id: 3, user }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(outside.findVersions).not.toHaveBeenCalled()
  })

  it('reads one version only for a parent inside the constraints', async () => {
    const outside = setup({ access: { read: own, update: own }, matches: false })

    await expect(
      findVersionByIDOperation({
        config: outside.config,
        collection: outside.posts,
        id: 3,
        versionId: 1,
        user,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(outside.findVersionByID).not.toHaveBeenCalled()
  })

  it('is still access denied for false', async () => {
    const { posts, config } = setup({ access: { read: () => false, update: () => true } })

    await expect(
      findVersionsOperation({ config, collection: posts, id: 3, user }),
    ).rejects.toBeInstanceOf(AccessDeniedError)
  })
})
