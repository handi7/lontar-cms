import { describe, expect, it } from 'vitest'
import { getTableConfig, type AnyPgColumn } from 'drizzle-orm/pg-core'
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
  getVersionsFilenameIndexName,
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

  it('creates columns for code fields (ADR 0031)', () => {
    const snippets: CollectionConfig = {
      slug: 'snippets',
      fields: {
        code: { type: 'code', required: true },
        script: { type: 'code', defaultValue: 'console.log("hi")' },
      },
    }

    const table = collectionToTable(snippets)
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

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
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'config').columnType).toBe('PgJsonb')
    expect(col(columns, 'config').notNull).toBe(true)
    expect(col(columns, 'metadata').columnType).toBe('PgJsonb')
    expect(col(columns, 'metadata').notNull).toBe(false)
  })

  it('creates columns for radio fields (ADR 0031)', () => {
    const polls: CollectionConfig = {
      slug: 'polls',
      fields: {
        choice: {
          type: 'radio',
          options: ['yes', 'no'],
          defaultValue: 'yes',
          required: true,
        },
        optionalChoice: {
          type: 'radio',
          options: ['a', 'b'],
        },
      },
    }

    const table = collectionToTable(polls)
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'choice').columnType).toBe('PgVarchar')
    expect(col(columns, 'choice').notNull).toBe(true)
    expect(col(columns, 'choice').hasDefault).toBe(true)
    expect(col(columns, 'optionalChoice').columnType).toBe('PgVarchar')
    expect(col(columns, 'optionalChoice').notNull).toBe(false)
  })

  it('creates columns for point fields (ADR 0031)', () => {
    const places: CollectionConfig = {
      slug: 'places',
      fields: {
        location: {
          type: 'point',
          required: true,
        },
        optionalLocation: {
          type: 'point',
        },
      },
    }

    const table = collectionToTable(places)
    const columns = getTableColumns(table) as Record<string, AnyPgColumn>

    expect(col(columns, 'location__lng').columnType).toBe('PgDoublePrecision')
    expect(col(columns, 'location__lng').notNull).toBe(true)
    expect(col(columns, 'location__lat').columnType).toBe('PgDoublePrecision')
    expect(col(columns, 'location__lat').notNull).toBe(true)
    expect(col(columns, 'optionalLocation__lng').columnType).toBe('PgDoublePrecision')
    expect(col(columns, 'optionalLocation__lng').notNull).toBe(false)
    expect(col(columns, 'optionalLocation__lat').columnType).toBe('PgDoublePrecision')
    expect(col(columns, 'optionalLocation__lat').notNull).toBe(false)
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

  it('getVersionsFilenameIndexName returns exact name when <= 63 and hashes when > 63', () => {
    expect(getVersionsFilenameIndexName('media')).toBe('media_versions_filename_idx')
    const slug = 'very-long-newsletter-campaigns-and-marketing-slug'
    const longName = getVersionsFilenameIndexName(slug)
    expect(longName.length).toBeLessThanOrEqual(63)
    expect(longName).toMatch(/_[a-f0-9]{8}_idx$/)
  })

  it('creates filename expression index on snapshot only when isUpload is true', () => {
    const mediaTable = collectionToTable({
      slug: 'media',
      upload: true,
      fields: { alt: { type: 'text' } },
    })
    const uploadVTable = createVersionsTable('media', mediaTable, true)
    const uploadConfig = getTableConfig(uploadVTable)
    expect(uploadConfig.indexes).toHaveLength(3)
    const indexNames = uploadConfig.indexes.map((i) => i.config.name)
    expect(indexNames).toContain('media_versions_filename_idx')

    const regularVTable = createVersionsTable('media', mediaTable, false)
    const regularConfig = getTableConfig(regularVTable)
    expect(regularConfig.indexes).toHaveLength(2)
    expect(regularConfig.indexes.map((i) => i.config.name)).not.toContain(
      'media_versions_filename_idx',
    )
  })

  it('getCollectionVersionsTable creates upload filename index when collection.upload is true', () => {
    const uploadCol: CollectionConfig = {
      slug: 'media',
      upload: true,
      versions: { drafts: true },
      fields: { alt: { type: 'text' } },
    }
    const mediaTable = collectionToTable(uploadCol)
    const vTable = getCollectionVersionsTable(uploadCol, mediaTable)
    expect(vTable).not.toBeNull()
    const config = getTableConfig(vTable!)
    expect(config.indexes.map((i) => i.config.name)).toContain('media_versions_filename_idx')
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
      const columns = getTableColumns(table) as Record<string, AnyPgColumn>

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
      expect(col(columns, 'social__ogImage')).toBeDefined()

      // Container blocks with localized: true generates per-locale JSONB columns
      expect(col(columns, 'layout_en').columnType).toBe('PgJsonb')
      expect(col(columns, 'layout_id').columnType).toBe('PgJsonb')
      expect(columns.layout).toBeUndefined()

      // Container array without localized: true generates a single JSONB column
      expect(col(columns, 'gallery').columnType).toBe('PgJsonb')
      expect(columns.gallery_en).toBeUndefined()
      expect(columns.gallery_id).toBeUndefined()
    })

    it('enforces that localized columns in the database are nullable even when required: true', () => {
      const table = collectionToTable(localizedPosts, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyPgColumn>

      expect(col(columns, 'title_en').notNull).toBe(false)
      expect(col(columns, 'title_id').notNull).toBe(false)
      expect(col(columns, 'slug_en').notNull).toBe(false)
      expect(col(columns, 'slug_id').notNull).toBe(false)
      expect(col(columns, 'seo__metaTitle_en').notNull).toBe(false)
      expect(col(columns, 'seo__metaTitle_id').notNull).toBe(false)
    })

    it('enforces unique constraints per locale on localized slug fields', () => {
      const table = collectionToTable(localizedPosts, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyPgColumn>

      expect(col(columns, 'slug_en').isUnique).toBe(true)
      expect(col(columns, 'slug_id').isUnique).toBe(true)
    })

    it('creates localized junction table with _locale column and composite unique/index', () => {
      const junctionTables = getCollectionJunctionTables(localizedPosts)
      const tagsJunction = junctionTables.tags
      expect(tagsJunction).toBeDefined()

      const columns = getTableColumns(tagsJunction!) as Record<string, AnyPgColumn>
      expect(col(columns, 'parentId').columnType).toBe('PgInteger')
      expect(col(columns, 'targetId').columnType).toBe('PgInteger')
      expect(col(columns, '_locale').columnType).toBe('PgVarchar')
      expect(col(columns, 'order').columnType).toBe('PgInteger')

      const config = getTableConfig(tagsJunction!)
      expect(config.name).toBe('posts_tags')
      expect(config.indexes.map((i) => i.config.name)).toContain(
        'posts_tags_parent_locale_order_idx',
      )
      expect(config.uniqueConstraints.map((u) => u.name)).toContain(
        'posts_tags_parent_locale_target_unique',
      )
    })

    it('truncates junction table index and unique names when length exceeds PostgreSQL 63 chars', () => {
      const longName = 'long_newsletter_campaign_recipient_tracking_records'
      const orderIdx = getJunctionParentLocaleOrderIndexName(longName)
      const targetUq = getJunctionParentLocaleTargetUniqueName(longName)

      expect(orderIdx.length).toBeLessThanOrEqual(63)
      expect(orderIdx).toMatch(/_[a-f0-9]{8}_idx$/)
      expect(targetUq.length).toBeLessThanOrEqual(63)
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
      const columns = getTableColumns(table) as Record<string, AnyPgColumn>

      expect(col(columns, 'filename')).toBeDefined()
      expect(col(columns, 'url')).toBeDefined()
      expect(col(columns, 'mimeType')).toBeDefined()
      expect(col(columns, 'filesize')).toBeDefined()

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
          logoId: { type: 'upload', relationTo: 'media' },
        },
      }
      const table = globalToTable(headerGlobal, ['en', 'id'])
      const columns = getTableColumns(table) as Record<string, AnyPgColumn>

      expect(col(columns, 'siteTitle_en')).toBeDefined()
      expect(col(columns, 'siteTitle_id')).toBeDefined()
      expect(col(columns, 'announcement_en')).toBeDefined()
      expect(col(columns, 'announcement_id')).toBeDefined()
      expect(col(columns, 'logoId')).toBeDefined()
    })

    it('maps hasMany text and number fields to jsonb columns (ADR 0031)', () => {
      const colDef: CollectionConfig = {
        slug: 'articles',
        fields: {
          tags: { type: 'text', hasMany: true, required: true },
          scores: { type: 'number', hasMany: true },
        },
      }
      const table = collectionToTable(colDef)
      const columns = getTableColumns(table) as Record<string, AnyPgColumn>

      expect(col(columns, 'tags').columnType).toBe('PgJsonb')
      expect(col(columns, 'tags').notNull).toBe(true)
      expect(col(columns, 'scores').columnType).toBe('PgJsonb')
      expect(col(columns, 'scores').notNull).toBe(false)
    })

    it('proves that adding layout fields (tabs, row, collapsible) around fields produces identical columns (schema invariance)', () => {
      const flatCol: CollectionConfig = {
        slug: 'articles',
        fields: {
          title: { type: 'text', required: true },
          slug: { type: 'slug', from: 'title' },
          views: { type: 'number' },
          isFeatured: { type: 'checkbox' },
        },
      }
      const layoutCol: CollectionConfig = {
        slug: 'articles',
        fields: {
          mainTabs: {
            type: 'tabs',
            tabs: [
              {
                label: 'General',
                fields: {
                  titleRow: {
                    type: 'row',
                    fields: {
                      title: { type: 'text', required: true },
                      slug: { type: 'slug', from: 'title' },
                    },
                  },
                },
              },
              {
                label: 'Settings',
                fields: {
                  advanced: {
                    type: 'collapsible',
                    label: 'Advanced',
                    fields: {
                      views: { type: 'number' },
                      isFeatured: { type: 'checkbox' },
                    },
                  },
                },
              },
            ],
          },
        },
      }

      const flatTable = collectionToTable(flatCol)
      const layoutTable = collectionToTable(layoutCol)

      const flatCols = getTableColumns(flatTable) as Record<string, AnyPgColumn>
      const layoutCols = getTableColumns(layoutTable) as Record<string, AnyPgColumn>

      expect(Object.keys(layoutCols)).toEqual(Object.keys(flatCols))
      for (const key of Object.keys(flatCols)) {
        expect(layoutCols[key]?.columnType).toBe(flatCols[key]?.columnType)
        expect(layoutCols[key]?.notNull).toBe(flatCols[key]?.notNull)
      }
    })
  })
})
