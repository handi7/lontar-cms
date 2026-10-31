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
      "import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core'",
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
      "import { int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'",
    )
    expect(output).toContain('bio: text(\'bio\').default("Nothing here yet"),')
    expect(output).toContain("email: varchar('email', { length: 255 }).unique().notNull(),")
    expect(output).toContain("slug: varchar('slug', { length: 255 }).unique(),")
  })
})
