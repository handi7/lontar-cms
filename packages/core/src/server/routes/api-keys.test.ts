import { describe, expect, it } from 'vitest'
import {
  createLontar,
  createUserWithCredential,
  type Config,
  type DatabaseAdapter,
  type LontarApp,
  type StoredDoc,
} from '../../index'

const dummyDoc: StoredDoc = {
  id: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockAdapter: DatabaseAdapter = {
  name: 'mock',
  find: () =>
    Promise.resolve({
      docs: [],
      totalDocs: 0,
      limit: 10,
      page: 1,
      totalPages: 1,
      pagingCounter: 1,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    }),
  findByID: () => Promise.resolve(null),
  create: ({ data }) =>
    Promise.resolve({
      ...dummyDoc,
      ...data,
    }),
  update: ({ data }) =>
    Promise.resolve({
      ...dummyDoc,
      ...data,
    }),
  delete: () => Promise.resolve(dummyDoc),
  findGlobal: () => Promise.resolve(null),
  updateGlobal: ({ data }) => Promise.resolve({ ...dummyDoc, ...data }),
  toSchemaFile: () => '',
  migrate: () => Promise.resolve(),
}

function setupTestApp(): { app: LontarApp; config: Config } {
  const config: Config = {
    secret: 'test-secret-that-is-at-least-32-chars-long-12345',
    db: mockAdapter,
    collections: [],
    auth: {
      roles: ['admin', 'editor', 'author'],
      defaultRole: 'editor',
      adminRole: 'admin',
    },
  }
  const app = createLontar(config)
  return { app, config }
}

async function registerFirstAdmin(app: LontarApp, email = 'admin@example.com'): Promise<string> {
  const res = await app.request('/api/_lontar/first-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
      name: 'Admin User',
    }),
  })
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie') ?? ''
}

async function signInUser(
  app: LontarApp,
  email: string,
  password = 'password123',
): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie') ?? ''
}

describe('API Keys REST Routes & Middleware (#345)', () => {
  it('enforces authentication on API key management endpoints', async () => {
    const { app } = setupTestApp()

    const unauthGet = await app.request('/api/_lontar/api-keys')
    expect(unauthGet.status).toBe(401)
    expect(await unauthGet.json()).toEqual({ error: 'Unauthorized' })

    const unauthPost = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Key' }),
    })
    expect(unauthPost.status).toBe(401)

    const unauthDelete = await app.request('/api/_lontar/api-keys/some-id', {
      method: 'DELETE',
    })
    expect(unauthDelete.status).toBe(401)
  })

  it('allows user to create, list, and authenticate with an API key', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    // 1. Create API key
    const createRes = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({ name: 'CI Worker' }),
    })
    expect(createRes.status).toBe(201)
    const createData = (await createRes.json()) as {
      apiKey: { id: string; name: string; key: string; start: string }
    }
    expect(createData.apiKey.name).toBe('CI Worker')
    expect(createData.apiKey.key.startsWith('lt_')).toBe(true)
    expect(createData.apiKey.start.startsWith('lt_')).toBe(true)
    const rawKey = createData.apiKey.key
    const keyId = createData.apiKey.id

    // 2. List API keys
    const listRes = await app.request('/api/_lontar/api-keys', {
      headers: { cookie: adminCookie },
    })
    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as {
      docs: Array<{ id: string; name: string; key?: string }>
    }
    expect(listData.docs).toHaveLength(1)
    expect(listData.docs[0]!.id).toBe(keyId)
    expect(listData.docs[0]!.name).toBe('CI Worker')
    expect(listData.docs[0]!.key).toBeUndefined() // Raw key never leaked in list

    // 3. Authenticate with Authorization: Bearer <key>
    const bearerMeRes = await app.request('/api/_lontar/me', {
      headers: { Authorization: `Bearer ${rawKey}` },
    })
    expect(bearerMeRes.status).toBe(200)
    const bearerMeData = (await bearerMeRes.json()) as {
      user: { email: string; role: string }
      session: unknown
    }
    expect(bearerMeData.user.email).toBe('admin@example.com')
    expect(bearerMeData.user.role).toBe('admin')
    expect(bearerMeData.session).toBeNull()

    // 4. Authenticate with x-api-key header
    const xKeyMeRes = await app.request('/api/_lontar/me', {
      headers: { 'x-api-key': rawKey },
    })
    expect(xKeyMeRes.status).toBe(200)
    const xKeyMeData = (await xKeyMeRes.json()) as { user: { email: string } }
    expect(xKeyMeData.user.email).toBe('admin@example.com')

    // 5. Revoke API key
    const deleteRes = await app.request(`/api/_lontar/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(deleteRes.status).toBe(200)
    expect(await deleteRes.json()).toEqual({ success: true })

    // 6. Subsequent requests with revoked key fail with 401
    const revokedRes = await app.request('/api/_lontar/me', {
      headers: { Authorization: `Bearer ${rawKey}` },
    })
    expect(revokedRes.status).toBe(401)
  })

  it('rejects invalid or expired API keys', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    // Invalid key token
    const invalidRes = await app.request('/api/_lontar/me', {
      headers: { Authorization: 'Bearer lt_invalidtoken12345' },
    })
    expect(invalidRes.status).toBe(401)
    expect(await invalidRes.json()).toEqual({ error: 'Invalid API key' })

    // Create key with 1 second expiry
    const createRes = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({ name: 'Short-lived', expiresIn: 1 }),
    })
    expect(createRes.status).toBe(201)
    const { apiKey } = (await createRes.json()) as { apiKey: { key: string } }

    // Wait 1.1s for key to expire
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const expiredRes = await app.request('/api/_lontar/me', {
      headers: { 'x-api-key': apiKey.key },
    })
    expect(expiredRes.status).toBe(401)
    expect(await expiredRes.json()).toEqual({ error: 'API key has expired' })
  })

  it('rejects API keys owned by disabled/banned users', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    // Create an editor user
    await createUserWithCredential(app.auth, {
      email: 'editor@example.com',
      password: 'password123',
      name: 'Editor User',
      role: 'editor',
    })
    const editorCookie = await signInUser(app, 'editor@example.com')

    // Create API key as editor
    const createRes = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: editorCookie,
      },
      body: JSON.stringify({ name: 'Editor Script' }),
    })
    const { apiKey } = (await createRes.json()) as { apiKey: { key: string; userId: string } }

    // Verify key works before ban
    const activeRes = await app.request('/api/_lontar/me', {
      headers: { 'x-api-key': apiKey.key },
    })
    expect(activeRes.status).toBe(200)

    // Admin disables the editor user
    const usersListRes = await app.request('/api/_lontar/users', {
      headers: { cookie: adminCookie },
    })
    const usersData = (await usersListRes.json()) as { docs: Array<{ id: string; email: string }> }
    const editorId = usersData.docs.find((u) => u.email === 'editor@example.com')!.id

    const disableRes = await app.request(`/api/_lontar/users/${editorId}/disable`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    })
    expect(disableRes.status).toBe(200)

    // Now the API key must immediately fail
    const bannedRes = await app.request('/api/_lontar/me', {
      headers: { 'x-api-key': apiKey.key },
    })
    expect(bannedRes.status).toBe(401)
    expect(await bannedRes.json()).toEqual({ error: 'User account is disabled' })
  })

  it('enforces key revocation permissions (owner or admin only)', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    await createUserWithCredential(app.auth, {
      email: 'alice@example.com',
      password: 'password123',
      name: 'Alice',
      role: 'editor',
    })
    await createUserWithCredential(app.auth, {
      email: 'bob@example.com',
      password: 'password123',
      name: 'Bob',
      role: 'editor',
    })

    const aliceCookie = await signInUser(app, 'alice@example.com')
    const bobCookie = await signInUser(app, 'bob@example.com')

    // Alice creates an API key
    const createRes = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: aliceCookie,
      },
      body: JSON.stringify({ name: "Alice's Key" }),
    })
    const { apiKey } = (await createRes.json()) as { apiKey: { id: string } }

    // Bob tries to delete Alice's key -> 403 Forbidden
    const bobDeleteRes = await app.request(`/api/_lontar/api-keys/${apiKey.id}`, {
      method: 'DELETE',
      headers: { cookie: bobCookie },
    })
    expect(bobDeleteRes.status).toBe(403)
    expect(await bobDeleteRes.json()).toEqual({ error: 'Forbidden' })

    // Admin can delete Alice's key
    const adminDeleteRes = await app.request(`/api/_lontar/api-keys/${apiKey.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(adminDeleteRes.status).toBe(200)
    expect(await adminDeleteRes.json()).toEqual({ success: true })
  })

  it('rejects API key requests attempting to manage API keys (session only)', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const createRes = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({ name: 'Admin Key' }),
    })
    const { apiKey } = (await createRes.json()) as { apiKey: { id: string; key: string } }
    const rawKey = apiKey.key

    // 1. GET /api/_lontar/api-keys with API key -> 403
    const listBearerRes = await app.request('/api/_lontar/api-keys', {
      headers: { Authorization: `Bearer ${rawKey}` },
    })
    expect(listBearerRes.status).toBe(403)
    expect(await listBearerRes.json()).toEqual({ error: 'Forbidden' })

    const listXKeyRes = await app.request('/api/_lontar/api-keys', {
      headers: { 'x-api-key': rawKey },
    })
    expect(listXKeyRes.status).toBe(403)

    // 2. POST /api/_lontar/api-keys with API key -> 403
    const createWithKeyRes = await app.request('/api/_lontar/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': rawKey,
      },
      body: JSON.stringify({ name: 'Nested Key' }),
    })
    expect(createWithKeyRes.status).toBe(403)
    expect(await createWithKeyRes.json()).toEqual({ error: 'Forbidden' })

    // 3. DELETE /api/_lontar/api-keys/:id with API key -> 403
    const deleteWithKeyRes = await app.request(`/api/_lontar/api-keys/${apiKey.id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': rawKey },
    })
    expect(deleteWithKeyRes.status).toBe(403)
    expect(await deleteWithKeyRes.json()).toEqual({ error: 'Forbidden' })
  })
})
