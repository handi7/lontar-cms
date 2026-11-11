import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import type { CollectionConfig, Config, DatabaseAdapter } from '@lontar/core'
import { generateSchemaFile, slugToIdentifier } from './generator'
import {
  collectionToTable,
  createVersionsTable,
  getVersionsParentIdIndexName,
  getVersionsParentStatusIndexName,
} from './table'

const fakeAdapter: DatabaseAdapter = {
  name: 'mysql',
  find: () => Promise.reject(new Error('noop')),
  findByID: () => Promise.reject(new Error('noop')),
  create: () => Promise.reject(new Error('noop')),
  update: () => Promise.reject(new Error('noop')),
  delete: () => Promise.reject(new Error('noop')),
  findGlobal: () => Promise.reject(new Error('noop')),
  updateGlobal: () => Promise.reject(new Error('noop')),
  toSchemaFile: () => '',
  migrate: () => Promise.resolve(),
}

describe('slugToIdentifier', () => {
  it('converts kebab-case to camelCase', () => {
    expect(slugToIdentifier('posts')).toBe('posts')
    expect(slugToIdentifier('blog-posts')).toBe('blogPosts')
    expect(slugToIdentifier('site-meta-settings')).toBe('siteMetaSettings')
  })
})

describe('generateSchemaFile', () => {
  it('generates Drizzle table with system fields and fields for posts', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        title: { type: 'text', required: true, maxLength: 120 },
        views: { type: 'number', integer: true, defaultValue: 0 },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)

    expect(output).toMatch(
      /import \{ boolean, index, int, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
    )
    expect(output).toContain("export const posts = mysqlTable('posts', {")
    expect(output).toContain("id: int('id').autoincrement().primaryKey(),")
    expect(output).toContain("title: varchar('title', { length: 120 }).notNull(),")
    expect(output).toContain("views: int('views').default(0),")
    expect(output).toContain("createdAt: timestamp('createdAt').defaultNow().notNull(),")
    expect(output).toContain(
      "updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),",
    )
  })

  it('handles optional fields and double numbers', () => {
    const items: CollectionConfig = {
      slug: 'items',
      fields: {
        description: { type: 'text' },
        score: { type: 'number', required: true },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [items],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain('double')
    expect(output).toContain("description: varchar('description', { length: 255 }),")
    expect(output).toContain("score: double('score').notNull(),")
  })

  it('escapes default string values', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        status: { type: 'text', defaultValue: 'draft' },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain('status: varchar(\'status\', { length: 255 }).default("draft"),')
  })

  it('generates schema for textarea, email, and slug fields', () => {
    const authors: CollectionConfig = {
      slug: 'authors',
      fields: {
        bio: { type: 'textarea', defaultValue: 'Nothing here yet' },
        email: { type: 'email', required: true, unique: true },
        slug: { type: 'slug', unique: true, from: 'name' },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [authors],
    }

    const output = generateSchemaFile(config)
    expect(output).toMatch(
      /import \{ boolean, index, int, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
    )
    expect(output).toContain('bio: text(\'bio\').default("Nothing here yet"),')
    expect(output).toContain("email: varchar('email', { length: 255 }).unique().notNull(),")
    expect(output).toContain("slug: varchar('slug', { length: 255 }).unique(),")
  })

  it('generates schema for checkbox, select, and date fields', () => {
    const articles: CollectionConfig = {
      slug: 'articles',
      fields: {
        isPublished: { type: 'checkbox', defaultValue: false },
        status: {
          type: 'select',
          options: ['draft', 'published'],
          defaultValue: 'draft',
          required: true,
        },
        publishedAt: { type: 'date', required: true, defaultValue: '2026-11-01T00:00:00.000Z' },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [articles],
    }

    const output = generateSchemaFile(config)
    expect(output).toMatch(
      /import \{ boolean, datetime, index, int, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
    )
    expect(output).toContain("isPublished: boolean('isPublished').default(false),")
    expect(output).toContain(
      'status: varchar(\'status\', { length: 120 }).default("draft").notNull(),',
    )
    expect(output).toContain(
      "publishedAt: datetime('publishedAt', { mode: 'date', fsp: 3 }).default(new Date(\"2026-11-01T00:00:00.000Z\")).notNull(),",
    )
  })

  it('generates schema for richText fields with json column import', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        content: {
          type: 'richText',
          required: true,
          defaultValue: { type: 'doc', content: [] },
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)
    expect(output).toMatch(
      /import \{ boolean, index, int, json, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
    )
    expect(output).toContain(
      'content: json(\'content\').default({"type":"doc","content":[]}).notNull(),',
    )
  })

  it('generates schema for single and hasMany relationship fields', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        author: {
          type: 'relationship',
          relationTo: 'users',
          required: true,
        },
        reviewer: {
          type: 'relationship',
          relationTo: 'users',
        },
        categories: {
          type: 'relationship',
          relationTo: 'categories',
          hasMany: true,
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("export const posts = mysqlTable('posts', {")
    expect(output).toContain("author: int('author').notNull(),")
    expect(output).toContain("reviewer: int('reviewer'),")
    // hasMany should not be rendered as a column on posts
    expect(output).not.toContain("categories: int('categories')")
    // hasMany should be rendered as a junction table
    expect(output).toContain("export const postsCategories = mysqlTable(\n  'posts_categories',")
    expect(output).toContain("parentId: int('parent_id').notNull(),")
    expect(output).toContain("targetId: int('target_id').notNull(),")
    expect(output).toContain("order: int('order').default(0).notNull(),")
    expect(output).toContain("index('posts_categories_parent_idx').on(table.parentId)")
    expect(output).toContain("index('posts_categories_target_idx').on(table.targetId)")
    expect(output).toContain(
      "unique('posts_categories_parent_target_unique').on(table.parentId, table.targetId)",
    )
  })

  it('generates schema for upload fields and media collections', () => {
    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [
        {
          slug: 'media',
          upload: true,
          fields: {
            alt: { type: 'text', required: true },
          },
        },
        {
          slug: 'articles',
          fields: {
            cover: { type: 'upload', relationTo: 'media', required: true },
            thumbnail: { type: 'upload', relationTo: 'media' },
          },
        },
      ],
    }

    const output = generateSchemaFile(config)
    expect(output).toMatch(
      /import \{ boolean, index, int, json, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
    )
    expect(output).toContain("export const media = mysqlTable('media', {")
    expect(output).toContain("filename: varchar('filename', { length: 255 }).notNull(),")
    expect(output).toContain("url: varchar('url', { length: 1024 }).notNull(),")
    expect(output).toContain("mimeType: varchar('mimeType', { length: 255 }).notNull(),")
    expect(output).toContain("filesize: int('filesize').notNull(),")
    expect(output).toContain("width: int('width'),")
    expect(output).toContain("height: int('height'),")
    expect(output).toContain("sizes: json('sizes'),")
    expect(output).toContain("alt: varchar('alt', { length: 255 }).notNull(),")

    expect(output).toContain("export const articles = mysqlTable('articles', {")
    expect(output).toContain("cover: int('cover').notNull(),")
    expect(output).toContain("thumbnail: int('thumbnail'),")
  })

  it('generates schema for auth tables (user, session, account, verification)', () => {
    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("export const user = mysqlTable('user', {")
    expect(output).toContain('export const session = mysqlTable(')
    expect(output).toContain('export const account = mysqlTable(')
    expect(output).toContain('export const verification = mysqlTable(')
    expect(output).toContain("emailVerified: boolean('email_verified').default(false).notNull(),")
    expect(output).toContain("index('session_userId_idx').on(table.userId)")
  })

  it('generates schema for globals', () => {
    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [],
      globals: [
        {
          slug: 'site-settings',
          fields: {
            siteTitle: { type: 'text', required: true },
            maintenanceMode: { type: 'checkbox', defaultValue: false },
          },
        },
      ],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("export const siteSettings = mysqlTable('site-settings', {")
    expect(output).toContain("id: int('id').autoincrement().primaryKey(),")
    expect(output).toContain("siteTitle: varchar('siteTitle', { length: 255 }).notNull(),")
    expect(output).toContain("maintenanceMode: boolean('maintenanceMode').default(false),")
    expect(output).toContain("createdAt: timestamp('createdAt').defaultNow().notNull(),")
    expect(output).toContain(
      "updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),",
    )
  })

  it('resolves drizzle-orm/mysql-core to an absolute path for pnpm compatibility', () => {
    const output = generateSchemaFile({
      secret: 'test',
      db: fakeAdapter,
      collections: [],
    })
    const match = output.match(/import \{ [^}]+ \} from '([^']+)'/)
    expect(match).not.toBeNull()
    const moduleSpecifier = match?.[1]
    expect(moduleSpecifier).toBeDefined()
    if (!moduleSpecifier) throw new Error('Expected module specifier')
    expect(moduleSpecifier).toContain('drizzle-orm/mysql-core')
    expect(moduleSpecifier.startsWith('/') || /^[A-Z]:\//i.test(moduleSpecifier)).toBe(true)
  })

  it('generates flattened column names for group fields and nested group fields', () => {
    const pages: CollectionConfig = {
      slug: 'pages',
      fields: {
        title: { type: 'text', required: true },
        seo: {
          type: 'group',
          fields: {
            metaTitle: { type: 'text', required: true, maxLength: 60 },
            metaDescription: { type: 'textarea' },
            og: {
              type: 'group',
              fields: {
                imageAlt: { type: 'text' },
              },
            },
          },
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [pages],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("title: varchar('title', { length: 255 }).notNull(),")
    expect(output).toContain("seo__metaTitle: varchar('seo__metaTitle', { length: 60 }).notNull(),")
    expect(output).toContain("seo__metaDescription: text('seo__metaDescription'),")
    expect(output).toContain("seo__og__imageAlt: varchar('seo__og__imageAlt', { length: 255 }),")
  })

  it('generates json column for array fields', () => {
    const portfolio: CollectionConfig = {
      slug: 'portfolio',
      fields: {
        title: { type: 'text', required: true },
        gallery: {
          type: 'array',
          required: true,
          fields: {
            caption: { type: 'text' },
          },
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [portfolio],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("title: varchar('title', { length: 255 }).notNull(),")
    expect(output).toContain("gallery: json('gallery').notNull(),")
  })

  it('generates json column for blocks fields', () => {
    const pages: CollectionConfig = {
      slug: 'pages',
      fields: {
        title: { type: 'text', required: true },
        layout: {
          type: 'blocks',
          required: true,
          blocks: [
            {
              slug: 'hero',
              fields: {
                heading: { type: 'text', required: true },
              },
            },
          ],
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [pages],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("title: varchar('title', { length: 255 }).notNull(),")
    expect(output).toContain("layout: json('layout').notNull(),")
  })

  it('generates nullable columns for fields with admin.condition regardless of required: true', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        title: { type: 'text', required: true },
        format: {
          type: 'select',
          options: ['standard', 'video'],
          defaultValue: 'standard',
        },
        videoUrl: {
          type: 'text',
          required: true,
          admin: { condition: { format: { equals: 'video' } } },
        },
        settings: {
          type: 'group',
          admin: { condition: { format: { equals: 'video' } } },
          fields: {
            duration: { type: 'number', required: true },
          },
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("title: varchar('title', { length: 255 }).notNull(),")
    expect(output).toContain("videoUrl: varchar('videoUrl', { length: 255 }),")
    expect(output).not.toContain("videoUrl: varchar('videoUrl', { length: 255 }).notNull(),")
    expect(output).toContain("settings__duration: double('settings__duration'),")
    expect(output).not.toContain("settings__duration: double('settings__duration').notNull(),")
  })

  it('generates _status column and index when drafts are enabled', () => {
    const articles: CollectionConfig = {
      slug: 'articles',
      versions: { drafts: true },
      fields: {
        title: { type: 'text', required: true },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [articles],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain(
      "_status: varchar('_status', { length: 20 }).default('draft').notNull(),",
    )
    expect(output).toContain("(t) => [index('articles__status_idx').on(t._status)],")
  })

  it('generates versions table with parent FK, snapshot JSON and indexes when versions are enabled', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      versions: { drafts: true, maxPerDoc: 50 },
      fields: {
        title: { type: 'text', required: true },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain("export const postsVersions = mysqlTable(\n  'posts_versions',")
    expect(output).toContain('foreignKey({')
    expect(output).toContain("name: 'posts_versions_parent_id_posts_id_fk'")
    expect(output).toContain('columns: [t.parentId]')
    expect(output).toContain('foreignColumns: [posts.id]')
    expect(output).toContain("}).onDelete('cascade')")
    expect(output).toContain("versionNumber: int('version_number').notNull(),")
    expect(output).toContain("snapshot: json('snapshot').notNull(),")
    expect(output).toContain(
      "_status: varchar('_status', { length: 20 }).default('draft').notNull(),",
    )
    expect(output).toContain("autosave: boolean('autosave').default(false).notNull(),")
    expect(output).toContain("index('posts_versions_parent_id_idx').on(t.parentId, t.id)")
    expect(output).toContain("index('posts_versions_parent_status_idx').on(t.parentId, t._status)")
    expect(output).toContain(
      "unique('posts_versions_parent_version_unique').on(t.parentId, t.versionNumber)",
    )
    expect(output).toMatch(/import \{.*foreignKey,.*unique.*\} from '.*drizzle-orm\/mysql-core/)
  })

  it('truncates versions parent FK, unique constraint, and index names to at most 64 characters for long collection slugs', () => {
    const longCol: CollectionConfig = {
      slug: 'very-long-newsletter-campaigns-and-marketing-slug',
      versions: { drafts: true },
      fields: { title: { type: 'text' } },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [longCol],
    }

    const output = generateSchemaFile(config)
    const fkMatch = output.match(/name: '([^']+)'/)
    expect(fkMatch).not.toBeNull()
    const fkName = fkMatch?.[1] ?? ''
    expect(fkName.length).toBeLessThanOrEqual(64)
    expect(fkName).toMatch(/_[a-f0-9]{8}_fk$/)

    const uqMatch = output.match(/unique\('([^']+)'\)/)
    expect(uqMatch).not.toBeNull()
    const uqName = uqMatch?.[1] ?? ''
    expect(uqName.length).toBeLessThanOrEqual(64)
    expect(uqName).toMatch(/_[a-f0-9]{8}_unique$/)

    const parentIdIdx = getVersionsParentIdIndexName(longCol.slug)
    const parentStatusIdx = getVersionsParentStatusIndexName(longCol.slug)
    expect(parentIdIdx.length).toBeLessThanOrEqual(64)
    expect(parentStatusIdx.length).toBeLessThanOrEqual(64)
    expect(parentIdIdx).toMatch(/_[a-f0-9]{8}_idx$/)
    expect(parentStatusIdx).toMatch(/_[a-f0-9]{8}_idx$/)
    expect(output).toContain(`index('${parentIdIdx}').on(t.parentId, t.id)`)
    expect(output).toContain(`index('${parentStatusIdx}').on(t.parentId, t._status)`)
  })

  it('runtime table and generated schema agree on versions index names for long slugs', () => {
    const slug = 'newsletter-campaign-delivery-schedules'
    const col: CollectionConfig = {
      slug,
      versions: { drafts: true },
      fields: { title: { type: 'text' } },
    }
    const parentTable = collectionToTable(col)
    const vTable = createVersionsTable(slug, parentTable)
    const tableConf = getTableConfig(vTable)
    const runtimeIdxNames = tableConf.indexes.map((idx) => idx.config.name).sort()

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [col],
    }
    const output = generateSchemaFile(config)
    const genIdxMatches = [...output.matchAll(/index\('([^']+)'\)/g)]
      .map((m) => m[1]!)
      .filter((n) => n.includes('versions') || n.includes('parent'))
      .sort()

    expect(genIdxMatches).toEqual(runtimeIdxNames)
    for (const name of genIdxMatches) {
      expect(name.length).toBeLessThanOrEqual(64)
    }
  })
})
