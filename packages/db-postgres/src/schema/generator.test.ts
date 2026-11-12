import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import type { CollectionConfig, Config, DatabaseAdapter, GlobalConfig } from '@lontar/core'
import { findDrizzleKitBin } from '@lontar/db-test-suite'
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
      /import \{ boolean, index, integer, pgTable, serial, text, timestamp, varchar \} from '.*drizzle-orm\/pg-core/,
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
        email: { type: 'email', unique: true },
        slug: { type: 'slug', unique: true },
        isFeatured: { type: 'checkbox', defaultValue: false },
        category: { type: 'select', options: ['news', 'tech'], defaultValue: 'news' },
        publishedAt: { type: 'date' },
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
    expect(output).toContain("email: varchar('email', { length: 255 }).unique(),")
    expect(output).toContain("slug: varchar('slug', { length: 255 }).unique(),")
    expect(output).toContain("isFeatured: boolean('isFeatured').default(false),")
    expect(output).toContain('category: varchar(\'category\', { length: 120 }).default("news"),')
    expect(output).toContain(
      "publishedAt: timestamp('publishedAt', { precision: 3, withTimezone: true, mode: 'date' }),",
    )
    expect(output).toContain("body: jsonb('body'),")
    expect(output).toContain("author: integer('author').notNull(),")
    expect(output).toContain("cover: integer('cover'),")
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

    expect(output).toContain("export const user = pgTable('user', {")
    expect(output).toContain("export const session = pgTable(\n  'session',")
    expect(output).toContain("export const account = pgTable(\n  'account',")
    expect(output).toContain("export const verification = pgTable(\n  'verification',")
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
      expect(sqlContent).toContain('CREATE TABLE "posts_versions"')
      expect(sqlContent).toContain('CREATE TABLE "site_settings"')
      expect(sqlContent).toContain('CREATE TABLE "site_settings_versions"')
      expect(sqlContent).toContain('CREATE TABLE "posts_categories"')
      expect(sqlContent).toContain('CREATE TABLE "user"')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
