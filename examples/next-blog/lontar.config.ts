import { block, collection, defineConfig, fields as f, global } from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'
import { localStorage } from '@lontar/storage-local'

const authors = collection({
  slug: 'authors',
  labels: { singular: 'Author', plural: 'Authors' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
  },
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ user }) => Boolean(user),
  },
  fields: {
    name: f.text({ required: true }),
    bio: f.textarea(),
  },
})

const categories = collection({
  slug: 'categories',
  labels: { singular: 'Category', plural: 'Categories' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'createdAt'],
  },
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ user }) => Boolean(user),
  },
  fields: {
    name: f.text({ required: true }),
    slug: f.slug({ from: 'name', unique: true }),
  },
})

const media = collection({
  slug: 'media',
  labels: { singular: 'Media', plural: 'Media' },
  admin: {
    useAsTitle: 'alt',
    defaultColumns: ['alt', 'filename', 'mimeType', 'filesize', 'createdAt'],
  },
  upload: {
    sizes: {
      thumb: { width: 400 },
      hero: { width: 1600 },
    },
  },
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ user }) => Boolean(user),
  },
  fields: {
    alt: f.text({ required: true }),
  },
})

const posts = collection({
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  versions: {
    drafts: true,
    autosave: { interval: 2000 },
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', '_status', 'publishedAt'],
    preview: {
      url: '/posts/{slug}?preview=1',
    },
  },
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ user }) => Boolean(user),
  },
  fields: {
    title: f.text({ required: true, maxLength: 120 }),
    slug: f.slug({ from: 'title', unique: true }),
    cover: f.upload({ relationTo: 'media' }),
    author: f.relationship({ relationTo: 'authors' }),
    categories: f.relationship({ relationTo: 'categories', hasMany: true }),
    content: f.richText(),
    publishedAt: f.date(),
  },
  hooks: {
    beforeChange: [
      ({ data, statusTransition }) => {
        if (statusTransition === 'publish' && !data.publishedAt) {
          data.publishedAt = new Date()
        }
        return data
      },
    ],
  },
})

const heroBlock = block({
  slug: 'hero',
  labels: { singular: 'Hero', plural: 'Heroes' },
  fields: {
    heading: f.text({ required: true }),
    subheading: f.textarea(),
    backgroundImage: f.upload({ relationTo: 'media' }),
  },
})

const richTextBlock = block({
  slug: 'richText',
  labels: { singular: 'Rich Text', plural: 'Rich Texts' },
  fields: {
    content: f.richText(),
  },
})

const galleryBlock = block({
  slug: 'gallery',
  labels: { singular: 'Gallery', plural: 'Galleries' },
  fields: {
    images: f.array({
      fields: {
        image: f.upload({ relationTo: 'media', required: true }),
        caption: f.text(),
      },
    }),
  },
})

const callToActionBlock = block({
  slug: 'callToAction',
  labels: { singular: 'Call to Action', plural: 'Calls to Action' },
  fields: {
    headline: f.text({ required: true }),
    linkType: f.select({
      options: ['internal', 'external'],
      defaultValue: 'internal',
    }),
    internalPage: f.relationship({
      relationTo: 'pages',
      admin: {
        condition: {
          linkType: { equals: 'internal' },
        },
      },
    }),
    externalUrl: f.text({
      admin: {
        condition: {
          linkType: { equals: 'external' },
        },
      },
    }),
    buttonLabel: f.text({ required: true }),
  },
})

const pages = collection({
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  versions: {
    drafts: true,
    autosave: { interval: 2000 },
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'createdAt'],
    preview: {
      url: '/{slug}?preview=1',
    },
  },
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ user }) => Boolean(user),
  },
  fields: {
    title: f.text({ required: true, maxLength: 120 }),
    slug: f.slug({ from: 'title', unique: true }),
    seo: f.group({
      fields: {
        metaTitle: f.text(),
        metaDescription: f.textarea(),
      },
    }),
    layout: f.blocks({
      blocks: [heroBlock, richTextBlock, galleryBlock, callToActionBlock],
    }),
  },
})

const siteSettings = global({
  slug: 'site-settings',
  label: 'Site Settings',
  access: {
    read: () => true,
    update: ({ user }) => Boolean(user),
  },
  fields: {
    siteName: f.text(),
    footerText: f.textarea(),
  },
})

const revalidationSecret =
  process.env.REVALIDATION_SECRET ||
  (process.env.NODE_ENV !== 'production' ? 'dev-webhook-secret-key-12345' : undefined)

export default defineConfig({
  secret: process.env.LONTAR_SECRET || 'dev-secret-at-least-32-chars-long-12345',
  db: mysqlAdapter({
    url: process.env.DATABASE_URL || 'mysql://lontar:lontar@127.0.0.1:3306/lontar',
  }),
  storage: localStorage(),
  collections: [posts, pages, categories, authors, media],
  globals: [siteSettings],
  webhooks: [
    {
      url: `${process.env.LONTAR_URL || 'http://localhost:3000'}/api/revalidate`,
      events: ['publish', 'unpublish', 'delete'],
      ...(revalidationSecret ? { secret: revalidationSecret } : {}),
    },
  ],
})
