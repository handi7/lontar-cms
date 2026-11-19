import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import type { CollectionConfig, Config, DatabaseAdapter } from '@lontar/core'
import { findDrizzleKitBin } from '@lontar/db-test-suite'
import { mysqlAdapter } from '../adapter'
import { isMySqlAvailable, setupTestDatabase, type TestDatabase } from '../test-database'
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
      /import \{ bigint, boolean, index, int, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
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
      /import \{ bigint, boolean, index, int, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
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
      /import \{ bigint, boolean, datetime, index, int, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
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
      /import \{ bigint, boolean, index, int, json, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
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
      /import \{ bigint, boolean, index, int, json, mysqlTable, text, timestamp, varchar \} from '.*drizzle-orm\/mysql-core/,
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
    expect(output).toContain("export const user = mysqlTable(\n  'user',")
    expect(output).toContain("role: varchar('role', { length: 50 }).default('editor').notNull(),")
    expect(output).toContain("index('user_role_idx').on(table.role)")
    expect(output).toContain('export const session = mysqlTable(')
    expect(output).toContain("impersonatedBy: text('impersonated_by'),")
    expect(output).toContain('export const account = mysqlTable(')
    expect(output).toContain('export const verification = mysqlTable(')
    expect(output).toContain('export const apikey = mysqlTable(')
    expect(output).toContain('export const rateLimit = mysqlTable(')
    expect(output).toContain("emailVerified: boolean('email_verified').default(false).notNull(),")
    expect(output).toContain("index('session_userId_idx').on(table.userId)")
  })

  it('respects auth.defaultRole when generating user table', () => {
    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      auth: {
        roles: ['admin', 'author'] as const,
        defaultRole: 'author',
      },
      collections: [],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("role: varchar('role', { length: 50 }).default('author').notNull(),")
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

  describe('localization schema file generation', () => {
    const localizedBlogConfig: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      localization: {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'id', label: 'Bahasa Indonesia' },
        ],
        defaultLocale: 'en',
      },
      collections: [
        {
          slug: 'posts',
          versions: { drafts: true },
          fields: {
            title: { type: 'text', required: true, localized: true },
            slug: { type: 'slug', required: true, unique: true, localized: true },
            content: { type: 'textarea', localized: true },
            views: { type: 'number', integer: true, defaultValue: 0 },
            author: { type: 'relationship', relationTo: 'users', localized: true },
            cover: { type: 'upload', relationTo: 'media', localized: true },
            seo: {
              type: 'group',
              localized: true,
              fields: {
                metaTitle: { type: 'text', required: true },
              },
            },
            layout: {
              type: 'blocks',
              localized: true,
              blocks: [
                {
                  slug: 'hero',
                  fields: { heading: { type: 'text' } },
                },
              ],
            },
            gallery: {
              type: 'array',
              fields: {
                caption: { type: 'text', localized: true },
              },
            },
            tags: {
              type: 'relationship',
              relationTo: 'tags',
              hasMany: true,
              localized: true,
            },
          },
        },
        {
          slug: 'tags',
          fields: {
            name: { type: 'text', required: true, localized: true },
          },
        },
        {
          slug: 'media',
          upload: true,
          fields: {
            alt: { type: 'text', localized: true },
          },
        },
      ],
      globals: [
        {
          slug: 'site_settings',
          fields: {
            siteName: { type: 'text', required: true, localized: true },
          },
        },
      ],
    }

    it('generates per-locale columns and localized junction tables in output schema', () => {
      const output = generateSchemaFile(localizedBlogConfig)

      // Top-level localized fields
      expect(output).toContain("title_en: varchar('title_en', { length: 255 }),")
      expect(output).toContain("title_id: varchar('title_id', { length: 255 }),")
      expect(output).toContain("slug_en: varchar('slug_en', { length: 255 }).unique(),")
      expect(output).toContain("slug_id: varchar('slug_id', { length: 255 }).unique(),")
      expect(output).toContain("content_en: text('content_en'),")
      expect(output).toContain("content_id: text('content_id'),")
      expect(output).toContain("author_en: int('author_en'),")
      expect(output).toContain("author_id: int('author_id'),")
      expect(output).toContain("cover_en: int('cover_en'),")
      expect(output).toContain("cover_id: int('cover_id'),")

      // Non-localized stays flat
      expect(output).toContain("views: int('views').default(0),")

      // Localized group flattens to per-locale columns
      expect(output).toContain("seo__metaTitle_en: varchar('seo__metaTitle_en', { length: 255 }),")
      expect(output).toContain("seo__metaTitle_id: varchar('seo__metaTitle_id', { length: 255 }),")

      // Localized container blocks generate per-locale JSON columns
      expect(output).toContain("layout_en: json('layout_en'),")
      expect(output).toContain("layout_id: json('layout_id'),")

      // Shared container array with localized subfield generates single JSON column
      expect(output).toContain("gallery: json('gallery'),")

      // Localized junction table includes _locale and composite index/unique
      expect(output).toContain("export const postsTags = mysqlTable(\n  'posts_tags',")
      expect(output).toContain("_locale: varchar('_locale', { length: 10 }).notNull(),")
      expect(output).toContain(
        "index('posts_tags_parent_locale_order_idx').on(table.parentId, table._locale, table.order)",
      )
      expect(output).toContain(
        "unique('posts_tags_parent_locale_target_unique').on(table.parentId, table._locale, table.targetId)",
      )

      // Localized upload collection
      expect(output).toContain("alt_en: varchar('alt_en', { length: 255 }),")
      expect(output).toContain("alt_id: varchar('alt_id', { length: 255 }),")
      expect(output).toContain("filename: varchar('filename', { length: 255 }).notNull(),")

      // Localized global
      expect(output).toContain("siteName_en: varchar('siteName_en', { length: 255 }),")
      expect(output).toContain("siteName_id: varchar('siteName_id', { length: 255 }),")
    })

    it('drizzle-kit generate --dialect mysql accepts the generated localized schema and applies cleanly', async () => {
      const schema = generateSchemaFile(localizedBlogConfig)
      const tmpDir = fs.mkdtempSync(path.join('/tmp', 'lontar-mysql-schema-'))
      const schemaFile = path.join(tmpDir, 'schema.ts')
      const outDir = path.join(tmpDir, 'migrations')
      fs.writeFileSync(schemaFile, schema)

      let testDb: TestDatabase | undefined
      try {
        const bin = findDrizzleKitBin()
        execFileSync(process.execPath, [
          bin,
          'generate',
          '--dialect',
          'mysql',
          '--schema',
          schemaFile,
          '--out',
          outDir,
        ])

        const files = fs.readdirSync(outDir)
        const sqlFiles = files.filter((f) => f.endsWith('.sql'))
        expect(sqlFiles.length).toBeGreaterThan(0)

        const sqlContent = fs.readFileSync(path.join(outDir, sqlFiles[0]!), 'utf8')
        expect(sqlContent).toContain('CREATE TABLE `posts`')
        expect(sqlContent).toContain('`title_en` varchar(255)')
        expect(sqlContent).toContain('`title_id` varchar(255)')
        expect(sqlContent).toContain('`slug_en` varchar(255)')
        expect(sqlContent).toContain('`slug_id` varchar(255)')
        expect(sqlContent).toContain('CREATE TABLE `posts_tags`')
        expect(sqlContent).toContain('`_locale` varchar(10) NOT NULL')
        expect(sqlContent).toContain('CREATE TABLE `site_settings`')
        expect(sqlContent).toContain('`siteName_en` varchar(255)')
        expect(sqlContent).toContain('`siteName_id` varchar(255)')

        if (await isMySqlAvailable()) {
          testDb = await setupTestDatabase()
          const adapter = mysqlAdapter({ url: testDb.url })
          try {
            await adapter.migrate({ migrationsDir: outDir })
          } finally {
            await adapter.close()
          }
        }
      } finally {
        if (testDb) {
          await testDb.teardown()
        }
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })
})
