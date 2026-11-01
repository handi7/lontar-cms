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
    expect(f.textarea({ required: true, rows: 6, maxLength: 500 })).toStrictEqual({
      type: 'textarea',
      required: true,
      rows: 6,
      maxLength: 500,
    })
    expect(f.email({ required: true, unique: true })).toStrictEqual({
      type: 'email',
      required: true,
      unique: true,
    })
    expect(f.slug({ from: 'title', unique: true })).toStrictEqual({
      type: 'slug',
      from: 'title',
      unique: true,
    })
    expect(f.checkbox({ defaultValue: true })).toStrictEqual({
      type: 'checkbox',
      defaultValue: true,
    })
    expect(f.select({ options: ['draft', 'published'], defaultValue: 'draft' })).toStrictEqual({
      type: 'select',
      options: ['draft', 'published'],
      defaultValue: 'draft',
    })
    expect(f.date({ required: true })).toStrictEqual({
      type: 'date',
      required: true,
    })
    expect(f.richText({ required: true })).toStrictEqual({
      type: 'richText',
      required: true,
    })
    expect(f.richText({ defaultValue: { type: 'doc', content: [] } })).toStrictEqual({
      type: 'richText',
      defaultValue: { type: 'doc', content: [] },
    })
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

  it('infers checkbox, select, and date fields correctly', () => {
    const postCollection = collection({
      slug: 'posts',
      fields: {
        isFeatured: f.checkbox({ required: true }),
        archived: f.checkbox(),
        status: f.select({ options: ['draft', 'published'], required: true }),
        category: f.select({ options: ['tech', 'life'] }),
        publishedAt: f.date({ required: true }),
        scheduledFor: f.date(),
      },
    })

    docOf(postCollection).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      isFeatured: boolean
      archived: boolean | null
      status: string
      category: string | null
      publishedAt: string
      scheduledFor: string | null
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

  it('infers textarea, email, and slug fields correctly', () => {
    const articles = collection({
      slug: 'articles',
      fields: {
        title: f.text({ required: true }),
        slug: f.slug({ from: 'title', unique: true, required: true }),
        summary: f.textarea(),
        contactEmail: f.email(),
        content: f.richText({ required: true }),
        notes: f.richText(),
      },
    })

    docOf(articles).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      title: string
      slug: string
      summary: string | null
      contactEmail: string | null
      content: Record<string, unknown>
      notes: Record<string, unknown> | null
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
