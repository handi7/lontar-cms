import { describe, expect, it } from 'vitest'
import type { Config } from '@lontar/core'
import {
  applyLocalizationMigrationStatements,
  detectLocalizationTransitions,
  flattenFields,
  inspectRemovedLocales,
  patchSnapshotForTransitions,
  type DrizzleSnapshot,
  type LocalizationTransitions,
} from './migrate-localization'

describe('migrate-localization (#426)', () => {
  describe('flattenFields', () => {
    it('flattens top-level and group fields, inheriting group localization', () => {
      const fields = {
        title: { type: 'text', localized: true },
        author: { type: 'relationship', relationTo: 'users' },
        seo: {
          type: 'group',
          fields: {
            metaTitle: { type: 'text', localized: true },
            ogImage: { type: 'upload', relationTo: 'media' },
          },
        },
        banner: {
          type: 'group',
          localized: true,
          fields: {
            heading: { type: 'text' },
          },
        },
        tags: { type: 'relationship', relationTo: 'tags', hasMany: true, localized: true },
      }

      const flat = flattenFields(fields)
      const title = flat.find((f) => f.name === 'title')
      expect(title?.field.localized).toBe(true)

      const metaTitle = flat.find((f) => f.name === 'seo__metaTitle')
      expect(metaTitle?.field.localized).toBe(true)

      const ogImage = flat.find((f) => f.name === 'seo__ogImage')
      expect(ogImage?.field.localized).toBe(false)

      const bannerHeading = flat.find((f) => f.name === 'banner__heading')
      expect(bannerHeading?.field.localized).toBe(true)

      const tags = flat.find((f) => f.name === 'tags')
      expect(tags?.field.hasMany).toBe(true)
      expect(tags?.field.localized).toBe(true)
    })
  })

  describe('detectLocalizationTransitions', () => {
    const mockSnapshot: DrizzleSnapshot = {
      version: '5',
      dialect: 'mysql',
      id: 'snap-1',
      prevId: '00000000-0000-0000-0000-000000000000',
      tables: {
        posts: {
          name: 'posts',
          columns: {
            id: { name: 'id', type: 'serial', primaryKey: true, notNull: true },
            title: { name: 'title', type: 'varchar(255)', primaryKey: false, notNull: true },
            summary: { name: 'summary', type: 'text', primaryKey: false, notNull: false },
            seo__metaTitle: {
              name: 'seo__metaTitle',
              type: 'varchar(255)',
              primaryKey: false,
              notNull: true,
            },
            legacy_fr: {
              name: 'legacy_fr',
              type: 'varchar(255)',
              primaryKey: false,
              notNull: false,
            },
          },
          indexes: {
            posts_title_idx: { name: 'posts_title_idx', columns: ['title'], isUnique: false },
          },
        },
        posts_tags: {
          name: 'posts_tags',
          columns: {
            id: { name: 'id', type: 'serial', primaryKey: true, notNull: true },
            parent_id: { name: 'parent_id', type: 'int', primaryKey: false, notNull: true },
            tag_id: { name: 'tag_id', type: 'int', primaryKey: false, notNull: true },
            order: { name: 'order', type: 'int', primaryKey: false, notNull: true },
          },
        },
      },
    }

    const mockConfig: Config = {
      secret: 'test-secret',
      db: {} as unknown as Config['db'],
      localization: {
        defaultLocale: 'en',
        locales: ['en', 'id'],
      },
      collections: [
        {
          slug: 'posts',
          fields: {
            title: { type: 'text', localized: true },
            summary: { type: 'text' }, // non-localized
            seo: {
              type: 'group',
              fields: {
                metaTitle: { type: 'text', localized: true },
              },
            },
            tags: { type: 'relationship', relationTo: 'tags', hasMany: true, localized: true },
            legacy: { type: 'text', localized: true },
          },
        },
      ],
    }

    it('detects fields transitioning to localized and junction tables gaining _locale', () => {
      const transitions = detectLocalizationTransitions(mockSnapshot, mockConfig)

      expect(transitions.columnTransitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'posts',
            fromColumn: 'title',
            toColumn: 'title_en',
            type: 'to-localized',
            wasNotNull: true,
          }),
          expect.objectContaining({
            table: 'posts',
            fromColumn: 'seo__metaTitle',
            toColumn: 'seo__metaTitle_en',
            type: 'to-localized',
            wasNotNull: true,
          }),
        ]),
      )

      expect(transitions.junctionTransitions).toEqual([
        {
          table: 'posts',
          junctionTable: 'posts_tags',
          type: 'to-localized',
          defaultLocale: 'en',
        },
      ])

      expect(transitions.removedLocales).toEqual([
        {
          locale: 'fr',
          table: 'posts',
          column: 'legacy_fr',
        },
      ])
    })

    it('detects fields transitioning from localized to non-localized', () => {
      const localizedSnapshot: DrizzleSnapshot = {
        version: '5',
        dialect: 'mysql',
        id: 'snap-2',
        prevId: 'snap-1',
        tables: {
          posts: {
            name: 'posts',
            columns: {
              id: { name: 'id', type: 'serial', primaryKey: true, notNull: true },
              title_en: {
                name: 'title_en',
                type: 'varchar(255)',
                primaryKey: false,
                notNull: false,
              },
              title_id: {
                name: 'title_id',
                type: 'varchar(255)',
                primaryKey: false,
                notNull: false,
              },
            },
          },
          posts_tags: {
            name: 'posts_tags',
            columns: {
              id: { name: 'id', type: 'serial', primaryKey: true, notNull: true },
              _locale: { name: '_locale', type: 'varchar(10)', primaryKey: false, notNull: true },
            },
          },
        },
      }

      const unlocalizedConfig: Config = {
        secret: 'test-secret',
        db: {} as unknown as Config['db'],
        collections: [
          {
            slug: 'posts',
            fields: {
              title: { type: 'text' }, // unlocalized
              tags: { type: 'relationship', relationTo: 'tags', hasMany: true }, // unlocalized
            },
          },
        ],
      }

      const transitions = detectLocalizationTransitions(localizedSnapshot, unlocalizedConfig)

      expect(transitions.columnTransitions).toEqual([
        {
          table: 'posts',
          fromColumn: 'title_en',
          toColumn: 'title',
          type: 'from-localized',
          columnType: 'varchar(255)',
          wasNotNull: false,
        },
      ])

      expect(transitions.junctionTransitions).toEqual([
        {
          table: 'posts',
          junctionTable: 'posts_tags',
          type: 'from-localized',
          defaultLocale: 'en',
        },
      ])
    })
  })

  describe('patchSnapshotForTransitions', () => {
    it('renames columns and updates index references in snapshot', () => {
      const snapshot: DrizzleSnapshot = {
        version: '5',
        dialect: 'mysql',
        id: 'snap-1',
        prevId: '00000000-0000-0000-0000-000000000000',
        tables: {
          posts: {
            name: 'posts',
            columns: {
              id: { name: 'id', type: 'serial', primaryKey: true, notNull: true },
              title: { name: 'title', type: 'varchar(255)', primaryKey: false, notNull: true },
            },
            indexes: {
              posts_title_idx: { name: 'posts_title_idx', columns: ['title'], isUnique: false },
            },
          },
        },
      }

      const transitions: LocalizationTransitions = {
        columnTransitions: [
          {
            table: 'posts',
            fromColumn: 'title',
            toColumn: 'title_en',
            type: 'to-localized',
          },
        ],
        junctionTransitions: [],
        removedLocales: [],
      }

      patchSnapshotForTransitions(snapshot, transitions)

      const posts = snapshot.tables.posts!
      expect(posts.columns.title).toBeUndefined()
      expect(posts.columns.title_en).toBeDefined()
      expect(posts.columns.title_en?.notNull).toBe(false)
      expect(posts.indexes?.posts_title_idx?.columns).toEqual(['title_en'])
    })
  })

  describe('applyLocalizationMigrationStatements', () => {
    it('applies MySQL rename and modify column null statements and junction backfill', () => {
      const rawSql = `
ALTER TABLE \`posts\` DROP INDEX \`posts_slug_idx\`;--> statement-breakpoint
ALTER TABLE \`posts\` ADD \`title_id\` varchar(255);--> statement-breakpoint
ALTER TABLE \`posts_tags\` ADD \`_locale\` varchar(10) NOT NULL;
`
      const transitions: LocalizationTransitions = {
        columnTransitions: [
          {
            table: 'posts',
            fromColumn: 'title',
            toColumn: 'title_en',
            type: 'to-localized',
            columnType: 'varchar(255)',
            wasNotNull: true,
          },
        ],
        junctionTransitions: [
          {
            table: 'posts',
            junctionTable: 'posts_tags',
            type: 'to-localized',
            defaultLocale: 'en',
          },
        ],
        removedLocales: [],
      }

      const { sql, applied } = applyLocalizationMigrationStatements(rawSql, transitions, 'mysql')
      expect(applied).toBe(true)
      expect(sql).toContain('ALTER TABLE `posts` RENAME COLUMN `title` TO `title_en`;')
      expect(sql).toContain('ALTER TABLE `posts` MODIFY COLUMN `title_en` varchar(255) NULL;')
      expect(sql).toContain('ALTER TABLE `posts_tags` ADD `_locale` varchar(10);')
      expect(sql).toContain("UPDATE `posts_tags` SET `_locale` = 'en' WHERE `_locale` IS NULL;")
      expect(sql).toContain(
        'ALTER TABLE `posts_tags` MODIFY COLUMN `_locale` varchar(10) NOT NULL;',
      )
    })

    it('applies PostgreSQL rename and alter column drop not null statements', () => {
      const rawSql = `
ALTER TABLE "posts" ADD COLUMN "title_id" varchar(255);
`
      const transitions: LocalizationTransitions = {
        columnTransitions: [
          {
            table: 'posts',
            fromColumn: 'title',
            toColumn: 'title_en',
            type: 'to-localized',
            wasNotNull: true,
          },
        ],
        junctionTransitions: [],
        removedLocales: [],
      }

      const { sql, applied } = applyLocalizationMigrationStatements(
        rawSql,
        transitions,
        'postgresql',
      )
      expect(applied).toBe(true)
      expect(sql).toContain('ALTER TABLE "posts" RENAME COLUMN "title" TO "title_en";')
      expect(sql).toContain('ALTER TABLE "posts" ALTER COLUMN "title_en" DROP NOT NULL;')
    })

    it('applies localized-to-non-localized renames and junction row cleanup', () => {
      const rawSql = `
ALTER TABLE \`posts\` DROP COLUMN \`title_id\`;--> statement-breakpoint
ALTER TABLE \`posts_tags\` DROP COLUMN \`_locale\`;
`
      const transitions: LocalizationTransitions = {
        columnTransitions: [
          {
            table: 'posts',
            fromColumn: 'title_en',
            toColumn: 'title',
            type: 'from-localized',
          },
        ],
        junctionTransitions: [
          {
            table: 'posts',
            junctionTable: 'posts_tags',
            type: 'from-localized',
            defaultLocale: 'en',
          },
        ],
        removedLocales: [
          {
            locale: 'fr',
            table: 'posts',
            column: 'legacy_fr',
          },
        ],
      }

      const { sql, applied } = applyLocalizationMigrationStatements(rawSql, transitions, 'mysql')
      expect(applied).toBe(true)
      expect(sql).toContain('ALTER TABLE `posts` RENAME COLUMN `title_en` TO `title`;')
      expect(sql).toContain("DELETE FROM `posts_tags` WHERE `_locale` != 'en';")

      const warnings = inspectRemovedLocales(transitions)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('Migration drops locale "fr"')
      expect(warnings[0]).toContain('posts.legacy_fr')
    })
  })
})
