import crypto from 'node:crypto'
import pg from 'pg'

export interface TestDatabase {
  url: string
  dbName: string
  teardown: () => Promise<void>
}

interface ServerConfig {
  connectionString: string
  adminUrl: string
}

function parseTestConnection(rawUrl?: string): {
  url: URL
  serverConfig: ServerConfig
} {
  const urlString =
    rawUrl || process.env.TEST_POSTGRES_URL || 'postgres://lontar:lontar@127.0.0.1:5432/lontar_test'

  const parsed = new URL(urlString)
  const adminParsed = new URL(urlString)
  adminParsed.pathname = '/postgres'

  return {
    url: parsed,
    serverConfig: {
      connectionString: urlString,
      adminUrl: adminParsed.toString(),
    },
  }
}

async function executeDatabaseCreate(adminClient: pg.Client, dbName: string): Promise<boolean> {
  try {
    await adminClient.query(`CREATE DATABASE "${dbName}"`)
    return true
  } catch {
    return false
  }
}

/**
 * Creates an isolated test database for integration testing.
 * Uses TEST_POSTGRES_URL or defaults to 'postgres://lontar:lontar@127.0.0.1:5432/lontar_test'.
 *
 * Each invocation generates a unique database `lontar_test_<hex>` so test files
 * can run concurrently without table collision or local dev data pollution.
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const { url, serverConfig } = parseTestConnection()
  const dbName = `lontar_test_${crypto.randomBytes(6).toString('hex')}`

  let adminClient: pg.Client | null = null
  let created = false

  try {
    adminClient = new pg.Client({ connectionString: serverConfig.adminUrl })
    await adminClient.connect()
    created = await executeDatabaseCreate(adminClient, dbName)
  } catch {
    // ignore
  } finally {
    if (adminClient) {
      try {
        await adminClient.end()
      } catch {
        // ignore
      }
    }
  }

  if (!created) {
    const fallbackDb = url.pathname.replace(/^\//, '') || 'lontar_test'
    url.pathname = `/${fallbackDb}`
    return {
      url: url.toString(),
      dbName: fallbackDb,
      teardown: async () => {},
    }
  }

  url.pathname = `/${dbName}`
  const isolatedUrl = url.toString()

  return {
    url: isolatedUrl,
    dbName,
    teardown: async () => {
      let dropClient: pg.Client | null = null
      try {
        dropClient = new pg.Client({ connectionString: serverConfig.adminUrl })
        await dropClient.connect()
        try {
          await dropClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
        } catch {
          await dropClient.query(`DROP DATABASE IF EXISTS "${dbName}"`)
        }
      } catch {
        // Ignore teardown drop errors
      } finally {
        if (dropClient) {
          try {
            await dropClient.end()
          } catch {
            // ignore
          }
        }
      }
    },
  }
}
