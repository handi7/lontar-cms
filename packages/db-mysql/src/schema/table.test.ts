import { describe, expect, it } from 'vitest'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { getTableColumns } from 'drizzle-orm'
import type { CollectionConfig } from '@lontar/core'
import { collectionToTable } from './table'

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
  })
})
