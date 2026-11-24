import { describe, expect, it } from 'vitest'
import { getTableConfig, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { getTableColumns } from 'drizzle-orm'
import type { CollectionConfig, GlobalConfig } from '@lontar/core'
import {
  collectionToTable,
  createJunctionTable,
  createVersionsTable,
  getCollectionJunctionTables,
  getCollectionVersionsTable,
  getJunctionParentLocaleOrderIndexName,
  getJunctionParentLocaleTargetUniqueName,
  getVersionsParentForeignKeyName,
  getVersionsParentVersionUniqueName,
  getVersionsParentIdIndexName,
  getVersionsParentStatusIndexName,
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

  it('creates columns for code fields (ADR 0031)', () => {
    const snippets: CollectionConfig = {
      slug: 'snippets',
      fields: {
        code: { type: 'code', required: true },
        script: { type: 'code', defaultValue: 'console.log("hi")' },
      },
    }

    const table = collectionToTable(snippets)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'code').notNull).toBe(true)
    expect(col(columns, 'script').notNull).toBe(false)
    expect(col(columns, 'script').hasDefault).toBe(true)
  })

  it('creates columns for json fields (ADR 0031)', () => {
    const snippets: CollectionConfig = {
      slug: 'snippets',
      fields: {
        config: { type: 'json', required: true },
        metadata: { type: 'json' },
      },
    }

    const table = collectionToTable(snippets)
    const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

    expect(col(columns, 'config').columnType).toBe('MySqlJson')
    expect(col(columns, 'config').notNull).toBe(true)
    expect(col(columns, 'metadata').columnType).toBe('MySqlJson')
    expect(col(columns, 'metadata').notNull).toBe(false)
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
    expect(config.uniqueConstraints.map((u) => u.name)).toContain(
      'posts_versions_parent_version_unique',
    )
    expect(config.foreignKeys).toHaveLength(1)
    expect(config.foreignKeys[0]?.getName()).toBe('posts_versions_parent_id_posts_id_fk')
  })

  it('truncates foreign key, unique constraint, and index names when they exceed MySQL 64-character identifier limit', () => {
    const slug = 'very-long-newsletter-campaigns-and-marketing-slug'
    const parentTable = collectionToTable({
      slug,
      fields: { title: { type: 'text', required: true } },
    })
    const vTable = createVersionsTable(slug, parentTable)
    const config = getTableConfig(vTable)
    expect(config.foreignKeys).toHaveLength(1)
    const fkName = config.foreignKeys[0]?.getName() ?? ''
    expect(fkName.length).toBeLessThanOrEqual(64)
    expect(fkName).toMatch(/_[a-f0-9]{8}_fk$/)

    expect(config.uniqueConstraints).toHaveLength(1)
    const uqName = config.uniqueConstraints[0]?.name ?? ''
    expect(uqName.length).toBeLessThanOrEqual(64)
    expect(uqName).toMatch(/_[a-f0-9]{8}_unique$/)

    expect(config.indexes).toHaveLength(2)
    for (const idx of config.indexes) {
      const idxName = idx.config.name
      expect(idxName.length).toBeLessThanOrEqual(64)
      expect(idxName).toMatch(/_[a-f0-9]{8}_idx$/)
    }
  })

  it('getVersionsParentForeignKeyName returns exact name when <= 64 and hashes when > 64', () => {
    expect(getVersionsParentForeignKeyName('posts')).toBe('posts_versions_parent_id_posts_id_fk')
    const longName = getVersionsParentForeignKeyName(
      'very-long-newsletter-campaigns-and-marketing-slug',
    )
    expect(longName.length).toBeLessThanOrEqual(64)
    expect(longName).toMatch(/_[a-f0-9]{8}_fk$/)
  })

  it('getVersionsParentVersionUniqueName returns exact name when <= 64 and hashes when > 64', () => {
    expect(getVersionsParentVersionUniqueName('posts')).toBe('posts_versions_parent_version_unique')
    const longName = getVersionsParentVersionUniqueName(
      'very-long-newsletter-campaigns-and-marketing-slug',
    )
    expect(longName.length).toBeLessThanOrEqual(64)
    expect(longName).toMatch(/_[a-f0-9]{8}_unique$/)
  })

  it('getVersionsParentIdIndexName returns exact name when <= 64 and hashes when > 64', () => {
    expect(getVersionsParentIdIndexName('posts')).toBe('posts_versions_parent_id_idx')
    const longName = getVersionsParentIdIndexName(
      'very-long-newsletter-campaigns-and-marketing-slug',
    )
    expect(longName.length).toBeLessThanOrEqual(64)
    expect(longName).toMatch(/_[a-f0-9]{8}_idx$/)
  })

  it('getVersionsParentStatusIndexName returns exact name when <= 64 and hashes when > 64', () => {
    expect(getVersionsParentStatusIndexName('posts')).toBe('posts_versions_parent_status_idx')
    const slug38 = 'newsletter-campaign-delivery-schedules'
    expect(slug38.length).toBe(38)
    const longName = getVersionsParentStatusIndexName(slug38)
    expect(longName.length).toBeLessThanOrEqual(64)
    expect(longName).toMatch(/_[a-f0-9]{8}_idx$/)
  })

  it('getCollectionVersionsTable returns null when versions is not configured', () => {
    expect(getCollectionVersionsTable({ slug: 'posts', fields: {} })).toBeNull()
  })

  describe('localization schema generation', () => {
    const localizedPosts: CollectionConfig = {
      slug: 'posts',
      fields: {
        title: { type: 'text', required: true, localized: true },
        slug: { type: 'slug', required: true, unique: true, localized: true },
        summary: { type: 'textarea', localized: true },
        views: { type: 'number', integer: true, defaultValue: 0 }, // shared
        author: { type: 'relationship', relationTo: 'users', localized: true },
        cover: { type: 'upload', relationTo: 'media', localized: true },
        seo: {
          type: 'group',
          localized: true,
          fields: {
            metaTitle: { type: 'text', required: true },
            metaDesc: { type: 'textarea' },
          },
        },
        social: {
          type: 'group',
          fields: {
            shareText: { type: 'text', localized: true },
            ogImage: { type: 'upload', relationTo: 'media' }, // shared inside group
          },
        },
        layout: {
          type: 'blocks',
          localized: true,
          blocks: [{ slug: 'hero', fields: { heading: { type: 'text' } } }],
        },
        gallery: {
          type: 'array',
          fields: {
            image: { type: 'upload', relationTo: 'media' },
            caption: { type: 'text', localized: true }, // subfield localized, container shared
          },
        },
        tags: {
          type: 'relationship',
          relationTo: 'tags',
          hasMany: true,
          localized: true,
        },
      },
    }

    it('generates per-locale columns for localized fields while keeping shared fields flat', () => {
      const table = collectionToTable(localizedPosts, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

      // Top-level localized fields
      expect(col(columns, 'title_en')).toBeDefined()
      expect(col(columns, 'title_id')).toBeDefined()
      expect(col(columns, 'slug_en')).toBeDefined()
      expect(col(columns, 'slug_id')).toBeDefined()
      expect(col(columns, 'summary_en')).toBeDefined()
      expect(col(columns, 'summary_id')).toBeDefined()
      expect(col(columns, 'author_en')).toBeDefined()
      expect(col(columns, 'author_id')).toBeDefined()
      expect(col(columns, 'cover_en')).toBeDefined()
      expect(col(columns, 'cover_id')).toBeDefined()

      // Shared fields are not duplicated
      expect(columns.title).toBeUndefined()
      expect(columns.slug).toBeUndefined()
      expect(col(columns, 'views')).toBeDefined()

      // Localized group flattens to per-locale columns
      expect(col(columns, 'seo__metaTitle_en')).toBeDefined()
      expect(col(columns, 'seo__metaTitle_id')).toBeDefined()
      expect(col(columns, 'seo__metaDesc_en')).toBeDefined()
      expect(col(columns, 'seo__metaDesc_id')).toBeDefined()

      // Non-localized group with localized subfield
      expect(col(columns, 'social__shareText_en')).toBeDefined()
      expect(col(columns, 'social__shareText_id')).toBeDefined()
      expect(col(columns, 'social__ogImage')).toBeDefined() // shared inside group

      // Container blocks with localized: true generates per-locale JSON columns
      expect(col(columns, 'layout_en').columnType).toBe('MySqlJson')
      expect(col(columns, 'layout_id').columnType).toBe('MySqlJson')
      expect(columns.layout).toBeUndefined()

      // Container array without localized: true generates a single JSON column
      expect(col(columns, 'gallery').columnType).toBe('MySqlJson')
      expect(columns.gallery_en).toBeUndefined()
      expect(columns.gallery_id).toBeUndefined()
    })

    it('enforces that localized columns in the database are nullable even when required: true', () => {
      const table = collectionToTable(localizedPosts, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

      // Localized columns must be nullable in the DB so documents can be created in any locale
      expect(col(columns, 'title_en').notNull).toBe(false)
      expect(col(columns, 'title_id').notNull).toBe(false)
      expect(col(columns, 'slug_en').notNull).toBe(false)
      expect(col(columns, 'slug_id').notNull).toBe(false)
      expect(col(columns, 'seo__metaTitle_en').notNull).toBe(false)
      expect(col(columns, 'seo__metaTitle_id').notNull).toBe(false)
    })

    it('enforces unique constraints per locale on localized slug fields', () => {
      const table = collectionToTable(localizedPosts, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

      expect(col(columns, 'slug_en').isUnique).toBe(true)
      expect(col(columns, 'slug_id').isUnique).toBe(true)
    })

    it('creates localized junction table with _locale column and composite unique/index', () => {
      const junctionTables = getCollectionJunctionTables(localizedPosts)
      const tagsJunction = junctionTables.tags
      expect(tagsJunction).toBeDefined()

      const columns = getTableColumns(tagsJunction!) as Record<string, AnyMySqlColumn>
      expect(col(columns, 'parentId').columnType).toBe('MySqlInt')
      expect(col(columns, 'targetId').columnType).toBe('MySqlInt')
      expect(col(columns, '_locale').columnType).toBe('MySqlVarChar')
      expect(col(columns, 'order').columnType).toBe('MySqlInt')

      const config = getTableConfig(tagsJunction!)
      expect(config.name).toBe('posts_tags')
      expect(config.indexes.map((i) => i.config.name)).toContain(
        'posts_tags_parent_locale_order_idx',
      )
      expect(config.uniqueConstraints.map((u) => u.name)).toContain(
        'posts_tags_parent_locale_target_unique',
      )
    })

    it('truncates junction table index and unique names when length exceeds MySQL 64 chars', () => {
      const longName = 'long_newsletter_campaign_recipient_tracking_records'
      const orderIdx = getJunctionParentLocaleOrderIndexName(longName)
      const targetUq = getJunctionParentLocaleTargetUniqueName(longName)

      expect(orderIdx.length).toBeLessThanOrEqual(64)
      expect(orderIdx).toMatch(/_[a-f0-9]{8}_idx$/)
      expect(targetUq.length).toBeLessThanOrEqual(64)
      expect(targetUq).toMatch(/_[a-f0-9]{8}_unique$/)

      const jTable = createJunctionTable(longName, true)
      const conf = getTableConfig(jTable)
      expect(conf.indexes.map((i) => i.config.name)).toContain(orderIdx)
      expect(conf.uniqueConstraints.map((u) => u.name)).toContain(targetUq)
    })

    it('creates localized upload collection keeping system file columns shared', () => {
      const mediaCol: CollectionConfig = {
        slug: 'media',
        upload: true,
        fields: {
          alt: { type: 'text', localized: true },
          caption: { type: 'textarea', localized: true },
        },
      }
      const table = collectionToTable(mediaCol, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

      // Upload system columns are shared
      expect(col(columns, 'filename')).toBeDefined()
      expect(col(columns, 'url')).toBeDefined()
      expect(col(columns, 'mimeType')).toBeDefined()
      expect(col(columns, 'filesize')).toBeDefined()

      // Metadata columns are per-locale
      expect(col(columns, 'alt_en')).toBeDefined()
      expect(col(columns, 'alt_id')).toBeDefined()
      expect(col(columns, 'caption_en')).toBeDefined()
      expect(col(columns, 'caption_id')).toBeDefined()
    })

    it('creates localized globals with per-locale columns', () => {
      const headerGlobal: GlobalConfig = {
        slug: 'header',
        fields: {
          siteTitle: { type: 'text', localized: true, required: true },
          announcement: { type: 'text', localized: true },
          logoId: { type: 'upload', relationTo: 'media' }, // shared
        },
      }
      const table = globalToTable(headerGlobal, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>

      expect(col(columns, 'siteTitle_en')).toBeDefined()
      expect(col(columns, 'siteTitle_id')).toBeDefined()
      expect(col(columns, 'announcement_en')).toBeDefined()
      expect(col(columns, 'announcement_id')).toBeDefined()
      expect(col(columns, 'logoId')).toBeDefined()
    })
  })
})
