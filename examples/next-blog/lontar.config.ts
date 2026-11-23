import {
  block,
  collection,
  consoleEmailAdapter,
  defineConfig,
  fields as f,
  global,
} from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'
import { postgresAdapter } from '@lontar/db-postgres'
import { localStorage } from '@lontar/storage-local'

const isAdmin = (user: { role?: string } | null | undefined) => user?.role === 'admin'
const isEditorOrAdmin = (user: { role?: string } | null | undefined) =>
  user?.role === 'admin' || user?.role === 'editor'

const authors = collection({
  slug: 'authors',
  labels: { singular: 'Author', plural: 'Authors' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
  },
  access: {
    read: () => true,
    create: ({ user }) => isEditorOrAdmin(user),
    update: ({ user }) => isEditorOrAdmin(user),
    delete: ({ user }) => isAdmin(user),
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
    create: ({ user }) => isEditorOrAdmin(user),
    update: ({ user }) => isEditorOrAdmin(user),
    delete: ({ user }) => isAdmin(user),
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
    delete: ({ user }) => isEditorOrAdmin(user),
  },
  fields: {
    alt: f.text({ required: true, localized: true }),
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
      url: '/{locale}/posts/{slug}?preview=1',
    },
    actions: [
      {
        key: 'archive',
        label: 'Archive',
        scope: ['row', 'document'],
        endpoint: 'archive-post',
        confirm: 'Archive this post?',
        variant: 'secondary',
      },
      {
        key: 'bulk-archive',
        label: 'Archive',
        scope: 'bulk',
        endpoint: 'bulk-archive-posts',
        confirm: 'Archive {count} selected posts?',
        variant: 'secondary',
      },
    ],
  },
  endpoints: [
    {
      name: 'archive-post',
      method: 'post',
      path: '/:id/archive',
      access: ({ user }) => isEditorOrAdmin(user),
      handler: async (c, { lontar, id }) => {
        if (!id) return c.json({ error: 'Missing ID' }, 400)
        await lontar.unpublish('posts', id)
        return c.json({ success: true })
      },
    },
    {
      name: 'bulk-archive-posts',
      method: 'post',
      path: '/bulk-archive',
      access: ({ user }) => isEditorOrAdmin(user),
      handler: async (c, { lontar }) => {
        const body = await c.req.json<{ ids?: Array<number | string> }>()
        const ids = body.ids ?? []
        for (const id of ids) {
          await lontar.unpublish('posts', id)
        }
        return c.json({ success: true, count: ids.length })
      },
    },
  ],
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ user }) => isEditorOrAdmin(user),
  },
  fields: {
    title: f.text({ required: true, maxLength: 120, localized: true }),
    slug: f.slug({ from: 'title', unique: true, localized: true }),
    cover: f.upload({ relationTo: 'media' }),
    author: f.relationship({ relationTo: 'authors' }),
    categories: f.relationship({ relationTo: 'categories', hasMany: true }),
    excerpt: f.textarea({ localized: true }),
    content: f.richText({ localized: true }),
    publishedAt: f.date({
      access: {
        create: ({ user }) => isEditorOrAdmin(user),
        update: ({ user }) => isEditorOrAdmin(user),
      },
    }),
    rating: f.number({
      min: 1,
      max: 5,
      admin: {
        component: 'star-rating',
      },
    }),
    editorialNotes: f.textarea({
      access: {
        read: ({ user }) => isEditorOrAdmin(user),
        create: ({ user }) => isEditorOrAdmin(user),
        update: ({ user }) => isEditorOrAdmin(user),
      },
    }),
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
      url: '/{locale}/{slug}?preview=1',
    },
  },
  access: {
    read: ({ user }) => isEditorOrAdmin(user),
    create: ({ user }) => isEditorOrAdmin(user),
    update: ({ user }) => isEditorOrAdmin(user),
    delete: ({ user }) => isAdmin(user),
  },
  fields: {
    title: f.text({ required: true, maxLength: 120, localized: true }),
    slug: f.slug({ from: 'title', unique: true, localized: true }),
    seo: f.group({
      localized: true,
      fields: {
        metaTitle: f.text(),
        metaDescription: f.textarea(),
        reviewNotes: f.textarea({
          access: {
            read: ({ user }) => isAdmin(user),
            create: ({ user }) => isAdmin(user),
            update: ({ user }) => isAdmin(user),
          },
        }),
      },
    }),
    layout: f.blocks({
      localized: true,
      blocks: [heroBlock, richTextBlock, galleryBlock, callToActionBlock],
    }),
  },
})

const siteSettings = global({
  slug: 'site-settings',
  label: 'Site Settings',
  access: {
    read: ({ user }) => isEditorOrAdmin(user),
    update: ({ user }) => isAdmin(user),
  },
  fields: {
    siteName: f.text(),
    footerText: f.textarea(),
  },
})

const revalidationSecret =
  process.env.REVALIDATION_SECRET ||
  (process.env.NODE_ENV !== 'production' ? 'dev-webhook-secret-key-12345' : undefined)

function getDatabaseAdapter() {
  const url =
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_URL && !process.env.DATABASE_URL
      ? process.env.POSTGRES_URL
      : undefined) ||
    'mysql://lontar:lontar@127.0.0.1:3306/lontar'

  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return postgresAdapter({ url })
  }
  return mysqlAdapter({ url })
}

export default defineConfig({
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'id', label: 'Indonesian' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
  secret: process.env.LONTAR_SECRET || 'dev-secret-at-least-32-chars-long-12345',
  email: consoleEmailAdapter(),
  db: getDatabaseAdapter(),
  storage: localStorage(),
  auth: {
    roles: ['admin', 'editor', 'author'] as const,
    defaultRole: 'author',
    adminRole: 'admin',
  },
  collections: [posts, pages, categories, authors, media],
  globals: [siteSettings],
  endpoints: [
    {
      name: 'pending-posts-count',
      method: 'get',
      path: '/stats/pending-posts',
      access: ({ user }) => Boolean(user),
      handler: async (c, { lontar }) => {
        const result = await lontar.find('posts', {
          where: { _status: { equals: 'draft' } },
          limit: 0,
        })
        return c.json({ count: result.totalDocs })
      },
    },
  ],
  admin: {
    dashboard: {
      widgets: [
        {
          component: 'pending-posts-widget',
          width: 'half',
        },
      ],
    },
    views: [
      {
        key: 'analytics',
        label: 'Analytics',
        component: 'analytics-view',
        access: ({ user }) => Boolean(user),
      },
    ],
  },
  webhooks: [
    {
      url: `${process.env.LONTAR_URL || 'http://localhost:3000'}/api/revalidate`,
      events: ['publish', 'unpublish', 'delete'],
      ...(revalidationSecret ? { secret: revalidationSecret } : {}),
    },
  ],
})
