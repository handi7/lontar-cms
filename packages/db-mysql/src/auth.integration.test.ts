import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import { createLontar, type Config } from '@lontar/core'
import { mysqlAdapter, type MysqlAdapter } from './adapter'

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://lontar:lontar@127.0.0.1:3306/lontar'

describe('Better Auth MySQL adapter (integration)', () => {
  let adapter: MysqlAdapter
  let tempDir: string
  let migrationsDir: string
  let pool: mysql.Pool

  beforeAll(async () => {
    pool = mysql.createPool({ uri: DATABASE_URL, multipleStatements: true })
    await pool.query(`
      DROP TABLE IF EXISTS session;
      DROP TABLE IF EXISTS account;
      DROP TABLE IF EXISTS verification;
      DROP TABLE IF EXISTS user;
      DROP TABLE IF EXISTS __drizzle_migrations;
    `)

    adapter = mysqlAdapter({ url: DATABASE_URL })

    const config: Config = {
      secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
      db: adapter,
      collections: [],
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-auth-test-'))
    const schemaFile = path.join(tempDir, 'schema.ts')
    migrationsDir = path.join(tempDir, 'migrations')
    fs.writeFileSync(schemaFile, adapter.toSchemaFile(config), 'utf-8')

    const drizzleKitBin = path.resolve(
      import.meta.dirname,
      '../../../node_modules/.pnpm/drizzle-kit@0.31.11/node_modules/drizzle-kit/bin.cjs',
    )
    execFileSync(process.execPath, [
      drizzleKitBin,
      'generate',
      '--dialect',
      'mysql',
      '--schema',
      schemaFile,
      '--out',
      migrationsDir,
    ])

    await adapter.migrate({ migrationsDir })
  })

  afterAll(async () => {
    try {
      if (pool) {
        await pool.query(`
          DROP TABLE IF EXISTS session;
          DROP TABLE IF EXISTS account;
          DROP TABLE IF EXISTS verification;
          DROP TABLE IF EXISTS user;
          DROP TABLE IF EXISTS __drizzle_migrations;
        `)
        await pool.end()
      }
    } finally {
      if (adapter) {
        await adapter.close()
      }
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }
  })

  it('signs up, persists user & session to MySQL, and authenticates via session cookie', async () => {
    const config: Config = {
      secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
      db: adapter,
      collections: [],
    }

    const app = createLontar(config, { baseURL: 'http://localhost:3000' })

    // 1. Verify public sign-up is disabled
    const publicSignUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@example.com',
        password: 'password123456',
        name: 'Attacker',
      }),
    })
    expect(publicSignUpRes.status).toBe(400)

    // 2. Register first user via first-user onboarding endpoint
    const signUpRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mysql-admin@example.com',
        password: 'password123456',
        name: 'MySQL Admin',
      }),
    })

    expect(signUpRes.status).toBe(200)
    const setCookie = signUpRes.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()

    // 3. Subsequent first-user registrations must fail with 403
    const secondUserRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'another-user@example.com',
        password: 'password123456',
        name: 'Another User',
      }),
    })
    expect(secondUserRes.status).toBe(403)

    // 4. Verify directly in MySQL tables
    const [userRows] = (await pool.query('SELECT id, name, email FROM user WHERE email = ?', [
      'mysql-admin@example.com',
    ])) as [Array<{ id: string; name: string; email: string }>, unknown]

    expect(userRows).toHaveLength(1)
    expect(userRows[0]?.name).toBe('MySQL Admin')
    expect(userRows[0]?.email).toBe('mysql-admin@example.com')

    const [sessionRows] = (await pool.query('SELECT id, user_id FROM session WHERE user_id = ?', [
      userRows[0]!.id,
    ])) as [Array<{ id: string; user_id: string }>, unknown]

    expect(sessionRows).toHaveLength(1)

    // 3. Unauthenticated request to /api/_lontar/me
    const unauthRes = await app.request('/api/_lontar/me')
    expect(unauthRes.status).toBe(200)
    const unauthBody = (await unauthRes.json()) as { user: unknown; session: unknown }
    expect(unauthBody.user).toBeNull()
    expect(unauthBody.session).toBeNull()

    // 4. Authenticated request to /api/_lontar/me with session cookie
    const authRes = await app.request('/api/_lontar/me', {
      headers: { cookie: setCookie! },
    })
    expect(authRes.status).toBe(200)
    const authBody = (await authRes.json()) as {
      user: { id: string; email: string; name: string } | null
      session: { id: string; userId: string } | null
    }
    expect(authBody.user).not.toBeNull()
    expect(authBody.user?.email).toBe('mysql-admin@example.com')
    expect(authBody.user?.name).toBe('MySQL Admin')
    expect(authBody.session).not.toBeNull()
    expect(authBody.session?.userId).toBe(userRows[0]!.id)

    // 5. Sign in with the registered credentials
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mysql-admin@example.com',
        password: 'password123456',
      }),
    })
    expect(signInRes.status).toBe(200)
    const signInCookie = signInRes.headers.get('set-cookie')
    expect(signInCookie).toBeTruthy()
  })
})
