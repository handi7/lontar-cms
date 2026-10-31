import { describe, expect, it } from 'vitest'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { getTableColumns } from 'drizzle-orm'
import type { CollectionConfig } from '@lontar/core'
import { collectionToTable } from './table'

describe('collectionToTable', () => {
  it('builds table with system fields and fields', () => {
    const posts: CollectionConfig = {
      slug: 'posts',
      fields: {
        title: { type: 'text', required: true, maxLength: 120 },
        views: { type: 'number', integer: true, defaultValue: 0 },
      },
    }

    const table = collectionToTable(posts)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(Object.keys(columns)).toEqual(['id', 'title', 'views', 'createdAt', 'updatedAt'])
    expect(columns.id?.primary).toBe(true)
    expect(columns.title?.notNull).toBe(true)
    expect(columns.views?.notNull).toBe(false)
    expect(columns.views?.hasDefault).toBe(true)
    expect(columns.createdAt?.notNull).toBe(true)
    expect(columns.updatedAt?.notNull).toBe(true)
  })
})
