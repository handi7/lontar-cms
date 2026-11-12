import pg from 'pg'
import { describe, it } from 'vitest'
import { registerAdapterConformanceSuite } from '@lontar/db-test-suite'
import { postgresAdapter } from './adapter'
import { isPostgresAvailable, setupTestDatabase } from './test-database'

const postgresAvailable = await isPostgresAvailable()

if (!postgresAvailable) {
  describe.skip('postgresAdapter (integration)', () => {
    it('skipped because PostgreSQL server is not reachable', () => {})
  })
} else {
  registerAdapterConformanceSuite(
    {
      name: 'postgresAdapter',
      label: 'Postgres adapter',
      dialect: 'postgresql',
      createAdapter: (url) => postgresAdapter({ url }),
      setupTestDatabase,
      queryRaw: async (url, query, params) => {
        const sqlQuery = typeof query === 'string' ? query : query.postgresql
        const pool = new pg.Pool({ connectionString: url })
        try {
          const res = await pool.query(sqlQuery, params)
          return res.rows as Array<Record<string, unknown>>
        } finally {
          await pool.end()
        }
      },
    },
    {
      skipTests: [
        // #307: db-postgres: nested JSON filters, versions/drafts and error mapping
        'maps real Postgres duplicate unique key to UniqueConstraintError',
        'handles foreign key violation and wraps in DatabaseError (#304)',
        'filters and sorts on nested field paths: group, array, and blocks',
        'supports block-qualified path filtering on blocks fields (#158)',
        'filters by block-qualified paths when multiple block types share field names (#171)',
        'not_equals operator on array and block paths excludes matching elements (#172)',
        'filters array and blocks with not_equals without dropping documents missing the key or with empty/null arrays (#179)',
        'saves document versions and retrieves them with pagination (#199)',
        'prunes version history when maxPerDoc is exceeded (#199)',
        'retrieves a single version by ID (#199)',
        'finds the latest draft version of a document (#199)',
        'supports sorting on findVersions (#243)',
        'hasVersionWithFilename returns true when filename exists in any version snapshot (#199)',
        'serializes concurrent version saves on the same parent document (#243)',
        'manages version history and drafts for singleton globals (#206)',
        'publish of a missing id returns 404 on real Postgres adapter',
        'publish of an invalid draft document returns 400 with issues on real Postgres adapter',
        'publish of an unknown global returns 404 on real Postgres adapter',
        'publish of an invalid draft global returns 400 with issues on real Postgres adapter',
        'guarantees continuous autosaves generate at most one transient version row without exhausting retention (#203)',
      ],
    },
  )
}
