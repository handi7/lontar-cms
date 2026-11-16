import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import {
  AccessDeniedError,
  createLontar,
  createUserWithCredential,
  getLontar,
  type AuthUser,
  type CollectionConfig,
  type Config,
} from '@lontar/core'
import { findDrizzleKitBin } from '@lontar/db-test-suite'
import { mysqlAdapter, type MysqlAdapter } from './adapter'
import { setupTestDatabase, type TestDatabase } from './test-database'

const articles: CollectionConfig = {
  slug: 'articles',
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: ({ user }) => user?.role === 'admin',
  },
  fields: {
    title: { type: 'text', required: true },
  },
}

describe('Better Auth MySQL adapter (integration)', () => {
  let testDb: TestDatabase
  let adapter: MysqlAdapter
  let tempDir: string
  let migrationsDir: string
  let pool: mysql.Pool
  let adminCookie: string
  let adminUser: AuthUser
  let testConfig: Config

  beforeAll(async () => {
    testDb = await setupTestDatabase()
    pool = mysql.createPool({ uri: testDb.url, multipleStatements: true })
    adapter = mysqlAdapter({ url: testDb.url })

    testConfig = {
      secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
      db: adapter,
      collections: [articles],
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-auth-test-'))
    const schemaFile = path.join(tempDir, 'schema.ts')
    migrationsDir = path.join(tempDir, 'migrations')
    fs.writeFileSync(schemaFile, adapter.toSchemaFile(testConfig), 'utf-8')

    const drizzleKitBin = findDrizzleKitBin()
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
        await pool.end()
      }
    } finally {
      try {
        if (adapter) {
          await adapter.close()
        }
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      } finally {
        if (testDb) {
          await testDb.teardown()
        }
      }
    }
  })

  it('signs up first user with admin role, persists user & session to MySQL, and authenticates via session cookie', async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

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
    adminCookie = setCookie!

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
    const [userRows] = (await pool.query(
      'SELECT id, name, email, role, banned FROM user WHERE email = ?',
      ['mysql-admin@example.com'],
    )) as [
      Array<{ id: string; name: string; email: string; role: string; banned: number }>,
      unknown,
    ]

    expect(userRows).toHaveLength(1)
    expect(userRows[0]?.name).toBe('MySQL Admin')
    expect(userRows[0]?.email).toBe('mysql-admin@example.com')
    expect(userRows[0]?.role).toBe('admin')

    const [sessionRows] = (await pool.query('SELECT id, user_id FROM session WHERE user_id = ?', [
      userRows[0]!.id,
    ])) as [Array<{ id: string; user_id: string }>, unknown]

    expect(sessionRows).toHaveLength(1)

    // 5. Unauthenticated request to /api/_lontar/me
    const unauthRes = await app.request('/api/_lontar/me')
    expect(unauthRes.status).toBe(200)
    const unauthBody = (await unauthRes.json()) as { user: unknown; session: unknown }
    expect(unauthBody.user).toBeNull()
    expect(unauthBody.session).toBeNull()

    // 6. Authenticated request to /api/_lontar/me with session cookie
    const authRes = await app.request('/api/_lontar/me', {
      headers: { cookie: adminCookie },
    })
    expect(authRes.status).toBe(200)
    const authBody = (await authRes.json()) as {
      user: AuthUser | null
      session: { id: string; userId: string } | null
    }
    expect(authBody.user).not.toBeNull()
    expect(authBody.user?.email).toBe('mysql-admin@example.com')
    expect(authBody.user?.name).toBe('MySQL Admin')
    expect(authBody.user?.role).toBe('admin')
    expect(authBody.session).not.toBeNull()
    expect(authBody.session?.userId).toBe(userRows[0]!.id)
    adminUser = authBody.user!

    // 7. Sign in with the registered credentials
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

  it("enforces role-based delete access ({ user }) => user?.role === 'admin' over REST and Local API", async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    // 1. Create editor user via internal credential creation with role: 'editor'
    const createdEditor = await createUserWithCredential(app.auth, {
      email: 'mysql-editor@example.com',
      password: 'password123456',
      name: 'MySQL Editor',
      role: 'editor',
    })
    expect(createdEditor.role).toBe('editor')

    // Sign in as editor to obtain session cookie
    const editorSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mysql-editor@example.com',
        password: 'password123456',
      }),
    })
    expect(editorSignIn.status).toBe(200)
    const editorCookie = editorSignIn.headers.get('set-cookie')!

    const editorMe = await app.request('/api/_lontar/me', {
      headers: { cookie: editorCookie },
    })
    const editorMeBody = (await editorMe.json()) as { user: AuthUser }
    expect(editorMeBody.user.role).toBe('editor')
    const editorUser = editorMeBody.user

    // 2. Test Local API
    const lontar = await getLontar(testConfig)
    const doc1 = await lontar.create('articles', {
      data: { title: 'Local API Article 1' },
      overrideAccess: true,
    })

    // Editor is denied deletion in Local API
    await expect(
      lontar.delete('articles', doc1.id as number, {
        user: editorUser,
        overrideAccess: false,
      }),
    ).rejects.toThrow(AccessDeniedError)

    // Unauthenticated user is denied deletion in Local API
    await expect(
      lontar.delete('articles', doc1.id as number, {
        user: null,
        overrideAccess: false,
      }),
    ).rejects.toThrow(AccessDeniedError)

    // Admin user is allowed deletion in Local API
    const deletedDoc1 = await lontar.delete('articles', doc1.id as number, {
      user: adminUser,
      overrideAccess: false,
    })
    expect(deletedDoc1).not.toBeNull()

    // 3. Test REST API
    const doc2 = await lontar.create('articles', {
      data: { title: 'REST API Article 2' },
      overrideAccess: true,
    })

    // Unauthenticated DELETE -> 401
    const unauthDelete = await app.request(`/api/articles/${String(doc2.id)}`, {
      method: 'DELETE',
    })
    expect(unauthDelete.status).toBe(401)

    // Editor DELETE -> 403
    const editorDelete = await app.request(`/api/articles/${String(doc2.id)}`, {
      method: 'DELETE',
      headers: { cookie: editorCookie },
    })
    expect(editorDelete.status).toBe(403)
    expect(await editorDelete.json()).toEqual({ error: 'Forbidden' })

    // Admin DELETE -> 200
    const adminDelete = await app.request(`/api/articles/${String(doc2.id)}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(adminDelete.status).toBe(200)
  })
})
