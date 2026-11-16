import { describe, expect, it } from 'vitest'
import { applyRoleBackfill, inspectMigrationForStatusBackfills } from './migrate-create'

describe('inspectMigrationForStatusBackfills (#229)', () => {
  it('warns when ADD _status is present without published backfill', () => {
    const sql = `
ALTER TABLE \`pages\` ADD \`_status\` varchar(20) DEFAULT 'draft' NOT NULL;
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Migration adds `_status` to table "pages"')
    expect(warnings[0]).toContain("UPDATE `pages` SET `_status` = 'published'")
  })

  it('does not warn when ADD _status has an accompanying published backfill', () => {
    const sql = `
ALTER TABLE \`pages\` ADD \`_status\` varchar(20) DEFAULT 'draft' NOT NULL;
UPDATE \`pages\` SET \`_status\` = 'published';
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(0)
  })

  it('warns when MODIFY _status NOT NULL is present without NULL check backfill', () => {
    const sql = `
ALTER TABLE \`posts\` RENAME COLUMN \`status\` TO \`_status\`;
ALTER TABLE \`posts\` MODIFY COLUMN \`_status\` varchar(20) NOT NULL DEFAULT 'draft';
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Migration modifies `_status` to NOT NULL on table "posts"')
    expect(warnings[0]).toContain("UPDATE `posts` SET `_status` = 'draft' WHERE `_status` IS NULL")
  })

  it('does not warn when MODIFY _status NOT NULL has a NULL check backfill', () => {
    const sql = `
ALTER TABLE \`posts\` RENAME COLUMN \`status\` TO \`_status\`;
UPDATE \`posts\` SET \`_status\` = 'draft' WHERE \`_status\` IS NULL;
ALTER TABLE \`posts\` MODIFY COLUMN \`_status\` varchar(20) NOT NULL DEFAULT 'draft';
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(0)
  })

  it('handles example migration 0004 without warnings after backfills are included', () => {
    const sql = `
CREATE TABLE \`pages_versions\` (
	\`id\` int AUTO_INCREMENT NOT NULL,
	\`parent_id\` int NOT NULL,
	\`version_number\` int NOT NULL,
	\`snapshot\` json NOT NULL,
	\`_status\` varchar(20) NOT NULL DEFAULT 'draft',
	\`autosave\` boolean NOT NULL DEFAULT false,
	\`created_at\` timestamp NOT NULL DEFAULT (now()),
	\`created_by\` varchar(36),
	CONSTRAINT \`pages_versions_id\` PRIMARY KEY(\`id\`)
);
--> statement-breakpoint
CREATE TABLE \`posts_versions\` (
	\`id\` int AUTO_INCREMENT NOT NULL,
	\`parent_id\` int NOT NULL,
	\`version_number\` int NOT NULL,
	\`snapshot\` json NOT NULL,
	\`_status\` varchar(20) NOT NULL DEFAULT 'draft',
	\`autosave\` boolean NOT NULL DEFAULT false,
	\`created_at\` timestamp NOT NULL DEFAULT (now()),
	\`created_by\` varchar(36),
	CONSTRAINT \`posts_versions_id\` PRIMARY KEY(\`id\`)
);
--> statement-breakpoint
ALTER TABLE \`posts\` RENAME COLUMN \`status\` TO \`_status\`;--> statement-breakpoint
UPDATE \`posts\` SET \`_status\` = 'draft' WHERE \`_status\` IS NULL;--> statement-breakpoint
ALTER TABLE \`posts\` MODIFY COLUMN \`_status\` varchar(20) NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE \`pages\` ADD \`_status\` varchar(20) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
UPDATE \`pages\` SET \`_status\` = 'published';--> statement-breakpoint
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(0)
  })

  it('warns when ADD _status is present on a hyphenated table name (#283)', () => {
    const sql = `
ALTER TABLE \`blog-posts\` ADD \`_status\` varchar(20) DEFAULT 'draft' NOT NULL;
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Migration adds `_status` to table "blog-posts"')
    expect(warnings[0]).toContain("UPDATE `blog-posts` SET `_status` = 'published'")
  })

  it('does not warn when ADD _status on hyphenated table has an accompanying published backfill (#283)', () => {
    const sql = `
ALTER TABLE \`blog-posts\` ADD \`_status\` varchar(20) DEFAULT 'draft' NOT NULL;
UPDATE \`blog-posts\` SET \`_status\` = 'published';
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(0)
  })

  it('warns when MODIFY _status NOT NULL is present on a hyphenated table name (#283)', () => {
    const sql = `
ALTER TABLE \`site-settings\` RENAME COLUMN \`status\` TO \`_status\`;
ALTER TABLE \`site-settings\` MODIFY COLUMN \`_status\` varchar(20) NOT NULL DEFAULT 'draft';
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'Migration modifies `_status` to NOT NULL on table "site-settings"',
    )
    expect(warnings[0]).toContain(
      "UPDATE `site-settings` SET `_status` = 'draft' WHERE `_status` IS NULL",
    )
  })

  it('does not warn when MODIFY _status NOT NULL on hyphenated table has a NULL check backfill (#283)', () => {
    const sql = `
ALTER TABLE \`site-settings\` RENAME COLUMN \`status\` TO \`_status\`;
UPDATE \`site-settings\` SET \`_status\` = 'draft' WHERE \`_status\` IS NULL;
ALTER TABLE \`site-settings\` MODIFY COLUMN \`_status\` varchar(20) NOT NULL DEFAULT 'draft';
`
    const warnings = inspectMigrationForStatusBackfills(sql)
    expect(warnings).toHaveLength(0)
  })

  it('warns when ADD _status is present in PostgreSQL without published backfill', () => {
    const sql = `
ALTER TABLE "pages" ADD COLUMN "_status" varchar(20) DEFAULT 'draft' NOT NULL;
`
    const warnings = inspectMigrationForStatusBackfills(sql, 'postgresql')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Migration adds "_status" to table "pages"')
    expect(warnings[0]).toContain('UPDATE "pages" SET "_status" = \'published\';')
  })

  it('warns when ALTER COLUMN _status SET NOT NULL is present in PostgreSQL without NULL check backfill', () => {
    const sql = `
ALTER TABLE "posts" RENAME COLUMN "status" TO "_status";
ALTER TABLE "posts" ALTER COLUMN "_status" SET NOT NULL;
`
    const warnings = inspectMigrationForStatusBackfills(sql, 'postgresql')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Migration modifies "_status" to NOT NULL on table "posts"')
    expect(warnings[0]).toContain(
      'UPDATE "posts" SET "_status" = \'draft\' WHERE "_status" IS NULL;',
    )
  })

  it('does not warn when PostgreSQL backfills are present', () => {
    const sql = `
ALTER TABLE "posts" RENAME COLUMN "status" TO "_status";
UPDATE "posts" SET "_status" = 'draft' WHERE "_status" IS NULL;
ALTER TABLE "posts" ALTER COLUMN "_status" SET NOT NULL;
`
    const warnings = inspectMigrationForStatusBackfills(sql, 'postgresql')
    expect(warnings).toHaveLength(0)
  })

  describe('applyRoleBackfill', () => {
    it('appends role backfill for MySQL when role is added to user table', () => {
      const sql = "ALTER TABLE `user` ADD `role` varchar(50) DEFAULT 'editor' NOT NULL;"
      const result = applyRoleBackfill(sql, 'mysql')
      expect(result.applied).toBe(true)
      expect(result.sql).toContain("UPDATE `user` SET `role` = 'editor';")
      expect(result.sql).toContain(
        "UPDATE `user` SET `role` = 'admin' ORDER BY `created_at` ASC LIMIT 1;",
      )
    })

    it('appends role backfill for PostgreSQL with subquery ordering', () => {
      const sql = 'ALTER TABLE "user" ADD COLUMN "role" text DEFAULT \'editor\' NOT NULL;'
      const result = applyRoleBackfill(sql, 'postgresql')
      expect(result.applied).toBe(true)
      expect(result.sql).toContain('UPDATE "user" SET "role" = \'editor\';')
      expect(result.sql).toContain(
        'UPDATE "user" SET "role" = \'admin\' WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1);',
      )
    })

    it('uses configured adminRole and defaultRole', () => {
      const sql = 'ALTER TABLE "user" ADD COLUMN "role" text DEFAULT \'viewer\' NOT NULL;'
      const result = applyRoleBackfill(sql, 'postgresql', {
        adminRole: 'superadmin',
        defaultRole: 'viewer',
      })
      expect(result.applied).toBe(true)
      expect(result.sql).toContain('UPDATE "user" SET "role" = \'viewer\';')
      expect(result.sql).toContain('SET "role" = \'superadmin\'')
    })

    it('does not apply backfill when user table is not modified', () => {
      const sql = 'ALTER TABLE `posts` ADD `title` varchar(255);'
      const result = applyRoleBackfill(sql, 'mysql')
      expect(result.applied).toBe(false)
      expect(result.sql).toBe(sql)
    })

    it('does not re-apply backfill when already present in the SQL', () => {
      const sql = `ALTER TABLE \`user\` ADD \`role\` varchar(50) DEFAULT 'editor' NOT NULL;
--> statement-breakpoint
UPDATE \`user\` SET \`role\` = 'admin' ORDER BY \`created_at\` ASC LIMIT 1;`
      const result = applyRoleBackfill(sql, 'mysql')
      expect(result.applied).toBe(false)
      expect(result.sql).toBe(sql)
    })
  })
})
