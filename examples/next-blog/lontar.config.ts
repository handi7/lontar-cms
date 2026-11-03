import { collection, defineConfig, fields as f, global } from '@lontar/core'
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
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'publishedAt'],
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
    status: f.select({ options: ['draft', 'published'], defaultValue: 'draft' }),
    cover: f.upload({ relationTo: 'media' }),
    author: f.relationship({ relationTo: 'authors' }),
    categories: f.relationship({ relationTo: 'categories', hasMany: true }),
    content: f.richText(),
    publishedAt: f.date(),
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data.status === 'published' && !data.publishedAt) {
          data.publishedAt = new Date()
        }
        return data
      },
    ],
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

export default defineConfig({
  secret: process.env.LONTAR_SECRET || 'dev-secret-at-least-32-chars-long-12345',
  db: mysqlAdapter({
    url: process.env.DATABASE_URL || 'mysql://lontar:lontar@127.0.0.1:3306/lontar',
  }),
  storage: localStorage(),
  collections: [posts, categories, authors, media],
  globals: [siteSettings],
})
