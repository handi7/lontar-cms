import { describe, expect, expectTypeOf, it } from 'vitest'
import { Posts } from '../__fixtures__/posts'
import { collection } from '../config/collection'
import { fields as f } from '.'
import type { InferDoc } from './infer'
import type { Fields } from './types'

// The expectTypeOf assertions are checked by `pnpm typecheck`, not at test runtime.
const docOf = <C extends { fields: Fields }>(_collection: C) => expectTypeOf<InferDoc<C>>()

describe('fields', () => {
  it('builds plain data objects', () => {
    expect(f.text({ required: true, maxLength: 120 })).toStrictEqual({
      type: 'text',
      required: true,
      maxLength: 120,
    })
    expect(f.number()).toStrictEqual({ type: 'number' })
  })
})

describe('InferDoc', () => {
  it('types required fields as values and optional fields as nullable', () => {
    docOf(Posts).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      title: string
      views: number | null
    }>()
  })

  it('treats a field without options as optional', () => {
    const notes = collection({
      slug: 'notes',
      fields: { body: f.text(), rank: f.number({ required: true }) },
    })

    docOf(notes).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      body: string | null
      rank: number
    }>()
  })
})

describe('collection', () => {
  it('rejects admin options that name an unknown field at compile time', () => {
    collection({
      slug: 'notes',
      // @ts-expect-error `titel` is not a field of this collection
      admin: { useAsTitle: 'titel' },
      fields: { title: f.text() },
    })
  })
})
