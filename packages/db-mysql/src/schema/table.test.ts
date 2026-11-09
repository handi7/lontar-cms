import { describe, expect, it } from 'vitest'
import { getTableConfig, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { getTableColumns } from 'drizzle-orm'
import type { CollectionConfig, GlobalConfig } from '@lontar/core'
import {
  collectionToTable,
  createVersionsTable,
  getCollectionJunctionTables,
  getCollectionVersionsTable,
  globalToTable,
} from './table'

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
    expect(col(columns, 'publishedAt').columnType).toBe('MySqlDateTime')
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

    const config = getTableConfig(junctionTables.categories!)
    expect(config.indexes.map((i) => i.config.name)).toEqual([
      'posts_categories_parent_idx',
      'posts_categories_target_idx',
    ])
    expect(config.uniqueConstraints.map((u) => u.name)).toEqual([
      'posts_categories_parent_target_unique',
    ])
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

  it('maps array field to MySqlJson column', () => {
    const portfolio: CollectionConfig = {
      slug: 'portfolio',
      fields: {
        gallery: {
          type: 'array',
          required: true,
          fields: {
            caption: { type: 'text' },
          },
        },
      },
    }

    const table = collectionToTable(portfolio)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'gallery').columnType).toBe('MySqlJson')
    expect(col(columns, 'gallery').notNull).toBe(true)
  })

  it('maps blocks field to MySqlJson column', () => {
    const pages: CollectionConfig = {
      slug: 'pages',
      fields: {
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

    const table = collectionToTable(pages)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'layout').columnType).toBe('MySqlJson')
    expect(col(columns, 'layout').notNull).toBe(true)
  })

  it('treats fields with admin.condition as nullable regardless of required: true', () => {
    const postsWithConditional: CollectionConfig = {
      slug: 'posts',
      fields: {
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
        videoSettings: {
          type: 'group',
          admin: { condition: { format: { equals: 'video' } } },
          fields: {
            duration: { type: 'number', required: true },
          },
        },
      },
    }

    const table = collectionToTable(postsWithConditional)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'videoUrl').notNull).toBe(false)
    expect(col(columns, 'videoSettings__duration').notNull).toBe(false)
  })

  it('creates _status column and index when versions.drafts is enabled', () => {
    const table = collectionToTable({
      slug: 'articles',
      versions: { drafts: true },
      fields: { title: { type: 'text', required: true } },
    })
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>
    expect(col(columns, '_status').columnType).toBe('MySqlVarChar')
    expect(col(columns, '_status').notNull).toBe(true)
    expect(col(columns, '_status').hasDefault).toBe(true)

    const config = getTableConfig(table)
    expect(config.indexes.map((i) => i.config.name)).toContain('articles__status_idx')
  })

  it('creates _status column and index on globals when versions.drafts is enabled', () => {
    const table = globalToTable({
      slug: 'site_settings',
      versions: { drafts: true },
      fields: { siteTitle: { type: 'text', required: true } },
    })
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>
    expect(col(columns, '_status').columnType).toBe('MySqlVarChar')
    expect(col(columns, '_status').notNull).toBe(true)

    const config = getTableConfig(table)
    expect(config.indexes.map((i) => i.config.name)).toContain('site_settings__status_idx')
  })

  it('creates versions table schema with parent FK, indexes, and columns', () => {
    const parentTable = collectionToTable({
      slug: 'posts',
      fields: { title: { type: 'text', required: true } },
    })
    const vTable = createVersionsTable('posts', parentTable)
    const columns = getTableColumns(vTable) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'id').columnType).toBe('MySqlInt')
    expect(col(columns, 'parentId').columnType).toBe('MySqlInt')
    expect(col(columns, 'versionNumber').columnType).toBe('MySqlInt')
    expect(col(columns, 'snapshot').columnType).toBe('MySqlJson')
    expect(col(columns, '_status').columnType).toBe('MySqlVarChar')
    expect(col(columns, 'autosave').columnType).toBe('MySqlBoolean')
    expect(col(columns, 'createdAt').columnType).toBe('MySqlTimestamp')
    expect(col(columns, 'createdBy').columnType).toBe('MySqlVarChar')

    const config = getTableConfig(vTable)
    expect(config.name).toBe('posts_versions')
    expect(config.indexes.map((i) => i.config.name)).toContain('posts_versions_parent_id_idx')
    expect(config.indexes.map((i) => i.config.name)).toContain('posts_versions_parent_status_idx')
  })

  it('getCollectionVersionsTable returns null when versions is not configured', () => {
    expect(getCollectionVersionsTable({ slug: 'posts', fields: {} })).toBeNull()
  })
})
