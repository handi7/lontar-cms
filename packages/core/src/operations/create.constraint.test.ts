import { afterEach, describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { ConstraintAccessFunction } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'
import { createOperation } from './create'

const populateDoc = vi.hoisted(() => vi.fn())
vi.mock('../populate', () => ({ populateDoc }))

const user = { id: 'u1', role: 'author' } as never
const own = ({ user: u }: { user: { id?: string } | null }) => ({ author: { equals: u?.id } })

function setup(update: ConstraintAccessFunction, stored: { author: string }) {
  const create = vi.fn().mockResolvedValue({ id: 3, title: 'T', _status: 'draft', ...stored })
  const find = vi.fn().mockImplementation(({ where }: { where: unknown }) => {
    // The stored document satisfies the constraint only when its author is `u1`.
    const matches = JSON.stringify(where).includes(`"equals":"${stored.author}"`)
    return Promise.resolve({
      docs: matches ? [{ id: 3 }] : [],
      totalDocs: matches ? 1 : 0,
      page: 1,
      totalPages: 1,
    })
  })
  const posts = collection({
    slug: 'posts',
    access: { create: () => true, update },
    versions: { drafts: true },
    fields: { title: f.text(), author: f.text() },
  })
  const config = defineConfig({
    secret: 's'.repeat(24),
    db: { name: 'mock', create, find } as unknown as DatabaseAdapter,
    collections: [posts],
  })
  return { posts, config }
}

async function createDraft(update: ConstraintAccessFunction, stored: { author: string }) {
  const { posts, config } = setup(update, stored)
  populateDoc.mockReset()
  populateDoc.mockImplementation((doc: unknown) => Promise.resolve(doc))
  await createOperation({
    config,
    collection: posts,
    data: { title: 'T', author: stored.author },
    draft: true,
    depth: 1,
    user,
    overrideAccess: false,
  })
  return populateDoc.mock.calls[0]?.[1] as { draft: boolean }
}

afterEach(() => {
  populateDoc.mockReset()
  vi.restoreAllMocks()
})

describe('create draft populate with an update constraint (#470)', () => {
  it('populates drafts when the new document satisfies the update constraint', async () => {
    const options = await createDraft(own, { author: 'u1' })

    expect(options.draft).toBe(true)
  })

  it('does not populate drafts when the new document is outside the update constraint', async () => {
    const options = await createDraft(own, { author: 'someone-else' })

    expect(options.draft).toBe(false)
  })

  it('still reads a plain boolean update access', async () => {
    expect((await createDraft(() => true, { author: 'u1' })).draft).toBe(true)
    expect((await createDraft(() => false, { author: 'u1' })).draft).toBe(false)
  })
})
