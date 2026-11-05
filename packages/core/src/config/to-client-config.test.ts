import { describe, expect, it } from 'vitest'
import { fakeAdapter, postsConfig, SECRET } from '../__fixtures__/posts'
import { CLIENT_CONFIG_VERSION } from '../client/client-config'
import { fields as f } from '../fields'
import { defineConfig } from './define-config'
import { toClientConfig } from './to-client-config'
import type { CollectionConfig } from './types'

const fakeStorage = {
  name: 'fake',
  upload: () => Promise.resolve({ filename: 'f', url: '/f' }),
  delete: () => Promise.resolve(),
  getUrl: () => '/f',
}

function clientCollection(collection: CollectionConfig, extraCollections: CollectionConfig[] = []) {
  const config = defineConfig({
    secret: SECRET,
    db: fakeAdapter,
    storage: fakeStorage,
    collections: [collection, ...extraCollections],
  })
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
      globals: [],
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

  it('leaves out collection access control functions', () => {
    const col = clientCollection({
      slug: 'protected',
      access: {
        read: () => true,
        create: () => false,
        update: () => false,
        delete: () => false,
      },
      fields: {
        title: f.text(),
      },
    })
    expect(col).not.toHaveProperty('access')
    expect(JSON.stringify(col)).not.toContain('access')
  })

  // AGENTS.md: extend this test whenever a field type gains an option.
  it('serializes every option of every field type', () => {
    const collection = clientCollection(
      {
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
          richText: f.richText({
            label: 'Body',
            required: true,
            defaultValue: { type: 'doc', content: [] },
          }),
          author: f.relationship({
            label: 'Author',
            required: true,
            relationTo: 'users',
          }),
          categories: f.relationship({
            label: 'Categories',
            relationTo: 'categories',
            hasMany: true,
          }),
        },
      },
      [
        { slug: 'users', fields: {} },
        { slug: 'categories', fields: {} },
      ],
    )

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
        maxLength: 255,
      },
      {
        name: 'slug',
        type: 'slug',
        label: 'Slug',
        required: true,
        unique: true,
        from: 'text',
        defaultValue: 'my-slug',
        maxLength: 255,
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
      {
        name: 'richText',
        type: 'richText',
        label: 'Body',
        required: true,
        defaultValue: { type: 'doc', content: [] },
      },
      {
        name: 'author',
        type: 'relationship',
        label: 'Author',
        required: true,
        relationTo: 'users',
      },
      {
        name: 'categories',
        type: 'relationship',
        label: 'Categories',
        required: false,
        relationTo: 'categories',
        hasMany: true,
      },
    ])
  })

  it('defaults maxLength to 255 for text, email, and slug fields', () => {
    const col = clientCollection({
      slug: 'strings',
      fields: {
        title: f.text(),
        contact: f.email(),
        slug: f.slug(),
      },
    })
    expect(col?.fields).toEqual([
      { name: 'title', type: 'text', label: 'Title', required: false, maxLength: 255 },
      { name: 'contact', type: 'email', label: 'Contact', required: false, maxLength: 255 },
      { name: 'slug', type: 'slug', label: 'Slug', required: false, maxLength: 255 },
    ])
  })

  it('serializes collection pagination settings when configured', () => {
    const col = clientCollection({
      slug: 'books',
      pagination: { defaultLimit: 25, maxLimit: 50 },
      fields: { title: f.text() },
    })
    expect(col?.pagination).toEqual({ defaultLimit: 25, maxLimit: 50 })
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
      useAsTitle: 'headline',
      defaultColumns: ['headline', 'publishedAt', 'readingTime', 'wordCount'],
    })
  })

  it('falls back useAsTitle to first email field if no text field exists', () => {
    const collection = clientCollection({
      slug: 'subscribers',
      fields: {
        score: f.number(),
        email: f.email(),
      },
    })
    expect(collection?.admin.useAsTitle).toBe('email')
    expect(collection?.admin.defaultColumns).toEqual(['email', 'score'])
  })

  it('falls back useAsTitle to first slug field if no text or email field exists', () => {
    const collection = clientCollection({
      slug: 'tags',
      fields: {
        count: f.number(),
        slug: f.slug(),
      },
    })
    expect(collection?.admin.useAsTitle).toBe('slug')
    expect(collection?.admin.defaultColumns).toEqual(['slug', 'count'])
  })

  it('falls back useAsTitle to filename for upload collections without text-like fields', () => {
    const collection = clientCollection({
      slug: 'media',
      upload: true,
      fields: {
        featured: f.checkbox(),
      },
    })
    expect(collection?.admin.useAsTitle).toBe('filename')
    expect(collection?.admin.defaultColumns).toEqual(['filename', 'featured'])
  })

  it('falls back useAsTitle to id when no text-like fields and not an upload collection', () => {
    const collection = clientCollection({
      slug: 'counters',
      fields: {
        count: f.number(),
        active: f.checkbox(),
      },
    })
    expect(collection?.admin.useAsTitle).toBe('id')
    expect(collection?.admin.defaultColumns).toEqual(['id', 'count', 'active'])
  })

  it('preserves explicitly configured admin.useAsTitle even when text fields exist', () => {
    const collection = clientCollection({
      slug: 'items',
      admin: { useAsTitle: 'code' },
      fields: {
        name: f.text(),
        code: f.text(),
      },
    })
    expect(collection?.admin.useAsTitle).toBe('code')
    expect(collection?.admin.defaultColumns).toEqual(['code', 'name'])
  })

  it('starts the default columns with useAsTitle', () => {
    const collection = clientCollection({
      slug: 'notes',
      admin: { useAsTitle: 'title' },
      fields: { body: f.text(), title: f.text() },
    })

    expect(collection?.admin.defaultColumns).toEqual(['title', 'body'])
  })

  it('serializes globals stripping hooks and access control', () => {
    const config = defineConfig({
      secret: SECRET,
      db: fakeAdapter,
      collections: [],
      globals: [
        {
          slug: 'header',
          label: 'Site Header',
          fields: {
            title: f.text({ label: 'Header Title', required: true }),
            sticky: f.checkbox(),
          },
          access: {
            read: () => true,
            update: () => false,
          },
          hooks: {
            beforeChange: [({ data }) => data],
          },
        },
        {
          slug: 'footer',
          fields: {
            copyright: f.text(),
          },
        },
      ],
    })

    const client = toClientConfig(config)
    expect(client.globals).toStrictEqual([
      {
        slug: 'header',
        label: 'Site Header',
        fields: [
          { name: 'title', type: 'text', label: 'Header Title', required: true, maxLength: 255 },
          { name: 'sticky', type: 'checkbox', label: 'Sticky', required: false },
        ],
      },
      {
        slug: 'footer',
        label: 'Footer',
        fields: [
          {
            name: 'copyright',
            type: 'text',
            label: 'Copyright',
            required: false,
            maxLength: 255,
          },
        ],
      },
    ])

    const json = JSON.stringify(client.globals)
    expect(json).not.toContain('access')
    expect(json).not.toContain('hooks')
  })

  it('serializes upload configuration including mimeTypes and maxFileSize', () => {
    const fakeStorage = {
      name: 'fake',
      upload: () => Promise.resolve({ filename: 'f', url: '/f' }),
      delete: () => Promise.resolve(),
      getUrl: () => '/f',
    }

    const config = defineConfig({
      secret: SECRET,
      db: fakeAdapter,
      storage: fakeStorage,
      collections: [
        {
          slug: 'media',
          upload: {
            mimeTypes: ['image/jpeg', 'image/png'],
            maxFileSize: 5 * 1024 * 1024,
          },
          fields: {
            alt: f.text(),
          },
        },
        {
          slug: 'simple-media',
          upload: true,
          fields: {},
        },
      ],
    })

    const client = toClientConfig(config)
    expect(client.collections[0]?.upload).toEqual({
      mimeTypes: ['image/jpeg', 'image/png'],
      maxFileSize: 5 * 1024 * 1024,
    })
    expect(client.collections[1]?.upload).toBe(true)
  })
})
