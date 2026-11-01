import { describe, expect, it } from 'vitest'
import type { CollectionConfig, Config, DatabaseAdapter } from '@lontar/core'
import { generateSchemaFile, slugToIdentifier } from './generator'

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

    expect(output).toContain(
      "import { boolean, index, int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'",
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
    expect(output).toContain(
      "import { boolean, index, int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'",
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
    expect(output).toContain(
      "import { boolean, index, int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'",
    )
    expect(output).toContain("isPublished: boolean('isPublished').default(false),")
    expect(output).toContain(
      'status: varchar(\'status\', { length: 120 }).default("draft").notNull(),',
    )
    expect(output).toContain(
      'publishedAt: timestamp(\'publishedAt\').default(new Date("2026-11-01T00:00:00.000Z")).notNull(),',
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
    expect(output).toContain(
      "import { boolean, index, int, json, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'",
    )
    expect(output).toContain(
      'content: json(\'content\').default({"type":"doc","content":[]}).notNull(),',
    )
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
})
