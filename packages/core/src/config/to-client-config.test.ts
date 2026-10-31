import { describe, expect, it } from 'vitest'
import { fakeAdapter, postsConfig, SECRET } from '../__fixtures__/posts'
import { CLIENT_CONFIG_VERSION } from '../client/client-config'
import { fields as f } from '../fields'
import { defineConfig } from './define-config'
import { toClientConfig } from './to-client-config'
import type { CollectionConfig } from './types'

function clientCollection(collection: CollectionConfig) {
  const config = defineConfig({ secret: SECRET, db: fakeAdapter, collections: [collection] })
  return toClientConfig(config).collections[0]
}

describe('toClientConfig', () => {
  it('serializes the posts collection', () => {
    expect(toClientConfig(postsConfig)).toStrictEqual({
      version: CLIENT_CONFIG_VERSION,
      collections: [
        {
          slug: 'posts',
          labels: { singular: 'Post', plural: 'Posts' },
          admin: { useAsTitle: 'title', defaultColumns: ['title', 'views', 'createdAt'] },
          fields: [
            { name: 'title', type: 'text', label: 'Title', required: true, maxLength: 120 },
            {
              name: 'views',
              type: 'number',
              label: 'Views',
              required: false,
              integer: true,
              min: 0,
            },
          ],
        },
      ],
    })
  })

  it('survives a JSON round trip unchanged', () => {
    const clientConfig = toClientConfig(postsConfig)
    expect(JSON.parse(JSON.stringify(clientConfig))).toStrictEqual(clientConfig)
  })

  it('leaves out the secret and the database adapter', () => {
    const json = JSON.stringify(toClientConfig(postsConfig))
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain(fakeAdapter.name)
  })

  // AGENTS.md: extend this test whenever a field type gains an option.
  it('serializes every option of every field type', () => {
    const collection = clientCollection({
      slug: 'everything',
      fields: {
        text: f.text({
          label: 'Text',
          required: true,
          minLength: 2,
          maxLength: 10,
          defaultValue: 'hi',
        }),
        number: f.number({
          label: 'Number',
          required: true,
          min: 1,
          max: 9,
          integer: true,
          defaultValue: 5,
        }),
        textarea: f.textarea({
          label: 'Textarea',
          required: true,
          minLength: 10,
          maxLength: 500,
          rows: 6,
          defaultValue: 'default text',
        }),
        email: f.email({
          label: 'Email',
          required: true,
          unique: true,
          defaultValue: 'hello@example.com',
        }),
        slug: f.slug({
          label: 'Slug',
          required: true,
          unique: true,
          from: 'text',
          defaultValue: 'my-slug',
        }),
        checkbox: f.checkbox({
          label: 'Active',
          required: true,
          defaultValue: true,
        }),
        select: f.select({
          label: 'Status',
          required: true,
          options: ['draft', { label: 'Published', value: 'published' }],
          defaultValue: 'draft',
        }),
        date: f.date({
          label: 'Published At',
          required: true,
          defaultValue: '2026-11-01T00:00:00.000Z',
        }),
      },
    })

    expect(collection?.fields).toStrictEqual([
      {
        name: 'text',
        type: 'text',
        label: 'Text',
        required: true,
        minLength: 2,
        maxLength: 10,
        defaultValue: 'hi',
      },
      {
        name: 'number',
        type: 'number',
        label: 'Number',
        required: true,
        min: 1,
        max: 9,
        integer: true,
        defaultValue: 5,
      },
      {
        name: 'textarea',
        type: 'textarea',
        label: 'Textarea',
        required: true,
        minLength: 10,
        maxLength: 500,
        rows: 6,
        defaultValue: 'default text',
      },
      {
        name: 'email',
        type: 'email',
        label: 'Email',
        required: true,
        unique: true,
        defaultValue: 'hello@example.com',
      },
      {
        name: 'slug',
        type: 'slug',
        label: 'Slug',
        required: true,
        unique: true,
        from: 'text',
        defaultValue: 'my-slug',
      },
      {
        name: 'checkbox',
        type: 'checkbox',
        label: 'Active',
        required: true,
        defaultValue: true,
      },
      {
        name: 'select',
        type: 'select',
        label: 'Status',
        required: true,
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
      },
      {
        name: 'date',
        type: 'date',
        label: 'Published At',
        required: true,
        defaultValue: '2026-11-01T00:00:00.000Z',
      },
    ])
  })

  it('keeps fields in config order', () => {
    const collection = clientCollection({
      slug: 'notes',
      fields: { b: f.text(), a: f.number(), c: f.text() },
    })

    expect(collection?.fields.map((field) => field.name)).toEqual(['b', 'a', 'c'])
  })

  it('fills in labels and admin defaults', () => {
    const collection = clientCollection({
      slug: 'blog-posts',
      fields: {
        headline: f.text(),
        publishedAt: f.text(),
        readingTime: f.number(),
        wordCount: f.number(),
      },
    })

    expect(collection?.labels).toStrictEqual({ singular: 'Blog Posts', plural: 'Blog Posts' })
    expect(collection?.fields.map((field) => field.label)).toEqual([
      'Headline',
      'Published At',
      'Reading Time',
      'Word Count',
    ])
    expect(collection?.admin).toStrictEqual({
      useAsTitle: 'id',
      defaultColumns: ['id', 'headline', 'publishedAt', 'readingTime'],
    })
  })

  it('starts the default columns with useAsTitle', () => {
    const collection = clientCollection({
      slug: 'notes',
      admin: { useAsTitle: 'title' },
      fields: { body: f.text(), title: f.text() },
    })

    expect(collection?.admin.defaultColumns).toEqual(['title', 'body'])
  })
})
