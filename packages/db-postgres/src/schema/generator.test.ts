import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import type { CollectionConfig, Config, DatabaseAdapter, GlobalConfig } from '@lontar/core'
import { findDrizzleKitBin } from '@lontar/db-test-suite'
import { postgresAdapter } from '../adapter'
import { isPostgresAvailable, setupTestDatabase, type TestDatabase } from '../test-database'
import { generateSchemaFile, slugToIdentifier } from './generator'
import {
  collectionToTable,
  createVersionsTable,
  getVersionsParentIdIndexName,
  getVersionsParentStatusIndexName,
} from './table'

const fakeAdapter: DatabaseAdapter = {
  name: 'postgres',
  dialect: 'postgresql',
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
      /import \{ bigint, boolean, index, integer, pgTable, serial, text, timestamp, varchar \} from '.*drizzle-orm\/pg-core/,
    )
    expect(output).toContain("export const posts = pgTable('posts', {")
    expect(output).toContain("id: serial('id').primaryKey(),")
    expect(output).toContain("title: varchar('title', { length: 120 }).notNull(),")
    expect(output).toContain("views: integer('views').default(0),")
    expect(output).toContain(
      "createdAt: timestamp('createdAt', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),",
    )
    expect(output).toContain(
      "updatedAt: timestamp('updatedAt', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),",
    )
  })

  it('handles optional fields and doublePrecision numbers', () => {
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

    expect(output).toContain('doublePrecision')
    expect(output).toContain("description: varchar('description', { length: 255 }),")
    expect(output).toContain("score: doublePrecision('score').notNull(),")
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
    expect(output).toContain('.default("draft")')
  })

  it('handles all standard field types', () => {
    const mixed: CollectionConfig = {
      slug: 'mixed',
      fields: {
        content: { type: 'textarea' },
        snippet: { type: 'code', required: true },
        metadata: { type: 'json' },
        email: { type: 'email', unique: true },
        slug: { type: 'slug', unique: true },
        isFeatured: { type: 'checkbox', defaultValue: false },
        category: { type: 'select', options: ['news', 'tech'], defaultValue: 'news' },
        publishedAt: { type: 'date' },
        theme: {
          type: 'radio',
          options: ['light', 'dark'],
          defaultValue: 'light',
          required: true,
        },
        body: { type: 'richText' },
        author: { type: 'relationship', relationTo: 'users', required: true },
        cover: { type: 'upload', relationTo: 'media' },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [mixed],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain("content: text('content'),")
    expect(output).toContain("snippet: text('snippet').notNull(),")
    expect(output).toContain("metadata: jsonb('metadata'),")
    expect(output).toContain("email: varchar('email', { length: 255 }).unique(),")
    expect(output).toContain("slug: varchar('slug', { length: 255 }).unique(),")
    expect(output).toContain("isFeatured: boolean('isFeatured').default(false),")
    expect(output).toContain('category: varchar(\'category\', { length: 120 }).default("news"),')
    expect(output).toContain(
      "publishedAt: timestamp('publishedAt', { precision: 3, withTimezone: true, mode: 'date' }),",
    )
    expect(output).toContain(
      'theme: varchar(\'theme\', { length: 120 }).default("light").notNull(),',
    )
    expect(output).toContain("body: jsonb('body'),")
    expect(output).toContain("author: integer('author').notNull(),")
    expect(output).toContain("cover: integer('cover'),")
  })

  it('generates schema for point fields (ADR 0031)', () => {
    const places: CollectionConfig = {
      slug: 'places',
      fields: {
        location: {
          type: 'point',
          required: true,
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [places],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("location__lng: doublePrecision('location__lng').notNull(),")
    expect(output).toContain("location__lat: doublePrecision('location__lat').notNull(),")
  })

  it('handles array and blocks fields with jsonb', () => {
    const pages: CollectionConfig = {
      slug: 'pages',
      fields: {
        gallery: {
          type: 'array',
          fields: { caption: { type: 'text' } },
        },
        sections: {
          type: 'blocks',
          blocks: [
            {
              slug: 'hero',
              fields: { headline: { type: 'text' } },
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

    expect(output).toContain("gallery: jsonb('gallery'),")
    expect(output).toContain("sections: jsonb('sections'),")
  })

  it('flattens group fields into prefixed column names', () => {
    const profiles: CollectionConfig = {
      slug: 'profiles',
      fields: {
        user: {
          type: 'group',
          fields: {
            firstName: { type: 'text', required: true },
            lastName: { type: 'text' },
          },
        },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [profiles],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain(
      "user__firstName: varchar('user__firstName', { length: 255 }).notNull(),",
    )
    expect(output).toContain("user__lastName: varchar('user__lastName', { length: 255 }),")
  })

  it('renders upload collection columns', () => {
    const media: CollectionConfig = {
      slug: 'media',
      upload: true,
      fields: {
        alt: { type: 'text' },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [media],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain("filename: varchar('filename', { length: 255 }).notNull(),")
    expect(output).toContain("url: varchar('url', { length: 1024 }).notNull(),")
    expect(output).toContain("mimeType: varchar('mimeType', { length: 255 }).notNull(),")
    expect(output).toContain("filesize: integer('filesize').notNull(),")
    expect(output).toContain("width: integer('width'),")
    expect(output).toContain("height: integer('height'),")
    expect(output).toContain("sizes: jsonb('sizes'),")
  })

  it('renders junction tables for hasMany relationships', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        tags: { type: 'relationship', relationTo: 'tags', hasMany: true },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [posts],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain("export const postsTags = pgTable(\n  'posts_tags',")
    expect(output).toContain("id: serial('id').primaryKey(),")
    expect(output).toContain("parentId: integer('parent_id').notNull(),")
    expect(output).toContain("targetId: integer('target_id').notNull(),")
    expect(output).toContain("order: integer('order').default(0).notNull(),")
    expect(output).toContain("index('posts_tags_parent_idx').on(table.parentId)")
    expect(output).toContain("index('posts_tags_target_idx').on(table.targetId)")
    expect(output).toContain(
      "unique('posts_tags_parent_target_unique').on(table.parentId, table.targetId)",
    )
  })

  it('renders globals', () => {
    const header: GlobalConfig = {
      slug: 'header',
      fields: {
        siteName: { type: 'text', required: true },
      },
    }

    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [],
      globals: [header],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain("export const header = pgTable('header', {")
    expect(output).toContain("siteName: varchar('siteName', { length: 255 }).notNull(),")
  })

  it('renders auth tables for Better Auth', () => {
    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [],
    }

    const output = generateSchemaFile(config)

    expect(output).toContain("export const user = pgTable(\n  'user',")
    expect(output).toContain("role: text('role').default('editor').notNull(),")
    expect(output).toContain("index('user_role_idx').on(table.role)")
    expect(output).toContain("export const session = pgTable(\n  'session',")
    expect(output).toContain("impersonatedBy: text('impersonated_by'),")
    expect(output).toContain("export const account = pgTable(\n  'account',")
    expect(output).toContain("export const verification = pgTable(\n  'verification',")
    expect(output).toContain("export const apikey = pgTable(\n  'apikey',")
    expect(output).toContain("export const rateLimit = pgTable(\n  'rateLimit',")
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
    expect(output).toContain("role: text('role').default('author').notNull(),")
  })

  it('renders versions table with drafts, foreign key, unique constraint, and indexes', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      versions: { drafts: true },
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

    expect(output).toContain("export const postsVersions = pgTable(\n  'posts_versions',")
    expect(output).toContain('foreignKey({')
    expect(output).toContain("name: 'posts_versions_parent_id_posts_id_fk'")
    expect(output).toContain('columns: [t.parentId]')
    expect(output).toContain('foreignColumns: [posts.id]')
    expect(output).toContain("}).onDelete('cascade')")
    expect(output).toContain("versionNumber: integer('version_number').notNull(),")
    expect(output).toContain("snapshot: jsonb('snapshot').notNull(),")
    expect(output).toContain(
      "_status: varchar('_status', { length: 20 }).default('draft').notNull(),",
    )
    expect(output).toContain("autosave: boolean('autosave').default(false).notNull(),")
    expect(output).toContain("index('posts_versions_parent_id_idx').on(t.parentId, t.id)")
    expect(output).toContain("index('posts_versions_parent_status_idx').on(t.parentId, t._status)")
    expect(output).toContain(
      "unique('posts_versions_parent_version_unique').on(t.parentId, t.versionNumber)",
    )
    expect(output).toMatch(/import \{.*foreignKey,.*unique.*\} from '.*drizzle-orm\/pg-core/)
    expect(output).not.toContain('import { sql }')
    expect(output).not.toContain('filename_idx')
  })

  it('renders upload collection versions table with filename expression index and sql import', () => {
    const media: CollectionConfig = {
      slug: 'media',
      upload: true,
      versions: { drafts: true },
      fields: { alt: { type: 'text' } },
    }
    const config: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [media],
    }

    const output = generateSchemaFile(config)
    expect(output).toContain("import { sql } from '")
    expect(output).toContain("export const mediaVersions = pgTable(\n  'media_versions',")
    expect(output).toContain(
      "index('media_versions_filename_idx').on(sql`(${t.snapshot}->>'filename')`)",
    )
  })

  it('truncates versions parent FK, unique constraint, and index names to at most 63 characters for long collection slugs', () => {
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
    expect(fkName.length).toBeLessThanOrEqual(63)
    expect(fkName).toMatch(/_[a-f0-9]{8}_fk$/)

    const uqMatch = output.match(/unique\('([^']+)'\)/)
    expect(uqMatch).not.toBeNull()
    const uqName = uqMatch?.[1] ?? ''
    expect(uqName.length).toBeLessThanOrEqual(63)
    expect(uqName).toMatch(/_[a-f0-9]{8}_unique$/)

    const parentIdIdx = getVersionsParentIdIndexName(longCol.slug)
    const parentStatusIdx = getVersionsParentStatusIndexName(longCol.slug)
    expect(parentIdIdx.length).toBeLessThanOrEqual(63)
    expect(parentStatusIdx.length).toBeLessThanOrEqual(63)
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
      expect(name.length).toBeLessThanOrEqual(63)
    }
  })

  it('matches snapshot for a full schema covering every field type', () => {
    const allFieldsConfig: Config = {
      secret: 'snapshot-secret',
      db: fakeAdapter,
      collections: [
        {
          slug: 'posts',
          versions: { drafts: true },
          fields: {
            title: { type: 'text', required: true, maxLength: 120 },
            views: { type: 'number', integer: true, defaultValue: 0 },
            score: { type: 'number', defaultValue: 1.5 },
            content: { type: 'textarea' },
            email: { type: 'email', unique: true },
            slug: { type: 'slug', unique: true },
            isFeatured: { type: 'checkbox', defaultValue: false },
            status: { type: 'select', options: ['draft', 'published'], defaultValue: 'draft' },
            publishedAt: { type: 'date' },
            body: { type: 'richText' },
            author: { type: 'relationship', relationTo: 'users' },
            categories: { type: 'relationship', relationTo: 'categories', hasMany: true },
            meta: {
              type: 'group',
              fields: {
                seoTitle: { type: 'text' },
                rating: { type: 'number' },
              },
            },
            items: {
              type: 'array',
              fields: { name: { type: 'text' } },
            },
            sections: {
              type: 'blocks',
              blocks: [
                {
                  slug: 'cta',
                  fields: { buttonText: { type: 'text' } },
                },
              ],
            },
          },
        },
        {
          slug: 'media',
          upload: true,
          fields: { alt: { type: 'text' } },
        },
      ],
      globals: [
        {
          slug: 'site_settings',
          versions: { drafts: true },
          fields: { siteName: { type: 'text', required: true } },
        },
      ],
    }

    const output = generateSchemaFile(allFieldsConfig)
    // Normalize absolute drizzle-orm import path to ensure snapshot is environment-independent
    const normalized = output.replace(
      /from\s+['"][^'"]*drizzle-orm\/pg-core[^'"]*['"]/,
      "from 'drizzle-orm/pg-core'",
    )
    expect(normalized).toMatchSnapshot()
  })

  it('drizzle-kit generate --dialect postgresql accepts the generated schema for every field type', () => {
    const allFieldsConfig: Config = {
      secret: 'test-secret',
      db: fakeAdapter,
      collections: [
        {
          slug: 'posts',
          versions: { drafts: true },
          fields: {
            title: { type: 'text', required: true, maxLength: 120 },
            views: { type: 'number', integer: true, defaultValue: 0 },
            score: { type: 'number', defaultValue: 1.5 },
            content: { type: 'textarea' },
            email: { type: 'email', unique: true },
            slug: { type: 'slug', unique: true },
            isFeatured: { type: 'checkbox', defaultValue: false },
            status: { type: 'select', options: ['draft', 'published'], defaultValue: 'draft' },
            publishedAt: { type: 'date' },
            body: { type: 'richText' },
            author: { type: 'relationship', relationTo: 'users' },
            categories: { type: 'relationship', relationTo: 'categories', hasMany: true },
            meta: {
              type: 'group',
              fields: {
                seoTitle: { type: 'text' },
                rating: { type: 'number' },
              },
            },
            items: {
              type: 'array',
              fields: { name: { type: 'text' } },
            },
            sections: {
              type: 'blocks',
              blocks: [
                {
                  slug: 'cta',
                  fields: { buttonText: { type: 'text' } },
                },
              ],
            },
          },
        },
        {
          slug: 'media',
          upload: true,
          versions: { drafts: true },
          fields: { alt: { type: 'text' } },
        },
      ],
      globals: [
        {
          slug: 'site_settings',
          versions: { drafts: true },
          fields: { siteName: { type: 'text', required: true } },
        },
      ],
    }

    const schema = generateSchemaFile(allFieldsConfig)
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'lontar-pg-schema-'))
    const schemaFile = path.join(tmpDir, 'schema.ts')
    const outDir = path.join(tmpDir, 'migrations')
    fs.writeFileSync(schemaFile, schema)

    try {
      const bin = findDrizzleKitBin()
      execFileSync(process.execPath, [
        bin,
        'generate',
        '--dialect',
        'postgresql',
        '--schema',
        schemaFile,
        '--out',
        outDir,
      ])

      const files = fs.readdirSync(outDir)
      const sqlFiles = files.filter((f) => f.endsWith('.sql'))
      expect(sqlFiles.length).toBeGreaterThan(0)

      const sqlContent = fs.readFileSync(path.join(outDir, sqlFiles[0]!), 'utf8')
      expect(sqlContent).toContain('CREATE TABLE "posts"')
      expect(sqlContent).toContain('CREATE TABLE "media"')
      expect(sqlContent).toContain('CREATE TABLE "media_versions"')
      expect(sqlContent).toContain('CREATE TABLE "posts_versions"')
      expect(sqlContent).toContain('CREATE TABLE "site_settings"')
      expect(sqlContent).toContain('CREATE TABLE "site_settings_versions"')
      expect(sqlContent).toContain('CREATE TABLE "posts_categories"')
      expect(sqlContent).toContain('CREATE TABLE "user"')
      expect(sqlContent).toContain('media_versions_filename_idx')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
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

    it('quotes column keys for locale codes that are not valid identifiers', () => {
      const output = generateSchemaFile({
        secret: 'test-secret',
        db: fakeAdapter,
        localization: { locales: ['en-US', 'id'], defaultLocale: 'en-US' },
        collections: [{ slug: 'pages', fields: { title: { type: 'text', localized: true } } }],
      })

      expect(output).toContain('"title_en-US": ')
      expect(output).toContain("'title_en-US'")
      expect(output).toContain('title_id: ')
      expect(output).not.toMatch(/^\s+title_en-US:/m)
    })

    it('generates per-locale columns and localized junction tables in output schema', () => {
      const output = generateSchemaFile(localizedBlogConfig)

      // Top-level localized fields
      expect(output).toContain("title_en: varchar('title_en', { length: 255 }),")
      expect(output).toContain("title_id: varchar('title_id', { length: 255 }),")
      expect(output).toContain("slug_en: varchar('slug_en', { length: 255 }).unique(),")
      expect(output).toContain("slug_id: varchar('slug_id', { length: 255 }).unique(),")
      expect(output).toContain("content_en: text('content_en'),")
      expect(output).toContain("content_id: text('content_id'),")
      expect(output).toContain("author_en: integer('author_en'),")
      expect(output).toContain("author_id: integer('author_id'),")
      expect(output).toContain("cover_en: integer('cover_en'),")
      expect(output).toContain("cover_id: integer('cover_id'),")

      // Non-localized stays flat
      expect(output).toContain("views: integer('views').default(0),")

      // Localized group flattens to per-locale columns
      expect(output).toContain("seo__metaTitle_en: varchar('seo__metaTitle_en', { length: 255 }),")
      expect(output).toContain("seo__metaTitle_id: varchar('seo__metaTitle_id', { length: 255 }),")

      // Localized container blocks generate per-locale JSONB columns
      expect(output).toContain("layout_en: jsonb('layout_en'),")
      expect(output).toContain("layout_id: jsonb('layout_id'),")

      // Shared container array with localized subfield generates single JSONB column
      expect(output).toContain("gallery: jsonb('gallery'),")

      // Localized junction table includes _locale and composite index/unique
      expect(output).toContain("export const postsTags = pgTable(\n  'posts_tags',")
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

    it('drizzle-kit generate --dialect postgresql accepts the generated localized schema and applies cleanly', async () => {
      const schema = generateSchemaFile(localizedBlogConfig)
      const tmpDir = fs.mkdtempSync(path.join('/tmp', 'lontar-pg-schema-'))
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
          'postgresql',
          '--schema',
          schemaFile,
          '--out',
          outDir,
        ])

        const files = fs.readdirSync(outDir)
        const sqlFiles = files.filter((f) => f.endsWith('.sql'))
        expect(sqlFiles.length).toBeGreaterThan(0)

        const sqlContent = fs.readFileSync(path.join(outDir, sqlFiles[0]!), 'utf8')
        expect(sqlContent).toContain('CREATE TABLE "posts"')
        expect(sqlContent).toContain('"title_en" varchar(255)')
        expect(sqlContent).toContain('"title_id" varchar(255)')
        expect(sqlContent).toContain('"slug_en" varchar(255)')
        expect(sqlContent).toContain('"slug_id" varchar(255)')
        expect(sqlContent).toContain('CREATE TABLE "posts_tags"')
        expect(sqlContent).toContain('"_locale" varchar(10) NOT NULL')
        expect(sqlContent).toContain('CREATE TABLE "site_settings"')
        expect(sqlContent).toContain('"siteName_en" varchar(255)')
        expect(sqlContent).toContain('"siteName_id" varchar(255)')

        if (await isPostgresAvailable()) {
          testDb = await setupTestDatabase()
          const adapter = postgresAdapter({ url: testDb.url })
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
