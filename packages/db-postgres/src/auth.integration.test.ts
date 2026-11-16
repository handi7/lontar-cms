import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
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
import { postgresAdapter, type PostgresAdapter } from './adapter'
import { isPostgresAvailable, setupTestDatabase, type TestDatabase } from './test-database'

const postgresAvailable = await isPostgresAvailable()

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

describe.skipIf(!postgresAvailable)('Better Auth PostgreSQL adapter (integration)', () => {
  let testDb: TestDatabase
  let adapter: PostgresAdapter
  let tempDir: string
  let migrationsDir: string
  let pool: pg.Pool
  let adminCookie: string
  let adminUser: AuthUser
  let testConfig: Config

  beforeAll(async () => {
    testDb = await setupTestDatabase()
    pool = new pg.Pool({ connectionString: testDb.url })
    adapter = postgresAdapter({ url: testDb.url })

    testConfig = {
      secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
      db: adapter,
      collections: [articles],
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-auth-pg-test-'))
    const schemaFile = path.join(tempDir, 'schema.ts')
    migrationsDir = path.join(tempDir, 'migrations')
    fs.writeFileSync(schemaFile, adapter.toSchemaFile(testConfig), 'utf-8')

    const drizzleKitBin = findDrizzleKitBin()
    execFileSync(process.execPath, [
      drizzleKitBin,
      'generate',
      '--dialect',
      'postgresql',
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

  it('signs up first user with admin role, persists user & session to PostgreSQL, and authenticates via session cookie', async () => {
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
        email: 'pg-admin@example.com',
        password: 'password123456',
        name: 'PG Admin',
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

    // 4. Verify directly in PostgreSQL tables
    interface DbUserRow {
      id: string
      name: string
      email: string
      role: string
      banned: boolean
    }
    const userRes = await pool.query<DbUserRow>(
      'SELECT id, name, email, role, banned FROM "user" WHERE email = $1',
      ['pg-admin@example.com'],
    )

    expect(userRes.rows).toHaveLength(1)
    const firstRow = userRes.rows[0]
    expect(firstRow?.name).toBe('PG Admin')
    expect(firstRow?.email).toBe('pg-admin@example.com')
    expect(firstRow?.role).toBe('admin')

    const sessionRes = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM "session" WHERE user_id = $1',
      [firstRow!.id],
    )

    expect(sessionRes.rows).toHaveLength(1)

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
    expect(authBody.user?.email).toBe('pg-admin@example.com')
    expect(authBody.user?.name).toBe('PG Admin')
    expect(authBody.user?.role).toBe('admin')
    expect(authBody.session).not.toBeNull()
    expect(authBody.session?.userId).toBe(firstRow!.id)
    adminUser = authBody.user!

    // 7. Sign in with the registered credentials
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pg-admin@example.com',
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
      email: 'pg-editor@example.com',
      password: 'password123456',
      name: 'PG Editor',
      role: 'editor',
    })
    expect(createdEditor.role).toBe('editor')

    // Sign in as editor to obtain session cookie
    const editorSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pg-editor@example.com',
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
      data: { title: 'Local API PG Article 1' },
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
      data: { title: 'REST API PG Article 2' },
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

  it('manages users over REST API with database persistence and security guards (PostgreSQL)', async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    // 1. Admin lists users
    const listRes = await app.request('/api/_lontar/users', {
      headers: { cookie: adminCookie },
    })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { docs: Array<{ id: string; email: string }> }
    expect(listBody.docs.length).toBeGreaterThanOrEqual(1)

    // 2. Admin creates a new user
    const createRes = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pg-managed@example.com',
        name: 'PG Managed User',
        password: 'password123456',
        role: 'editor',
      }),
    })
    expect(createRes.status).toBe(201)
    const createBody = (await createRes.json()) as {
      user: { id: string; email: string; role: string; banned: boolean }
    }
    const managedUserId = createBody.user.id
    expect(createBody.user.role).toBe('editor')

    // Verify in PostgreSQL
    const createdResult = await pool.query<{
      id: string
      name: string
      role: string
      banned: boolean
    }>('SELECT id, name, role, banned FROM "user" WHERE id = $1', [managedUserId])
    expect(createdResult.rows[0]?.name).toBe('PG Managed User')
    expect(createdResult.rows[0]?.role).toBe('editor')
    expect(createdResult.rows[0]?.banned).toBe(false)

    // Sign in as managed user to create active session
    const managedSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pg-managed@example.com',
        password: 'password123456',
      }),
    })
    expect(managedSignIn.status).toBe(200)
    const managedCookie = managedSignIn.headers.get('set-cookie')!

    const sessionsResult = await pool.query<{ id: string }>(
      'SELECT id FROM "session" WHERE user_id = $1',
      [managedUserId],
    )
    expect(sessionsResult.rows.length).toBeGreaterThanOrEqual(1)

    // 3. Admin updates name and role
    const updateRes = await app.request(`/api/_lontar/users/${managedUserId}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'PG Updated Name' }),
    })
    expect(updateRes.status).toBe(200)

    // 4. Admin disables user -> revokes sessions immediately
    const disableRes = await app.request(`/api/_lontar/users/${managedUserId}/disable`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Account deactivated' }),
    })
    expect(disableRes.status).toBe(200)

    // Verify banned in PostgreSQL and sessions removed
    const bannedResult = await pool.query<{ banned: boolean; ban_reason: string }>(
      'SELECT banned, ban_reason FROM "user" WHERE id = $1',
      [managedUserId],
    )
    expect(bannedResult.rows[0]?.banned).toBe(true)
    expect(bannedResult.rows[0]?.ban_reason).toBe('Account deactivated')

    const sessionsAfterBan = await pool.query('SELECT id FROM "session" WHERE user_id = $1', [
      managedUserId,
    ])
    expect(sessionsAfterBan.rows).toHaveLength(0)

    // Attempting request with old cookie sees user: null
    const bannedMeRes = await app.request('/api/_lontar/me', {
      headers: { cookie: managedCookie },
    })
    const bannedMeBody = (await bannedMeRes.json()) as { user: unknown }
    expect(bannedMeBody.user).toBeNull()

    // 5. Admin enables user
    const enableRes = await app.request(`/api/_lontar/users/${managedUserId}/enable`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    })
    expect(enableRes.status).toBe(200)

    // 6. Admin deletes user
    const deleteRes = await app.request(`/api/_lontar/users/${managedUserId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(deleteRes.status).toBe(200)

    // Verify removed from PostgreSQL
    const deletedResult = await pool.query('SELECT id FROM "user" WHERE id = $1', [managedUserId])
    expect(deletedResult.rows).toHaveLength(0)

    // 7. Security guards: cannot delete self, cannot disable self
    const selfDelete = await app.request(`/api/_lontar/users/${adminUser.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(selfDelete.status).toBe(400)
    expect(await selfDelete.json()).toEqual({ error: 'You cannot delete your own account' })

    const selfDisable = await app.request(`/api/_lontar/users/${adminUser.id}/disable`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    })
    expect(selfDisable.status).toBe(400)
    expect(await selfDisable.json()).toEqual({ error: 'You cannot disable your own account' })
  })
})
