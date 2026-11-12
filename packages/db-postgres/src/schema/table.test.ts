import { describe, expect, it } from 'vitest'
import { getTableConfig, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { getTableColumns } from 'drizzle-orm'
import type { CollectionConfig, GlobalConfig } from '@lontar/core'
import {
  collectionToTable,
  createVersionsTable,
  getCollectionJunctionTables,
  getCollectionVersionsTable,
  getVersionsParentForeignKeyName,
  getVersionsParentIdIndexName,
  getVersionsParentStatusIndexName,
  getVersionsParentVersionUniqueName,
  globalToTable,
} from './table'

function col(columns: Record<string, AnyPgColumn>, name: string): AnyPgColumn {
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
      score: { type: 'number', required: false },
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(Object.keys(columns)).toEqual([
      'id',
      'title',
      'views',
      'score',
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'title').columnType).toBe('PgVarchar')
    expect(col(columns, 'title').notNull).toBe(true)
    expect(col(columns, 'views').columnType).toBe('PgInteger')
    expect(col(columns, 'views').notNull).toBe(false)
    expect(col(columns, 'views').hasDefault).toBe(true)
    expect(col(columns, 'score').columnType).toBe('PgDoublePrecision')
    expect(col(columns, 'score').notNull).toBe(false)
    expect(col(columns, 'content').columnType).toBe('PgText')
    expect(col(columns, 'content').notNull).toBe(false)
    expect(col(columns, 'email').columnType).toBe('PgVarchar')
    expect(col(columns, 'email').notNull).toBe(true)
    expect(col(columns, 'email').isUnique).toBe(true)
    expect(col(columns, 'slug').columnType).toBe('PgVarchar')
    expect(col(columns, 'slug').notNull).toBe(false)
    expect(col(columns, 'slug').isUnique).toBe(true)
    expect(col(columns, 'isFeatured').columnType).toBe('PgBoolean')
    expect(col(columns, 'isFeatured').hasDefault).toBe(true)
    expect(col(columns, 'status').columnType).toBe('PgVarchar')
    expect(col(columns, 'status').notNull).toBe(true)
    expect(col(columns, 'status').hasDefault).toBe(true)
    expect(col(columns, 'publishedAt').columnType).toBe('PgTimestamp')
    expect(col(columns, 'publishedAt').notNull).toBe(true)
    expect(col(columns, 'body').columnType).toBe('PgJsonb')
    expect(col(columns, 'body').notNull).toBe(true)
    expect(col(columns, 'body').hasDefault).toBe(true)
    expect(col(columns, 'author').columnType).toBe('PgInteger')
    expect(col(columns, 'author').notNull).toBe(true)
    expect(col(columns, 'cover').columnType).toBe('PgInteger')
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

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
    expect(col(columns, 'filesize').columnType).toBe('PgInteger')
    expect(col(columns, 'filesize').notNull).toBe(true)
    expect(col(columns, 'width').columnType).toBe('PgInteger')
    expect(col(columns, 'width').notNull).toBe(false)
    expect(col(columns, 'height').columnType).toBe('PgInteger')
    expect(col(columns, 'height').notNull).toBe(false)
    expect(col(columns, 'sizes').columnType).toBe('PgJsonb')
    expect(col(columns, 'sizes').notNull).toBe(false)
  })

  it('creates junction tables for hasMany relationships', () => {
    const junctionTables = getCollectionJunctionTables(posts)
    expect(junctionTables.categories).toBeDefined()
    const columns = getTableColumns(junctionTables.categories!) as Record<string, AnyPgColumn>
    expect(Object.keys(columns)).toEqual(['id', 'parentId', 'targetId', 'order'])
    expect(col(columns, 'id').columnType).toBe('PgSerial')
    expect(col(columns, 'id').primary).toBe(true)
    expect(col(columns, 'parentId').columnType).toBe('PgInteger')
    expect(col(columns, 'parentId').notNull).toBe(true)
    expect(col(columns, 'targetId').columnType).toBe('PgInteger')
    expect(col(columns, 'targetId').notNull).toBe(true)
    expect(col(columns, 'order').columnType).toBe('PgInteger')
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

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

  it('maps array field to PgJsonb column', () => {
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'gallery').columnType).toBe('PgJsonb')
    expect(col(columns, 'gallery').notNull).toBe(true)
  })

  it('maps blocks field to PgJsonb column', () => {
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'layout').columnType).toBe('PgJsonb')
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'videoUrl').notNull).toBe(false)
    expect(col(columns, 'videoSettings__duration').notNull).toBe(false)
  })

  it('creates _status column and index when versions.drafts is enabled', () => {
    const table = collectionToTable({
      slug: 'articles',
      versions: { drafts: true },
      fields: { title: { type: 'text', required: true } },
    })
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>
    expect(col(columns, '_status').columnType).toBe('PgVarchar')
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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>
    expect(col(columns, '_status').columnType).toBe('PgVarchar')
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
    const columns = getTableColumns(vTable) as Record<string, AnyPgColumn>

    expect(col(columns, 'id').columnType).toBe('PgSerial')
    expect(col(columns, 'parentId').columnType).toBe('PgInteger')
    expect(col(columns, 'versionNumber').columnType).toBe('PgInteger')
    expect(col(columns, 'snapshot').columnType).toBe('PgJsonb')
    expect(col(columns, '_status').columnType).toBe('PgVarchar')
    expect(col(columns, 'autosave').columnType).toBe('PgBoolean')
    expect(col(columns, 'createdAt').columnType).toBe('PgTimestamp')
    expect(col(columns, 'createdBy').columnType).toBe('PgVarchar')

    const config = getTableConfig(vTable)
    expect(config.name).toBe('posts_versions')
    expect(config.indexes.map((i) => i.config.name)).toContain('posts_versions_parent_id_idx')
    expect(config.indexes.map((i) => i.config.name)).toContain('posts_versions_parent_status_idx')
    expect(config.uniqueConstraints.map((u) => u.name)).toContain(
      'posts_versions_parent_version_unique',
    )
    expect(config.foreignKeys).toHaveLength(1)
    expect(config.foreignKeys[0]?.getName()).toBe('posts_versions_parent_id_posts_id_fk')
  })

  it('truncates foreign key, unique constraint, and index names when they exceed PostgreSQL 63-character identifier limit', () => {
    const slug = 'very-long-newsletter-campaigns-and-marketing-slug'
    const parentTable = collectionToTable({
      slug,
      fields: { title: { type: 'text', required: true } },
    })
    const vTable = createVersionsTable(slug, parentTable)
    const config = getTableConfig(vTable)
    expect(config.foreignKeys).toHaveLength(1)
    const fkName = config.foreignKeys[0]?.getName() ?? ''
    expect(fkName.length).toBeLessThanOrEqual(63)
    expect(fkName).toMatch(/_[a-f0-9]{8}_fk$/)

    expect(config.uniqueConstraints).toHaveLength(1)
    const uqName = config.uniqueConstraints[0]?.name ?? ''
    expect(uqName.length).toBeLessThanOrEqual(63)
    expect(uqName).toMatch(/_[a-f0-9]{8}_unique$/)

    expect(config.indexes).toHaveLength(2)
    for (const idx of config.indexes) {
      const idxName = idx.config.name
      expect(idxName).toBeDefined()
      expect(idxName!.length).toBeLessThanOrEqual(63)
      expect(idxName!).toMatch(/_[a-f0-9]{8}_idx$/)
    }
  })

  it('getVersionsParentForeignKeyName returns exact name when <= 63 and hashes when > 63', () => {
    expect(getVersionsParentForeignKeyName('posts')).toBe('posts_versions_parent_id_posts_id_fk')
    const longName = getVersionsParentForeignKeyName(
      'very-long-newsletter-campaigns-and-marketing-slug',
    )
    expect(longName.length).toBeLessThanOrEqual(63)
    expect(longName).toMatch(/_[a-f0-9]{8}_fk$/)
  })

  it('getVersionsParentVersionUniqueName returns exact name when <= 63 and hashes when > 63', () => {
    expect(getVersionsParentVersionUniqueName('posts')).toBe('posts_versions_parent_version_unique')
    const longName = getVersionsParentVersionUniqueName(
      'very-long-newsletter-campaigns-and-marketing-slug',
    )
    expect(longName.length).toBeLessThanOrEqual(63)
    expect(longName).toMatch(/_[a-f0-9]{8}_unique$/)
  })

  it('getVersionsParentIdIndexName returns exact name when <= 63 and hashes when > 63', () => {
    expect(getVersionsParentIdIndexName('posts')).toBe('posts_versions_parent_id_idx')
    const longName = getVersionsParentIdIndexName(
      'very-long-newsletter-campaigns-and-marketing-slug',
    )
    expect(longName.length).toBeLessThanOrEqual(63)
    expect(longName).toMatch(/_[a-f0-9]{8}_idx$/)
  })

  it('getVersionsParentStatusIndexName returns exact name when <= 63 and hashes when > 63', () => {
    expect(getVersionsParentStatusIndexName('posts')).toBe('posts_versions_parent_status_idx')
    const slug38 = 'newsletter-campaign-delivery-schedules'
    expect(slug38.length).toBe(38)
    const longName = getVersionsParentStatusIndexName(slug38)
    expect(longName.length).toBeLessThanOrEqual(63)
    expect(longName).toMatch(/_[a-f0-9]{8}_idx$/)
  })

  it('getCollectionVersionsTable returns null when versions is not configured', () => {
    expect(getCollectionVersionsTable({ slug: 'posts', fields: {} })).toBeNull()
  })
})
