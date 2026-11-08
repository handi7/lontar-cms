import { describe, expect, expectTypeOf, it } from 'vitest'
import { Posts } from '../__fixtures__/posts'
import { collection } from '../config/collection'
import { block, fields as f } from '.'
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
    expect(f.relationship({ relationTo: 'users', required: true })).toStrictEqual({
      type: 'relationship',
      relationTo: 'users',
      required: true,
    })
    expect(f.relationship({ relationTo: 'categories', hasMany: true })).toStrictEqual({
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
    })
    expect(f.upload({ relationTo: 'media', required: true })).toStrictEqual({
      type: 'upload',
      relationTo: 'media',
      required: true,
    })
    expect(
      f.group({
        fields: {
          metaTitle: f.text({ required: true }),
          metaDescription: f.textarea(),
        },
      }),
    ).toStrictEqual({
      type: 'group',
      fields: {
        metaTitle: { type: 'text', required: true },
        metaDescription: { type: 'textarea' },
      },
    })
    expect(
      f.array({
        minRows: 1,
        maxRows: 10,
        labels: { singular: 'Slide', plural: 'Slides' },
        admin: { description: 'Slides for slider', rowLabel: 'title' },
        fields: {
          title: f.text({ required: true }),
          caption: f.text(),
        },
      }),
    ).toStrictEqual({
      type: 'array',
      minRows: 1,
      maxRows: 10,
      labels: { singular: 'Slide', plural: 'Slides' },
      admin: { description: 'Slides for slider', rowLabel: 'title' },
      fields: {
        title: { type: 'text', required: true },
        caption: { type: 'text' },
      },
    })
  })

  it('throws when array field has invalid options', () => {
    // @ts-expect-error missing fields
    expect(() => f.array({})).toThrow('fields')
    expect(() => f.array({ fields: { id: f.text() } })).toThrow('reserved name "id"')
    expect(() => f.array({ fields: { title: f.text() }, minRows: -1 })).toThrow('minRows')
    expect(() => f.array({ fields: { title: f.text() }, maxRows: 0 })).toThrow('maxRows')
    expect(() => f.array({ fields: { title: f.text() }, maxRows: 501 })).toThrow('500')
    expect(() => f.array({ fields: { title: f.text() }, minRows: 5, maxRows: 2 })).toThrow(
      'cannot be greater than maxRows',
    )
  })

  it('builds block and blocks field objects', () => {
    const hero = block({
      slug: 'hero',
      labels: { singular: 'Hero', plural: 'Heroes' },
      fields: { heading: f.text({ required: true }) },
    })
    expect(hero).toStrictEqual({
      slug: 'hero',
      labels: { singular: 'Hero', plural: 'Heroes' },
      fields: { heading: { type: 'text', required: true } },
    })

    const layout = f.blocks({
      label: 'Page Layout',
      required: true,
      minRows: 1,
      maxRows: 10,
      blocks: [hero],
    })
    expect(layout).toStrictEqual({
      type: 'blocks',
      label: 'Page Layout',
      required: true,
      minRows: 1,
      maxRows: 10,
      blocks: [hero],
    })
  })

  it('throws when block has invalid options or reserved field names', () => {
    // @ts-expect-error missing config
    expect(() => block(null)).toThrow('configuration object')
    // @ts-expect-error missing slug
    expect(() => block({})).toThrow('slug')
    // @ts-expect-error missing fields
    expect(() => block({ slug: 'hero' })).toThrow('fields')
    expect(() => block({ slug: 'hero', fields: { id: f.text() } })).toThrow('reserved name "id"')
    expect(() => block({ slug: 'hero', fields: { blockType: f.text() } })).toThrow(
      'reserved name "blockType"',
    )
  })

  it('throws when blocks field has invalid options', () => {
    // @ts-expect-error missing options
    expect(() => f.blocks(null)).toThrow('options object')
    // @ts-expect-error missing blocks
    expect(() => f.blocks({})).toThrow('blocks')
    expect(() => f.blocks({ blocks: [] })).toThrow('non-empty')
    const hero = block({ slug: 'hero', fields: { heading: f.text() } })
    const heroDuplicate = block({ slug: 'hero', fields: { title: f.text() } })
    expect(() => f.blocks({ blocks: [hero, heroDuplicate] })).toThrow('Duplicate block slug')
    expect(() => f.blocks({ blocks: [hero], minRows: -1 })).toThrow('minRows')
    expect(() => f.blocks({ blocks: [hero], maxRows: 0 })).toThrow('maxRows')
    expect(() => f.blocks({ blocks: [hero], maxRows: 501 })).toThrow('500')
    expect(() => f.blocks({ blocks: [hero], minRows: 4, maxRows: 2 })).toThrow(
      'cannot be greater than maxRows',
    )
  })

  it('throws when group field has no fields object', () => {
    // @ts-expect-error missing fields
    expect(() => f.group({})).toThrow('fields')
  })

  it('throws when relationship field has no relationTo', () => {
    // @ts-expect-error missing relationTo
    expect(() => f.relationship({})).toThrow('relationTo')
  })

  it('throws when upload field has no relationTo', () => {
    // @ts-expect-error missing relationTo
    expect(() => f.upload({})).toThrow('relationTo')
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
        author: f.relationship({ relationTo: 'users', required: true }),
        reviewer: f.relationship({ relationTo: 'users' }),
        categories: f.relationship({ relationTo: 'categories', hasMany: true }),
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
      author: number
      reviewer: number | null
      categories: number[]
    }>()
  })

  it('infers upload fields and media collections correctly', () => {
    const media = collection({
      slug: 'media',
      upload: true,
      fields: {
        alt: f.text({ required: true }),
        caption: f.text(),
      },
    })

    const attachments = collection({
      slug: 'attachments',
      fields: {
        featuredImage: f.upload({ relationTo: 'media', required: true }),
        thumbnail: f.upload({ relationTo: 'media' }),
      },
    })

    docOf(media).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      filename: string
      url: string
      mimeType: string
      filesize: number
      width?: number | null
      height?: number | null
      sizes?: Record<string, unknown> | null
      alt: string
      caption: string | null
    }>()

    docOf(attachments).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      featuredImage: number
      thumbnail: number | null
    }>()
  })

  it('infers nested group fields correctly', () => {
    const pages = collection({
      slug: 'pages',
      fields: {
        title: f.text({ required: true }),
        seo: f.group({
          fields: {
            metaTitle: f.text({ required: true }),
            metaDescription: f.textarea(),
          },
        }),
        header: f.group({
          required: true,
          fields: {
            bannerText: f.text({ required: true }),
          },
        }),
      },
    })

    docOf(pages).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      title: string
      seo: {
        metaTitle: string
        metaDescription: string | null
      } | null
      header: {
        bannerText: string
      }
    }>()
  })

  it('infers array fields correctly with row id', () => {
    const portfolio = collection({
      slug: 'portfolio',
      fields: {
        title: f.text({ required: true }),
        gallery: f.array({
          fields: {
            caption: f.text(),
            image: f.number({ required: true }),
          },
        }),
        tags: f.array({
          required: true,
          fields: {
            name: f.text({ required: true }),
          },
        }),
      },
    })

    docOf(portfolio).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      title: string
      gallery:
        | {
            id: string
            caption: string | null
            image: number
          }[]
        | null
      tags: {
        id: string
        name: string
      }[]
    }>()
  })

  it('infers blocks fields as a discriminated union on blockType with stable id', () => {
    const Hero = block({
      slug: 'hero',
      fields: {
        heading: f.text({ required: true }),
        subheading: f.text(),
      },
    })

    const RichContent = block({
      slug: 'richContent',
      fields: {
        body: f.richText({ required: true }),
      },
    })

    const pages = collection({
      slug: 'pages',
      fields: {
        title: f.text({ required: true }),
        layout: f.blocks({
          required: true,
          blocks: [Hero, RichContent],
        }),
        optionalLayout: f.blocks({
          blocks: [Hero],
        }),
      },
    })

    docOf(pages).toEqualTypeOf<{
      id: number
      createdAt: string
      updatedAt: string
      title: string
      layout: (
        | {
            id: string
            blockType: 'hero'
            heading: string
            subheading: string | null
          }
        | {
            id: string
            blockType: 'richContent'
            body: Record<string, unknown>
          }
      )[]
      optionalLayout:
        | {
            id: string
            blockType: 'hero'
            heading: string
            subheading: string | null
          }[]
        | null
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
