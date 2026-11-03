import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

export interface TestDatabase {
  url: string
  dbName: string
  teardown: () => Promise<void>
}

interface ServerConfig {
  host: string
  port: number
  user: string
  password?: string
}

function parseTestConnection(rawUrl?: string): { parsed: URL; serverConfig: ServerConfig } {
  const urlString =
    rawUrl || process.env.TEST_DATABASE_URL || 'mysql://lontar:lontar@127.0.0.1:3306/lontar_test'
  const parsed = new URL(urlString)
  const serverConfig: ServerConfig = {
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port) || 3306,
    user: parsed.username || 'lontar',
    password: decodeURIComponent(parsed.password || 'lontar'),
  }
  return { parsed, serverConfig }
}

async function tryGrantPrivileges(config: ServerConfig): Promise<boolean> {
  try {
    const rootConn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: 'root',
      password: process.env.MYSQL_ROOT_PASSWORD || 'lontar',
    })
    await rootConn.query(`GRANT ALL PRIVILEGES ON \`lontar_test%\`.* TO '${config.user}'@'%'`)
    await rootConn.query('FLUSH PRIVILEGES')
    await rootConn.end()
    return true
  } catch {
    return false
  }
}

function isDbPermissionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false
  }
  const record = err as Record<string, unknown>
  return record.code === 'ER_DBACCESS_DENIED_ERROR' || record.errno === 1044
}

async function executeDatabaseCreate(
  conn: mysql.Connection,
  dbName: string,
  config: ServerConfig,
): Promise<boolean> {
  try {
    await conn.query(`CREATE DATABASE \`${dbName}\``)
    return true
  } catch (err: unknown) {
    if (isDbPermissionError(err)) {
      const granted = await tryGrantPrivileges(config)
      if (granted) {
        await conn.query(`CREATE DATABASE \`${dbName}\``)
        return true
      }
    }
    return false
  }
}

/**
 * Creates an isolated test database for integration testing.
 * Uses TEST_DATABASE_URL or defaults to 'mysql://lontar:lontar@127.0.0.1:3306/lontar_test'.
 *
 * Each invocation generates a unique database `lontar_test_<hex>` so test files
 * can run concurrently without table collision or local dev data pollution.
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const { parsed, serverConfig } = parseTestConnection()
  const dbName = `lontar_test_${crypto.randomBytes(6).toString('hex')}`

  const serverConn = await mysql.createConnection(serverConfig)
  const created = await executeDatabaseCreate(serverConn, dbName, serverConfig)
  await serverConn.end()

  if (!created) {
    // Fallback: use database name from URL if dynamic creation was not permitted
    const fallbackDb = parsed.pathname.replace(/^\//, '') || 'lontar_test'
    parsed.pathname = `/${fallbackDb}`
    return {
      url: parsed.toString(),
      dbName: fallbackDb,
      teardown: async () => {},
    }
  }

  parsed.pathname = `/${dbName}`
  const isolatedUrl = parsed.toString()

  return {
    url: isolatedUrl,
    dbName,
    teardown: async () => {
      try {
        const dropConn = await mysql.createConnection(serverConfig)
        await dropConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``)
        await dropConn.end()
      } catch {
        // Ignore teardown drop errors
      }
    },
  }
}
