import { describe, expect, it } from 'vitest'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { getTableColumns } from 'drizzle-orm'
import type { CollectionConfig, GlobalConfig } from '@lontar/core'
import { collectionToTable, getCollectionJunctionTables, globalToTable } from './table'

function col(columns: Record<string, AnyMySqlColumn>, name: string): AnyMySqlColumn {
  const column = columns[name]
  if (!column) throw new Error(`Missing column: ${name}`)
  return column
}

describe('collectionToTable', () => {
  const posts: CollectionConfig = {
    slug: 'posts',
    fields: {
      title: { type: 'text', required: true, maxLength: 120 },
      views: { type: 'number', integer: true, defaultValue: 0 },
      content: { type: 'textarea', required: false },
      email: { type: 'email', required: true, unique: true },
      slug: { type: 'slug', unique: true, from: 'title' },
      isFeatured: { type: 'checkbox', defaultValue: false },
      status: {
        type: 'select',
        options: ['draft', 'published'],
        defaultValue: 'draft',
        required: true,
      },
      publishedAt: { type: 'date', required: true },
      body: {
        type: 'richText',
        required: true,
        defaultValue: { type: 'doc', content: [] },
      },
      author: {
        type: 'relationship',
        relationTo: 'users',
        required: true,
      },
      cover: {
        type: 'upload',
        relationTo: 'media',
        required: true,
      },
      categories: {
        type: 'relationship',
        relationTo: 'categories',
        hasMany: true,
      },
    },
  }

  it('includes system columns and all configured field columns', () => {
    const table = collectionToTable(posts)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(Object.keys(columns)).toEqual([
      'id',
      'title',
      'views',
      'content',
      'email',
      'slug',
      'isFeatured',
      'status',
      'publishedAt',
      'body',
      'author',
      'cover',
      'createdAt',
      'updatedAt',
    ])
    expect(col(columns, 'id').primary).toBe(true)
    expect(col(columns, 'createdAt').notNull).toBe(true)
    expect(col(columns, 'updatedAt').notNull).toBe(true)
  })

  it('configures constraints and defaults on custom fields', () => {
    const table = collectionToTable(posts)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'title').notNull).toBe(true)
    expect(col(columns, 'views').notNull).toBe(false)
    expect(col(columns, 'views').hasDefault).toBe(true)
    expect(col(columns, 'content').notNull).toBe(false)
    expect(col(columns, 'email').notNull).toBe(true)
    expect(col(columns, 'email').isUnique).toBe(true)
    expect(col(columns, 'slug').notNull).toBe(false)
    expect(col(columns, 'slug').isUnique).toBe(true)
    expect(col(columns, 'isFeatured').columnType).toBe('MySqlBoolean')
    expect(col(columns, 'isFeatured').hasDefault).toBe(true)
    expect(col(columns, 'status').columnType).toBe('MySqlVarChar')
    expect(col(columns, 'status').notNull).toBe(true)
    expect(col(columns, 'status').hasDefault).toBe(true)
    expect(col(columns, 'publishedAt').columnType).toBe('MySqlTimestamp')
    expect(col(columns, 'publishedAt').notNull).toBe(true)
    expect(col(columns, 'body').columnType).toBe('MySqlJson')
    expect(col(columns, 'body').notNull).toBe(true)
    expect(col(columns, 'body').hasDefault).toBe(true)
    expect(col(columns, 'author').columnType).toBe('MySqlInt')
    expect(col(columns, 'author').notNull).toBe(true)
    expect(col(columns, 'cover').columnType).toBe('MySqlInt')
    expect(col(columns, 'cover').notNull).toBe(true)
  })

  it('creates automatic upload columns when upload is enabled on collection', () => {
    const media: CollectionConfig = {
      slug: 'media',
      upload: true,
      fields: {
        alt: { type: 'text', required: true },
      },
    }

    const table = collectionToTable(media)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(Object.keys(columns)).toEqual([
      'id',
      'filename',
      'url',
      'mimeType',
      'filesize',
      'width',
      'height',
      'sizes',
      'alt',
      'createdAt',
      'updatedAt',
    ])
    expect(col(columns, 'filename').notNull).toBe(true)
    expect(col(columns, 'url').notNull).toBe(true)
    expect(col(columns, 'mimeType').notNull).toBe(true)
    expect(col(columns, 'filesize').notNull).toBe(true)
    expect(col(columns, 'width').notNull).toBe(false)
    expect(col(columns, 'height').notNull).toBe(false)
    expect(col(columns, 'sizes').columnType).toBe('MySqlJson')
    expect(col(columns, 'sizes').notNull).toBe(false)
  })

  it('creates junction tables for hasMany relationships', () => {
    const junctionTables = getCollectionJunctionTables(posts)
    expect(junctionTables.categories).toBeDefined()
    const columns = getTableColumns(junctionTables.categories!) as Record<string, AnyMySqlColumn>
    expect(Object.keys(columns)).toEqual(['id', 'parentId', 'targetId', 'order'])
    expect(col(columns, 'id').primary).toBe(true)
    expect(col(columns, 'parentId').notNull).toBe(true)
    expect(col(columns, 'targetId').notNull).toBe(true)
    expect(col(columns, 'order').notNull).toBe(true)
  })

  it('creates table for globals with globalToTable', () => {
    const header: GlobalConfig = {
      slug: 'header',
      fields: {
        siteTitle: { type: 'text', required: true },
        navLinksCount: { type: 'number', integer: true },
      },
    }

    const table = globalToTable(header)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(Object.keys(columns)).toEqual([
      'id',
      'siteTitle',
      'navLinksCount',
      'createdAt',
      'updatedAt',
    ])
    expect(col(columns, 'id').primary).toBe(true)
    expect(col(columns, 'siteTitle').notNull).toBe(true)
  })
})
