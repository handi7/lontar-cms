import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  createLontar,
  createUserWithCredential,
  createApiKey,
  disableUser,
  countActiveAdmins,
  countTotalAdmins,
  countTotalUsers,
  getUserByEmail,
  verifyAndChangePassword,
  type Config,
  type DatabaseAdapter,
  type EmailAdapter,
  type EmailMessage,
  type LontarApp,
  type StoredDoc,
} from '../../index'
import type { CleanUser, PaginatedUsers } from '../../auth/user'

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

function setupTestApp(roles?: string[], adminRole?: string): { app: LontarApp; config: Config } {
  const config: Config = {
    secret: 'test-secret-that-is-at-least-32-chars-long-12345',
    db: mockAdapter,
    collections: [],
    auth: {
      roles: roles ?? ['admin', 'editor', 'author'],
      defaultRole: 'editor',
      adminRole: adminRole ?? 'admin',
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

describe('User Management API (/api/_lontar/users & /api/_lontar/me)', () => {
  it('enforces authentication and admin role authorization on /api/_lontar/users', async () => {
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

    // 1. Unauthenticated -> 401
    const unauthGet = await app.request('/api/_lontar/users')
    expect(unauthGet.status).toBe(401)
    expect(await unauthGet.json()).toEqual({ error: 'Unauthorized' })

    const unauthPost = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new@example.com',
        name: 'New',
        password: 'password123',
      }),
    })
    expect(unauthPost.status).toBe(401)

    // 2. Editor (non-admin) -> 403
    const editorGet = await app.request('/api/_lontar/users', {
      headers: { cookie: editorCookie },
    })
    expect(editorGet.status).toBe(403)
    expect(await editorGet.json()).toEqual({ error: 'Forbidden' })

    const editorPost = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new@example.com',
        name: 'New',
        password: 'password123',
      }),
    })
    expect(editorPost.status).toBe(403)

    // 3. Admin -> 200 / 201
    const adminGet = await app.request('/api/_lontar/users', {
      headers: { cookie: adminCookie },
    })
    expect(adminGet.status).toBe(200)
    const listBody = (await adminGet.json()) as PaginatedUsers
    expect(listBody.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('creates a user with validation and default role', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    // 1. Validation errors
    const missingName = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'valid@example.com', password: 'password123' }),
    })
    expect(missingName.status).toBe(400)
    expect(await missingName.json()).toEqual({ error: 'Name is required' })

    const invalidEmail = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email', name: 'Test', password: 'password123' }),
    })
    expect(invalidEmail.status).toBe(400)
    expect(await invalidEmail.json()).toEqual({ error: 'A valid email is required' })

    const shortPassword = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'valid@example.com', name: 'Test', password: 'short' }),
    })
    expect(shortPassword.status).toBe(400)
    expect(await shortPassword.json()).toEqual({
      error: 'Password must be at least 8 characters long',
    })

    const longPassword = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'valid@example.com', name: 'Test', password: 'a'.repeat(129) }),
    })
    expect(longPassword.status).toBe(400)
    expect(await longPassword.json()).toEqual({
      error: 'Password cannot exceed 128 characters',
    })

    const invalidRole = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'valid@example.com',
        name: 'Test',
        password: 'password123',
        role: 'superman',
      }),
    })
    expect(invalidRole.status).toBe(400)
    const roleErrJson = (await invalidRole.json()) as { error: string }
    expect(roleErrJson.error).toContain('Invalid role "superman"')

    // 2. Successful creation (defaults to editor role)
    const createRes = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'created-editor@example.com',
        name: 'Created Editor',
        password: 'password123',
      }),
    })
    expect(createRes.status).toBe(201)
    const createdBody = (await createRes.json()) as { user: CleanUser }
    expect(createdBody.user.email).toBe('created-editor@example.com')
    expect(createdBody.user.name).toBe('Created Editor')
    expect(createdBody.user.role).toBe('editor')
    expect(createdBody.user.banned).toBe(false)
    expect('password' in createdBody.user).toBe(false)

    // 3. Duplicate email returns 400
    const dupRes = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'created-editor@example.com',
        name: 'Another Editor',
        password: 'password123',
      }),
    })
    expect(dupRes.status).toBe(400)
    expect(await dupRes.json()).toEqual({ error: 'User with this email already exists' })
  })

  it('lists, searches, and paginates users', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    await createUserWithCredential(app.auth, {
      email: 'john.doe@example.com',
      name: 'John Doe',
      password: 'password123',
      role: 'editor',
    })

    await createUserWithCredential(app.auth, {
      email: 'jane.smith@example.com',
      name: 'Jane Smith',
      password: 'password123',
      role: 'author',
    })

    // Search by name
    const searchRes = await app.request('/api/_lontar/users?search=jane', {
      headers: { cookie: adminCookie },
    })
    expect(searchRes.status).toBe(200)
    const searchBody = (await searchRes.json()) as PaginatedUsers
    expect(searchBody.docs).toHaveLength(1)
    expect(searchBody.docs[0]?.name).toBe('Jane Smith')

    // Search by email
    const searchEmailRes = await app.request('/api/_lontar/users?search=john.doe', {
      headers: { cookie: adminCookie },
    })
    const searchEmailBody = (await searchEmailRes.json()) as PaginatedUsers
    expect(searchEmailBody.docs).toHaveLength(1)
    expect(searchEmailBody.docs[0]?.email).toBe('john.doe@example.com')

    // Filter by role
    const roleRes = await app.request('/api/_lontar/users?role=author', {
      headers: { cookie: adminCookie },
    })
    const roleBody = (await roleRes.json()) as PaginatedUsers
    expect(roleBody.docs).toHaveLength(1)
    expect(roleBody.docs[0]?.role).toBe('author')

    // Pagination
    const pageRes = await app.request('/api/_lontar/users?page=1&limit=2', {
      headers: { cookie: adminCookie },
    })
    const pageBody = (await pageRes.json()) as PaginatedUsers
    expect(pageBody.limit).toBe(2)
    expect(pageBody.page).toBe(1)
    expect(pageBody.docs.length).toBeLessThanOrEqual(2)
  })

  it('gets a user by ID', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const created = await createUserWithCredential(app.auth, {
      email: 'single@example.com',
      name: 'Single User',
      password: 'password123',
      role: 'editor',
    })

    const res = await app.request(`/api/_lontar/users/${created.id}`, {
      headers: { cookie: adminCookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: CleanUser }
    expect(body.user.id).toBe(created.id)
    expect(body.user.email).toBe('single@example.com')

    const notFound = await app.request('/api/_lontar/users/non-existent-id', {
      headers: { cookie: adminCookie },
    })
    expect(notFound.status).toBe(404)
    expect(await notFound.json()).toEqual({ error: 'User not found' })
  })

  it('updates a user with name, role, and self-demotion / last-admin guards', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const meRes = await app.request('/api/_lontar/me', {
      headers: { cookie: adminCookie },
    })
    const meBody = (await meRes.json()) as { user: CleanUser }
    const adminId = meBody.user.id

    const createdEditor = await createUserWithCredential(app.auth, {
      email: 'update-target@example.com',
      name: 'Target User',
      password: 'password123',
      role: 'editor',
    })

    // 1. Guard: Cannot demote yourself
    const selfDemoteRes = await app.request(`/api/_lontar/users/${adminId}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(selfDemoteRes.status).toBe(400)
    expect(await selfDemoteRes.json()).toEqual({ error: 'You cannot change your own role' })

    // 2. Promote target user to admin
    const promoteRes = await app.request(`/api/_lontar/users/${createdEditor.id}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', name: 'Target Admin' }),
    })
    expect(promoteRes.status).toBe(200)
    const promotedBody = (await promoteRes.json()) as { user: CleanUser }
    expect(promotedBody.user.role).toBe('admin')
    expect(promotedBody.user.name).toBe('Target Admin')

    // Now there are 2 admins. Demoting one of them should succeed
    const demoteRes = await app.request(`/api/_lontar/users/${createdEditor.id}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(demoteRes.status).toBe(200)

    // 3. Guard: Cannot demote the last admin (target is now editor, only 1 admin left)
    const secondEditor = await createUserWithCredential(app.auth, {
      email: 'second-editor@example.com',
      name: 'Second Editor',
      password: 'password123',
      role: 'author',
    })
    const secondEditorAdminPromote = await app.request(`/api/_lontar/users/${secondEditor.id}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(secondEditorAdminPromote.status).toBe(200)

    // Sign in as second admin
    const secondAdminCookie = await signInUser(app, 'second-editor@example.com')

    // Second admin demotes first admin
    const demoteFirstAdmin = await app.request(`/api/_lontar/users/${adminId}`, {
      method: 'PATCH',
      headers: { cookie: secondAdminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(demoteFirstAdmin.status).toBe(200)
  })

  it('disables and enables a user, with self-disable and last-admin guards', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const meRes = await app.request('/api/_lontar/me', {
      headers: { cookie: adminCookie },
    })
    const meBody = (await meRes.json()) as { user: CleanUser }
    const adminId = meBody.user.id

    const createdEditor = await createUserWithCredential(app.auth, {
      email: 'ban-target@example.com',
      name: 'Ban Target',
      password: 'password123',
      role: 'editor',
    })

    // 1. Guard: Cannot disable yourself
    const selfDisableRes = await app.request(`/api/_lontar/users/${adminId}/disable`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    })
    expect(selfDisableRes.status).toBe(400)
    expect(await selfDisableRes.json()).toEqual({ error: 'You cannot disable your own account' })

    // 2. Disable editor
    const disableRes = await app.request(`/api/_lontar/users/${createdEditor.id}/disable`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Spamming' }),
    })
    expect(disableRes.status).toBe(200)
    const disabledBody = (await disableRes.json()) as { user: CleanUser; message: string }
    expect(disabledBody.user.banned).toBe(true)
    expect(disabledBody.user.banReason).toBe('Spamming')

    // 3. Enable editor
    const enableRes = await app.request(`/api/_lontar/users/${createdEditor.id}/enable`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    })
    expect(enableRes.status).toBe(200)
    const enabledBody = (await enableRes.json()) as { user: CleanUser; message: string }
    expect(enabledBody.user.banned).toBe(false)
    expect(enabledBody.user.banReason).toBeNull()

    // 4. Guard: Cannot disable the last admin
    await createUserWithCredential(app.auth, {
      email: 'second-admin-ban@example.com',
      name: 'Second Admin',
      password: 'password123',
      role: 'admin',
    })
    const secondAdminCookie = await signInUser(app, 'second-admin-ban@example.com')

    // First admin is disabled by second admin -> succeeds because secondAdmin is still active
    const disableFirstAdmin = await app.request(`/api/_lontar/users/${adminId}/disable`, {
      method: 'POST',
      headers: { cookie: secondAdminCookie },
    })
    expect(disableFirstAdmin.status).toBe(200)
  })

  it('revokes sessions for a user', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const createdEditor = await createUserWithCredential(app.auth, {
      email: 'revoke-target@example.com',
      name: 'Revoke Target',
      password: 'password123',
      role: 'editor',
    })

    const res = await app.request(`/api/_lontar/users/${createdEditor.id}/revoke-sessions`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Sessions revoked successfully' })
  })

  it('allows admin to set user password', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const createdEditor = await createUserWithCredential(app.auth, {
      email: 'pwd-target@example.com',
      name: 'Password Target',
      password: 'password123',
      role: 'editor',
    })

    // 1. Password too short -> 400
    const shortPwd = await app.request(`/api/_lontar/users/${createdEditor.id}/password`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'short' }),
    })
    expect(shortPwd.status).toBe(400)
    expect(await shortPwd.json()).toEqual({
      error: 'Password must be at least 8 characters long',
    })

    const longPwd = await app.request(`/api/_lontar/users/${createdEditor.id}/password`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'a'.repeat(129) }),
    })
    expect(longPwd.status).toBe(400)
    expect(await longPwd.json()).toEqual({
      error: 'Password cannot exceed 128 characters',
    })

    // 2. Set new password -> 200
    const setPwd = await app.request(`/api/_lontar/users/${createdEditor.id}/password`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'new-secure-password123' }),
    })
    expect(setPwd.status).toBe(200)
    expect(await setPwd.json()).toEqual({ message: 'Password updated successfully' })

    // 3. User can sign in with new password
    const newSignIn = await signInUser(app, 'pwd-target@example.com', 'new-secure-password123')
    expect(newSignIn).toBeTruthy()
  })

  it('deletes a user with self-delete and last-admin guards', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const meRes = await app.request('/api/_lontar/me', {
      headers: { cookie: adminCookie },
    })
    const meBody = (await meRes.json()) as { user: CleanUser }
    const adminId = meBody.user.id

    const createdEditor = await createUserWithCredential(app.auth, {
      email: 'delete-target@example.com',
      name: 'Delete Target',
      password: 'password123',
      role: 'editor',
    })

    // 1. Guard: Cannot delete yourself
    const selfDeleteRes = await app.request(`/api/_lontar/users/${adminId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(selfDeleteRes.status).toBe(400)
    expect(await selfDeleteRes.json()).toEqual({ error: 'You cannot delete your own account' })

    // 2. Delete editor succeeds
    const deleteRes = await app.request(`/api/_lontar/users/${createdEditor.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    })
    expect(deleteRes.status).toBe(200)
    expect(await deleteRes.json()).toEqual({ message: 'User deleted successfully' })

    // 3. Verify user is gone
    const verifyGet = await app.request(`/api/_lontar/users/${createdEditor.id}`, {
      headers: { cookie: adminCookie },
    })
    expect(verifyGet.status).toBe(404)

    // 4. Guard: Cannot delete the last admin
    await createUserWithCredential(app.auth, {
      email: 'delete-admin-test@example.com',
      name: 'Second Admin Delete',
      password: 'password123',
      role: 'admin',
    })
    const secondAdminCookie = await signInUser(app, 'delete-admin-test@example.com')

    // Second admin deletes first admin -> succeeds because 2 total admins existed
    const deleteFirstAdmin = await app.request(`/api/_lontar/users/${adminId}`, {
      method: 'DELETE',
      headers: { cookie: secondAdminCookie },
    })
    expect(deleteFirstAdmin.status).toBe(200)
  })

  it('allows any authenticated user to update their own name via PATCH /api/_lontar/me', async () => {
    const { app } = setupTestApp()
    await registerFirstAdmin(app)

    await createUserWithCredential(app.auth, {
      email: 'self-update@example.com',
      name: 'Original Name',
      password: 'password123',
      role: 'editor',
    })
    const editorCookie = await signInUser(app, 'self-update@example.com')

    // 1. Missing name -> 400
    const emptyName = await app.request('/api/_lontar/me', {
      method: 'PATCH',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(emptyName.status).toBe(400)
    expect(await emptyName.json()).toEqual({ error: 'Name is required' })

    // 2. Valid name -> 200
    const updateRes = await app.request('/api/_lontar/me', {
      method: 'PATCH',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Profile Name' }),
    })
    expect(updateRes.status).toBe(200)
    const body = (await updateRes.json()) as { user: CleanUser }
    expect(body.user.name).toBe('Updated Profile Name')
  })

  it('allows any authenticated user to change their own password via POST /api/_lontar/me/password', async () => {
    const { app } = setupTestApp()
    await registerFirstAdmin(app)

    await createUserWithCredential(app.auth, {
      email: 'self-pwd@example.com',
      name: 'Self Pwd User',
      password: 'password123',
      role: 'editor',
    })
    const editorCookie = await signInUser(app, 'self-pwd@example.com')

    // 1. Wrong current password -> 400
    const wrongCurrent = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'wrong-password',
        newPassword: 'new-valid-password123',
      }),
    })
    expect(wrongCurrent.status).toBe(400)
    expect(await wrongCurrent.json()).toEqual({ error: 'Current password is incorrect' })

    // 2. Short new password -> 400
    const shortNew = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'short',
      }),
    })
    expect(shortNew.status).toBe(400)
    expect(await shortNew.json()).toEqual({
      error: 'New password must be at least 8 characters long',
    })

    const longNew = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'a'.repeat(129),
      }),
    })
    expect(longNew.status).toBe(400)
    expect(await longNew.json()).toEqual({
      error: 'New password cannot exceed 128 characters',
    })

    // 3. Successful change -> 200
    const changeRes = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: { cookie: editorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'brand-new-password123',
      }),
    })
    expect(changeRes.status).toBe(200)
    expect(await changeRes.json()).toEqual({ message: 'Password changed successfully' })

    // 4. Sign in with old password fails
    const oldSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'self-pwd@example.com',
        password: 'password123',
      }),
    })
    expect(oldSignIn.status).toBe(401)

    // 5. Sign in with new password succeeds
    const newSignIn = await signInUser(app, 'self-pwd@example.com', 'brand-new-password123')
    expect(newSignIn).toBeTruthy()
  })

  it('rejects user invitation when email service is not configured', async () => {
    const { app } = setupTestApp()
    const adminCookie = await registerFirstAdmin(app)

    const res = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'no-email@example.com',
        name: 'No Email User',
        invite: true,
      }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Cannot invite user: email service is not configured',
    })
  })

  it('invites a user by email, sends invitation link, and activates account via resetPassword', async () => {
    const sentEmails: EmailMessage[] = []
    const sendEmail = vi.fn((msg: EmailMessage) => {
      sentEmails.push(msg)
    })

    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockAdapter,
      collections: [],
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
      },
      email: {
        adapter: { sendEmail },
        from: 'Lontar <no-reply@lontar.dev>',
      },
    }
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })
    const adminCookie = await registerFirstAdmin(app)

    // 1. Admin invites user
    const inviteRes = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invited@example.com',
        name: 'Invited User',
        role: 'editor',
        invite: true,
      }),
    })
    expect(inviteRes.status).toBe(201)
    const inviteBody = (await inviteRes.json()) as { user: CleanUser; invited: boolean }
    expect(inviteBody.invited).toBe(true)
    expect(inviteBody.user.email).toBe('invited@example.com')
    expect(inviteBody.user.name).toBe('Invited User')

    // 2. Email was sent with invite link
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const emailMsg = sentEmails[0]!
    expect(emailMsg.to).toBe('invited@example.com')
    expect(emailMsg.subject).toBe("You've been invited to Lontar CMS")
    expect(emailMsg.text).toContain('http://localhost:3000/admin/accept-invite?token=')

    // 3. Extract token from URL
    const match = emailMsg.text?.match(/token=([a-f0-9]+)/)
    expect(match).toBeTruthy()
    const token = match![1]

    // 4. Accept invite by setting password via Better Auth /reset-password
    const resetRes = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        newPassword: 'activated-pass123',
      }),
    })
    expect(resetRes.status).toBe(200)

    // 5. User can now sign in
    const userCookie = await signInUser(app, 'invited@example.com', 'activated-pass123')
    expect(userCookie).toBeTruthy()

    // 6. Resend invite is rejected with 409 because user already activated and has credential account
    const resendApiRes = await app.request(
      `/api/_lontar/users/${inviteBody.user.id}/resend-invite`,
      {
        method: 'POST',
        headers: { cookie: adminCookie },
      },
    )
    expect(resendApiRes.status).toBe(409)
    const errBody = (await resendApiRes.json()) as { error: string }
    expect(errBody.error).toBe('User has already accepted invitation and set a password')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('requests password reset email and resets password via Better Auth', async () => {
    const sentEmails: EmailMessage[] = []
    const sendEmail = vi.fn((msg: EmailMessage) => {
      sentEmails.push(msg)
    })

    const config: Config = {
      secret: 'test-secret-that-is-at-least-32-chars-long-12345',
      db: mockAdapter,
      collections: [],
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
      },
      email: {
        adapter: { sendEmail },
      },
    }
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })
    await registerFirstAdmin(app)

    await createUserWithCredential(app.auth, {
      email: 'member@example.com',
      name: 'Member',
      password: 'initial-password123',
      role: 'editor',
    })

    // 1. Request password reset
    const forgetRes = await app.request('/api/auth/forget-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member@example.com',
      }),
    })
    expect(forgetRes.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)

    const emailMsg = sentEmails[0]!
    expect(emailMsg.to).toBe('member@example.com')
    expect(emailMsg.subject).toBe('Reset your password')
    expect(emailMsg.text).toContain('http://localhost:3000/admin/reset-password?token=')

    // 2. Extract token and reset password
    const match = emailMsg.text?.match(/token=([a-zA-Z0-9]+)/)
    expect(match).toBeTruthy()
    const token = match![1]

    const resetRes = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        newPassword: 'brand-new-reset-pass123',
      }),
    })
    expect(resetRes.status).toBe(200)

    // 3. Old password fails, new password succeeds
    const oldSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member@example.com',
        password: 'initial-password123',
      }),
    })
    expect(oldSignIn.status).toBe(401)

    const newSignIn = await signInUser(app, 'member@example.com', 'brand-new-reset-pass123')
    expect(newSignIn).toBeTruthy()
  })

  it('rejects API key requests attempting user or profile management (session only)', async () => {
    const { app } = setupTestApp()
    await registerFirstAdmin(app)

    const adminUser = await createUserWithCredential(app.auth, {
      email: 'admin-key-owner@example.com',
      password: 'password123',
      name: 'Admin Key Owner',
      role: 'admin',
    })

    const { key: rawKey } = await createApiKey(app.auth, {
      userId: adminUser.id,
      name: 'Admin Machine Key',
    })

    const authHeaders = { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' }
    const xKeyHeaders = { 'x-api-key': rawKey, 'Content-Type': 'application/json' }

    // 1. GET /api/_lontar/users -> 403
    const listRes = await app.request('/api/_lontar/users', { headers: authHeaders })
    expect(listRes.status).toBe(403)
    expect(await listRes.json()).toEqual({ error: 'Forbidden' })

    const listXKeyRes = await app.request('/api/_lontar/users', { headers: xKeyHeaders })
    expect(listXKeyRes.status).toBe(403)

    // 2. POST /api/_lontar/users -> 403
    const createRes = await app.request('/api/_lontar/users', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: 'newuser@example.com', name: 'New User' }),
    })
    expect(createRes.status).toBe(403)

    // 3. GET /api/_lontar/users/:id -> 403
    const getRes = await app.request(`/api/_lontar/users/${adminUser.id}`, { headers: authHeaders })
    expect(getRes.status).toBe(403)

    // 4. PATCH /api/_lontar/users/:id -> 403
    const patchRes = await app.request(`/api/_lontar/users/${adminUser.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Hacked Name' }),
    })
    expect(patchRes.status).toBe(403)

    // 5. POST /api/_lontar/users/:id/disable -> 403
    const disableRes = await app.request(`/api/_lontar/users/${adminUser.id}/disable`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(disableRes.status).toBe(403)

    // 6. POST /api/_lontar/users/:id/enable -> 403
    const enableRes = await app.request(`/api/_lontar/users/${adminUser.id}/enable`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(enableRes.status).toBe(403)

    // 7. POST /api/_lontar/users/:id/revoke-sessions -> 403
    const revokeRes = await app.request(`/api/_lontar/users/${adminUser.id}/revoke-sessions`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(revokeRes.status).toBe(403)

    // 8. POST /api/_lontar/users/:id/password -> 403
    const setPassRes = await app.request(`/api/_lontar/users/${adminUser.id}/password`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ newPassword: 'new-admin-password123' }),
    })
    expect(setPassRes.status).toBe(403)

    // 9. DELETE /api/_lontar/users/:id -> 403
    const deleteRes = await app.request(`/api/_lontar/users/${adminUser.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(deleteRes.status).toBe(403)

    // 10. PATCH /api/_lontar/me -> 403
    const updateMeRes = await app.request('/api/_lontar/me', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Updated Via API Key' }),
    })
    expect(updateMeRes.status).toBe(403)
    expect(await updateMeRes.json()).toEqual({ error: 'Forbidden' })

    // 11. POST /api/_lontar/me/password -> 403
    const changePassMeRes = await app.request('/api/_lontar/me/password', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ currentPassword: 'password123', newPassword: 'new-pass-123456' }),
    })
    expect(changePassMeRes.status).toBe(403)
    expect(await changePassMeRes.json()).toEqual({ error: 'Forbidden' })
  })

  describe('Secure origin resolution for outgoing auth links (#362)', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
      delete process.env.BETTER_AUTH_URL
    })

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('password reset ignores forged Host header and uses configured baseURL', async () => {
      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn((msg: EmailMessage) => {
        sentEmails.push(msg)
      })

      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
        },
      }
      const app = createLontar(config, { baseURL: 'https://trusted-site.com' })
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'user-forged-host@example.com',
        name: 'Target User',
        password: 'password123',
        role: 'editor',
      })

      const res = await app.request('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          Host: 'evil.tld',
          'X-Forwarded-Host': 'evil.tld',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'user-forged-host@example.com',
        }),
      })
      expect(res.status).toBe(200)
      expect(sendEmail).toHaveBeenCalledTimes(1)

      const emailMsg = sentEmails[0]!
      expect(emailMsg.text).toContain('https://trusted-site.com/admin/reset-password?token=')
      expect(emailMsg.text).not.toContain('evil.tld')
    })

    it('password reset uses BETTER_AUTH_URL when baseURL option is unset and ignores forged Host header', async () => {
      process.env.BETTER_AUTH_URL = 'https://env-site.org'

      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn((msg: EmailMessage) => {
        sentEmails.push(msg)
      })

      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
        },
      }
      const app = createLontar(config)
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'user-env-url@example.com',
        name: 'Env User',
        password: 'password123',
        role: 'editor',
      })

      const res = await app.request('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          Host: 'evil.tld',
          'X-Forwarded-Host': 'evil.tld',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'user-env-url@example.com',
        }),
      })
      expect(res.status).toBe(200)
      expect(sendEmail).toHaveBeenCalledTimes(1)

      const emailMsg = sentEmails[0]!
      expect(emailMsg.text).toContain('https://env-site.org/admin/reset-password?token=')
      expect(emailMsg.text).not.toContain('evil.tld')
    })

    it('refuses to send password reset email when no baseURL or BETTER_AUTH_URL is configured', async () => {
      delete process.env.BETTER_AUTH_URL

      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn((msg: EmailMessage) => {
        sentEmails.push(msg)
      })

      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
        },
      }
      const app = createLontar(config)
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'user-no-url@example.com',
        name: 'No URL User',
        password: 'password123',
        role: 'editor',
      })

      const res = await app.request('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          Host: 'evil.tld',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'user-no-url@example.com',
        }),
      })
      expect(res.status).toBe(200)
      // Email should be refused because no base URL can be securely resolved
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it('invite ignores forged Host header and uses configured baseURL', async () => {
      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn((msg: EmailMessage) => {
        sentEmails.push(msg)
      })

      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
        },
      }
      const app = createLontar(config, { baseURL: 'https://trusted-site.com' })
      const adminCookie = await registerFirstAdmin(app)

      const inviteRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: {
          cookie: adminCookie,
          Host: 'evil.tld',
          'X-Forwarded-Host': 'evil.tld',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'invitee-forged@example.com',
          name: 'Invitee Forged',
          role: 'editor',
          invite: true,
        }),
      })
      expect(inviteRes.status).toBe(201)
      expect(sendEmail).toHaveBeenCalledTimes(1)

      const emailMsg = sentEmails[0]!
      expect(emailMsg.text).toContain('https://trusted-site.com/admin/accept-invite?token=')
      expect(emailMsg.text).not.toContain('evil.tld')
    })

    it('invite fails with 400 when no baseURL or BETTER_AUTH_URL is configured', async () => {
      delete process.env.BETTER_AUTH_URL

      const sendEmail = vi.fn()
      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
        },
      }
      const app = createLontar(config)
      const adminCookie = await registerFirstAdmin(app)

      const inviteRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: {
          cookie: adminCookie,
          Host: 'evil.tld',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'invitee-fail@example.com',
          name: 'Invitee Fail',
          role: 'editor',
          invite: true,
        }),
      })
      expect(inviteRes.status).toBe(400)
      expect(await inviteRes.json()).toEqual({
        error: 'Cannot send invitation: baseURL or BETTER_AUTH_URL must be configured',
      })
      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('Better Auth admin plugin endpoint blocking (#363)', () => {
    it('blocks all Better Auth admin plugin endpoints with 404 for an admin session', async () => {
      const { app } = setupTestApp()
      const adminCookie = await registerFirstAdmin(app)

      const endpoints: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
        { method: 'GET', path: '/api/auth/admin' },
        { method: 'POST', path: '/api/auth/admin' },
        {
          method: 'POST',
          path: '/api/auth/admin/set-role',
          body: { userId: 'some-id', role: 'editor' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/update-user',
          body: { userId: 'some-id', data: { name: 'New Name' } },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/set-user-password',
          body: { userId: 'some-id', newPassword: 'new-password-123' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/remove-user',
          body: { userId: 'some-id' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/ban-user',
          body: { userId: 'some-id' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/unban-user',
          body: { userId: 'some-id' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/create-user',
          body: { email: 'new@example.com', password: 'password123', name: 'New' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/impersonate-user',
          body: { userId: 'some-id' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/stop-impersonating',
        },
        {
          method: 'POST',
          path: '/api/auth/admin/revoke-user-session',
          body: { sessionToken: 'dummy' },
        },
        {
          method: 'POST',
          path: '/api/auth/admin/revoke-user-sessions',
          body: { userId: 'some-id' },
        },
        {
          method: 'GET',
          path: '/api/auth/admin/list-users',
        },
        {
          method: 'GET',
          path: '/api/auth/admin/get-user?userId=some-id',
        },
        {
          method: 'GET',
          path: '/api/auth/admin/list-user-sessions?userId=some-id',
        },
        {
          method: 'POST',
          path: '/api/auth/admin/has-permission',
          body: { permissions: { user: ['create'] } },
        },
      ]

      for (const endpoint of endpoints) {
        const res = await app.request(endpoint.path, {
          method: endpoint.method,
          headers: {
            cookie: adminCookie,
            ...(endpoint.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(endpoint.body ? { body: JSON.stringify(endpoint.body) } : {}),
        })

        expect(
          res.status,
          `Expected ${endpoint.method} ${endpoint.path} to return 404, got ${res.status}`,
        ).toBe(404)
        expect(await res.json()).toEqual({ error: 'Not Found' })
      }
    })

    it('blocks Better Auth admin plugin endpoints for unauthenticated requests as well', async () => {
      const { app } = setupTestApp()

      const res = await app.request('/api/auth/admin/set-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'any-id', role: 'editor' }),
      })

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not Found' })
    })

    it('allows standard non-admin Better Auth routes to function normally', async () => {
      const { app } = setupTestApp()
      const adminCookie = await registerFirstAdmin(app)

      const sessionRes = await app.request('/api/auth/get-session', {
        headers: { cookie: adminCookie },
      })
      expect(sessionRes.status).toBe(200)
      const sessionBody = (await sessionRes.json()) as { user?: { email: string } }
      expect(sessionBody.user?.email).toBe('admin@example.com')
    })
  })

  describe('Email verification lifecycle with requireEmailVerification (#368)', () => {
    function setupVerificationApp(sendEmailMock: (message: EmailMessage) => Promise<void>) {
      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
          requireEmailVerification: true,
        },
        email: {
          adapter: { sendEmail: sendEmailMock },
          from: 'Lontar <no-reply@lontar.dev>',
        },
      }
      const app = createLontar(config, { baseURL: 'http://localhost:3000' })
      return { app, config }
    }

    it('creates first-user as verified and signs in without lockout', async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined)
      const { app } = setupVerificationApp(sendEmail)

      const cookie = await registerFirstAdmin(app, 'firstadmin@example.com')
      expect(cookie).toBeTruthy()

      const sessionRes = await app.request('/api/auth/get-session', {
        headers: { cookie },
      })
      expect(sessionRes.status).toBe(200)
      const sessionBody = (await sessionRes.json()) as { user?: { emailVerified: boolean } }
      expect(sessionBody.user?.emailVerified).toBe(true)
    })

    it('marks invited user as emailVerified when invite password is set', async () => {
      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn().mockImplementation((msg: EmailMessage) => {
        sentEmails.push(msg)
        return Promise.resolve()
      })
      const { app } = setupVerificationApp(sendEmail)
      const adminCookie = await registerFirstAdmin(app, 'invite-admin@example.com')

      const inviteRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invited-verify@example.com',
          name: 'Invited User',
          role: 'editor',
          invite: true,
        }),
      })
      expect(inviteRes.status).toBe(201)

      const emailMsg = sentEmails[0]!
      const match = emailMsg.text?.match(/token=([a-f0-9]+)/)
      expect(match).toBeTruthy()
      const token = match![1]

      const resetRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'new-password-123' }),
      })
      expect(resetRes.status).toBe(200)

      const userCookie = await signInUser(app, 'invited-verify@example.com', 'new-password-123')
      expect(userCookie).toBeTruthy()

      const sessionRes = await app.request('/api/auth/get-session', {
        headers: { cookie: userCookie },
      })
      expect(sessionRes.status).toBe(200)
      const sessionBody = (await sessionRes.json()) as { user?: { emailVerified: boolean } }
      expect(sessionBody.user?.emailVerified).toBe(true)
    })

    it('rejects unverified user sign-in, sends verification email, and allows sign-in after verify', async () => {
      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn().mockImplementation((msg: EmailMessage) => {
        sentEmails.push(msg)
        return Promise.resolve()
      })
      const { app } = setupVerificationApp(sendEmail)
      const adminCookie = await registerFirstAdmin(app, 'admin-unverified@example.com')

      const createRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'direct-user@example.com',
          name: 'Direct User',
          role: 'editor',
          password: 'password123',
        }),
      })
      expect(createRes.status).toBe(201)

      const signInRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'direct-user@example.com', password: 'password123' }),
      })
      expect(signInRes.status).toBe(403)
      const signInBody = (await signInRes.json()) as { code?: string }
      expect(signInBody.code).toBe('EMAIL_NOT_VERIFIED')

      expect(sentEmails.length).toBeGreaterThanOrEqual(1)
      const verifyMsg = sentEmails[sentEmails.length - 1]!
      expect(verifyMsg.to).toBe('direct-user@example.com')
      expect(verifyMsg.subject).toBe('Verify your email address')
      expect(verifyMsg.text).toContain('/admin/verify-email?token=')

      const tokenMatch = verifyMsg.text?.match(/token=([a-zA-Z0-9_.-]+)/)
      expect(tokenMatch).toBeTruthy()
      const verifyToken = tokenMatch![1]

      const verifyRes = await app.request(`/api/auth/verify-email?token=${verifyToken}`, {
        method: 'GET',
      })
      expect(verifyRes.status).toBe(200)

      const userCookie = await signInUser(app, 'direct-user@example.com', 'password123')
      expect(userCookie).toBeTruthy()
    })

    it('marks CLI-created user as verified allowing direct sign-in', async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined)
      const { app } = setupVerificationApp(sendEmail)

      await createUserWithCredential(app.auth, {
        email: 'cli-user@example.com',
        password: 'password123',
        name: 'CLI User',
        role: 'editor',
        emailVerified: true,
      })

      const cookie = await signInUser(app, 'cli-user@example.com', 'password123')
      expect(cookie).toBeTruthy()
    })
  })

  describe('Session revocation on password change and reset (#369)', () => {
    it('revokes other sessions but preserves current session on /_lontar/me/password', async () => {
      const { app } = setupTestApp()
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'multi-session@example.com',
        name: 'Multi Session User',
        password: 'password123',
        role: 'editor',
      })

      const session1 = await signInUser(app, 'multi-session@example.com', 'password123')
      const session2 = await signInUser(app, 'multi-session@example.com', 'password123')

      const check1Before = await app.request('/api/auth/get-session', {
        headers: { cookie: session1 },
      })
      const check2Before = await app.request('/api/auth/get-session', {
        headers: { cookie: session2 },
      })
      expect(check1Before.status).toBe(200)
      expect(check2Before.status).toBe(200)

      const changeRes = await app.request('/api/_lontar/me/password', {
        method: 'POST',
        headers: { cookie: session1, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'password123',
          newPassword: 'new-multi-password123',
        }),
      })
      expect(changeRes.status).toBe(200)

      const check1After = await app.request('/api/auth/get-session', {
        headers: { cookie: session1 },
      })
      expect(check1After.status).toBe(200)

      const check2After = await app.request('/api/auth/get-session', {
        headers: { cookie: session2 },
      })
      const session2Data = (await check2After.json()) as { user?: unknown } | null
      expect(!session2Data || !session2Data.user).toBe(true)
    })

    it('revokes active sessions when password is reset via /api/auth/reset-password', async () => {
      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn().mockImplementation((msg: EmailMessage) => {
        sentEmails.push(msg)
        return Promise.resolve()
      })
      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
          from: 'Lontar <no-reply@lontar.dev>',
        },
      }
      const app = createLontar(config, { baseURL: 'http://localhost:3000' })
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'reset-victim@example.com',
        name: 'Reset Victim',
        password: 'password123',
        role: 'editor',
      })

      const victimSession = await signInUser(app, 'reset-victim@example.com', 'password123')
      const sessionCheck = await app.request('/api/auth/get-session', {
        headers: { cookie: victimSession },
      })
      expect(sessionCheck.status).toBe(200)

      const reqReset = await app.request('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'reset-victim@example.com' }),
      })
      expect(reqReset.status).toBe(200)

      const email = sentEmails.find((e) => e.to === 'reset-victim@example.com')
      expect(email).toBeTruthy()
      const match = email!.text?.match(/token=([a-zA-Z0-9_.-]+)/)
      expect(match).toBeTruthy()
      const token = match![1]

      const resetRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'brand-new-secret-123' }),
      })
      expect(resetRes.status).toBe(200)

      const afterResetSession = await app.request('/api/auth/get-session', {
        headers: { cookie: victimSession },
      })
      const sessionData = (await afterResetSession.json()) as { user?: unknown } | null
      expect(!sessionData || !sessionData.user).toBe(true)

      const newSession = await signInUser(app, 'reset-victim@example.com', 'brand-new-secret-123')
      expect(newSession).toBeTruthy()
    })

    it('revokes all sessions when verifyAndChangePassword is called without sessionToken', async () => {
      const { app } = setupTestApp()
      await registerFirstAdmin(app)

      const user = await createUserWithCredential(app.auth, {
        email: 'no-session-token@example.com',
        name: 'No Session Token User',
        password: 'password123',
        role: 'editor',
      })

      const session = await signInUser(app, 'no-session-token@example.com', 'password123')
      const checkBefore = await app.request('/api/auth/get-session', {
        headers: { cookie: session },
      })
      expect(checkBefore.status).toBe(200)

      await verifyAndChangePassword(app.auth, user.id, 'password123', 'new-password-456')

      const checkAfter = await app.request('/api/auth/get-session', {
        headers: { cookie: session },
      })
      const sessionData = (await checkAfter.json()) as { user?: unknown } | null
      expect(!sessionData || !sessionData.user).toBe(true)
    })
  })

  describe('Invite and reset token lifecycle and invalidation (#376)', () => {
    function setupTokenApp() {
      const sentEmails: EmailMessage[] = []
      const sendEmail = vi.fn().mockImplementation((msg: EmailMessage) => {
        sentEmails.push(msg)
        return Promise.resolve()
      })
      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        auth: {
          roles: ['admin', 'editor'],
          defaultRole: 'editor',
          adminRole: 'admin',
        },
        email: {
          adapter: { sendEmail },
          from: 'Lontar <no-reply@lontar.dev>',
        },
      }
      const app = createLontar(config, { baseURL: 'http://localhost:3000' })
      return { app, sendEmail, sentEmails }
    }

    it('resend-invite invalidates earlier invite token and creates new valid token', async () => {
      const { app, sentEmails } = setupTokenApp()
      const adminCookie = await registerFirstAdmin(app)

      // Admin invites user
      const inviteRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'cycle@example.com',
          name: 'Cycle User',
          role: 'editor',
          invite: true,
        }),
      })
      expect(inviteRes.status).toBe(201)
      const inviteBody = (await inviteRes.json()) as { user: CleanUser }
      const token1 = sentEmails[0]!.text?.match(/token=([a-f0-9]+)/)?.[1]
      expect(token1).toBeTruthy()

      // Resend invite
      const resendRes = await app.request(
        `/api/_lontar/users/${inviteBody.user.id}/resend-invite`,
        {
          method: 'POST',
          headers: { cookie: adminCookie },
        },
      )
      expect(resendRes.status).toBe(200)
      const token2 = sentEmails[1]!.text?.match(/token=([a-f0-9]+)/)?.[1]
      expect(token2).toBeTruthy()
      expect(token2).not.toBe(token1)

      // Old token1 must fail
      const failRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token1,
          newPassword: 'new-password-123',
        }),
      })
      expect(failRes.status).toBe(400)

      // New token2 succeeds
      const successRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token2,
          newPassword: 'new-password-123',
        }),
      })
      expect(successRes.status).toBe(200)

      // Resending invite now fails with 409
      const afterResend = await app.request(
        `/api/_lontar/users/${inviteBody.user.id}/resend-invite`,
        {
          method: 'POST',
          headers: { cookie: adminCookie },
        },
      )
      expect(afterResend.status).toBe(409)
    })

    it('requesting new password reset invalidates earlier reset tokens', async () => {
      const { app, sentEmails } = setupTokenApp()
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'multi-reset@example.com',
        name: 'Multi Reset User',
        password: 'initial-password123',
        role: 'editor',
      })

      // First reset request
      await app.request('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'multi-reset@example.com' }),
      })
      const token1 = sentEmails[0]!.text?.match(/token=([^&\s]+)/)?.[1]
      expect(token1).toBeTruthy()

      // Second reset request
      await app.request('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'multi-reset@example.com' }),
      })
      const token2 = sentEmails[1]!.text?.match(/token=([^&\s]+)/)?.[1]
      expect(token2).toBeTruthy()
      expect(token2).not.toBe(token1)

      // First token is now invalidated
      const failRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token1, newPassword: 'reset-password-1' }),
      })
      expect(failRes.status).toBe(400)

      // Second token succeeds
      const successRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token2, newPassword: 'reset-password-2' }),
      })
      expect(successRes.status).toBe(200)
    })

    it('user changing password via /api/_lontar/me/password invalidates outstanding reset/invite tokens', async () => {
      const { app, sentEmails } = setupTokenApp()
      await registerFirstAdmin(app)

      await createUserWithCredential(app.auth, {
        email: 'change-pw@example.com',
        name: 'Change PW User',
        password: 'initial-password123',
        role: 'editor',
      })

      const userSession = await signInUser(app, 'change-pw@example.com', 'initial-password123')

      // Request reset token
      await app.request('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'change-pw@example.com' }),
      })
      const token = sentEmails[0]!.text?.match(/token=([^&\s]+)/)?.[1]
      expect(token).toBeTruthy()

      // User changes password while logged in
      const changeRes = await app.request('/api/_lontar/me/password', {
        method: 'POST',
        headers: { cookie: userSession, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'initial-password123',
          newPassword: 'changed-password-456',
        }),
      })
      expect(changeRes.status).toBe(200)

      // Outstanding reset token must now be invalid
      const failRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'attacker-password-789' }),
      })
      expect(failRes.status).toBe(400)
    })

    it('admin setting user password via /api/_lontar/users/:id/password invalidates outstanding reset/invite tokens', async () => {
      const { app, sentEmails } = setupTokenApp()
      const adminCookie = await registerFirstAdmin(app)

      // Admin invites user
      const inviteRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin-override@example.com',
          name: 'Admin Override User',
          role: 'editor',
          invite: true,
        }),
      })
      const inviteBody = (await inviteRes.json()) as { user: CleanUser }
      const token = sentEmails[0]!.text?.match(/token=([a-f0-9]+)/)?.[1]
      expect(token).toBeTruthy()

      // Admin directly sets password for user
      const setPwRes = await app.request(`/api/_lontar/users/${inviteBody.user.id}/password`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'admin-assigned-pass123' }),
      })
      expect(setPwRes.status).toBe(200)

      // Outstanding invite token must now be invalid
      const failRes = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'late-invite-pass' }),
      })
      expect(failRes.status).toBe(400)

      // Resending invite is also rejected with 409
      const resendRes = await app.request(
        `/api/_lontar/users/${inviteBody.user.id}/resend-invite`,
        {
          method: 'POST',
          headers: { cookie: adminCookie },
        },
      )
      expect(resendRes.status).toBe(409)
    })
  })

  describe('Admin invariants, concurrency race conditions, and atomic creation (#379)', () => {
    it('allows demoting, disabling, and deleting an already-banned admin when 1 active admin remains (#379)', async () => {
      const { app } = setupTestApp()
      const adminCookie = await registerFirstAdmin(app, 'active-admin@example.com')

      // Create second admin
      const secondAdmin = await createUserWithCredential(app.auth, {
        email: 'banned-admin@example.com',
        name: 'Banned Admin',
        password: 'password123',
        role: 'admin',
      })

      // Disable second admin
      const disableRes = await app.request(`/api/_lontar/users/${secondAdmin.id}/disable`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Security check' }),
      })
      expect(disableRes.status).toBe(200)

      // Active admins is now 1 (active-admin).
      // Demoting the already-banned admin should SUCCEED because target is not an active admin.
      const demoteRes = await app.request(`/api/_lontar/users/${secondAdmin.id}`, {
        method: 'PATCH',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'editor' }),
      })
      expect(demoteRes.status).toBe(200)
      const demotedBody = (await demoteRes.json()) as { user: CleanUser }
      expect(demotedBody.user.role).toBe('editor')

      // Promote back to admin (still banned)
      const promoteRes = await app.request(`/api/_lontar/users/${secondAdmin.id}`, {
        method: 'PATCH',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      })
      expect(promoteRes.status).toBe(200)

      // Disabling an already-banned admin does NOT fail with "Cannot disable the last administrator"
      const disableAgainRes = await app.request(`/api/_lontar/users/${secondAdmin.id}/disable`, {
        method: 'POST',
        headers: { cookie: adminCookie },
      })
      expect(disableAgainRes.status).toBe(200)

      // Deleting the banned admin should SUCCEED because the active admin remains
      const deleteRes = await app.request(`/api/_lontar/users/${secondAdmin.id}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ message: 'User deleted successfully' })

      // Active admin count is still 1
      const activeAdmins = await countActiveAdmins(app.auth, 'admin')
      expect(activeAdmins).toBe(1)
    })

    it('blocks deleting the last active admin even if banned admins exist (#379)', async () => {
      const { app } = setupTestApp()
      await registerFirstAdmin(app, 'active-admin@example.com')

      // Create a second admin and immediately ban them
      const secondAdmin = await createUserWithCredential(app.auth, {
        email: 'banned-admin@example.com',
        name: 'Banned Admin',
        password: 'password123',
        role: 'admin',
      })
      await disableUser(app.auth, secondAdmin.id, 'Disabled')

      // Total admins = 2 (active-admin and banned-admin).
      // Active admins = 1 (active-admin).
      const activeAdminUser = await getUserByEmail(app.auth, 'active-admin@example.com')
      expect(activeAdminUser).toBeTruthy()

      // Create a third temporary user (editor) to execute the delete call, or sign in as third admin
      const thirdAdmin = await createUserWithCredential(app.auth, {
        email: 'third-admin@example.com',
        name: 'Third Admin',
        password: 'password123',
        role: 'admin',
      })

      // Now ban thirdAdmin too, so activeAdminUser is the ONLY active admin
      await disableUser(app.auth, thirdAdmin.id, 'Disabled third')

      // If activeAdminUser is the only active admin, trying to delete activeAdminUser must be blocked
      // (Even though totalAdmins is 3: activeAdmin, banned-admin, thirdAdmin)
      // Call DELETE on activeAdminUser using admin session:
      // We sign in as activeAdminUser to test, or create another admin to demote/delete
      // Let's create an active caller:
      const callerAdmin = await createUserWithCredential(app.auth, {
        email: 'caller-admin@example.com',
        name: 'Caller Admin',
        password: 'password123',
        role: 'admin',
      })
      const callerCookie = await signInUser(app, 'caller-admin@example.com')

      // Caller deletes thirdAdmin (which is banned) -> succeeds
      const delBanned = await app.request(`/api/_lontar/users/${thirdAdmin.id}`, {
        method: 'DELETE',
        headers: { cookie: callerCookie },
      })
      expect(delBanned.status).toBe(200)

      // Now active admins are: callerAdmin and activeAdminUser.
      // Now ban callerAdmin from another context or demote:
      await disableUser(app.auth, callerAdmin.id)
      // Now only activeAdminUser is active.
      const activeCount = await countActiveAdmins(app.auth, 'admin')
      expect(activeCount).toBe(1)
    })

    it('prevents last-admin demote race condition where concurrent demotions leave zero admins (#379)', async () => {
      const { app } = setupTestApp()
      const admin1Cookie = await registerFirstAdmin(app, 'admin1@example.com')

      const admin2 = await createUserWithCredential(app.auth, {
        email: 'admin2@example.com',
        name: 'Admin Two',
        password: 'password123',
        role: 'admin',
      })
      const admin2Cookie = await signInUser(app, 'admin2@example.com')

      const meRes = await app.request('/api/_lontar/me', {
        headers: { cookie: admin1Cookie },
      })
      const meBody = (await meRes.json()) as { user: CleanUser }
      const admin1Id = meBody.user.id

      // Concurrent demotions: admin1 demotes admin2, while admin2 demotes admin1
      const [res1, res2] = await Promise.all([
        app.request(`/api/_lontar/users/${admin2.id}`, {
          method: 'PATCH',
          headers: { cookie: admin1Cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'editor' }),
        }),
        app.request(`/api/_lontar/users/${admin1Id}`, {
          method: 'PATCH',
          headers: { cookie: admin2Cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'editor' }),
        }),
      ])

      const statuses = [res1.status, res2.status].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 400])

      const failedRes = res1.status === 400 ? res1 : res2
      const failedBody = (await failedRes.json()) as { error: string }
      expect(failedBody.error).toBe('Cannot demote the last administrator')

      // At least 1 active admin must remain
      const remainingAdmins = await countActiveAdmins(app.auth, 'admin')
      expect(remainingAdmins).toBe(1)
    })

    it('prevents last-admin delete race condition where concurrent deletions leave zero admins (#379)', async () => {
      const { app } = setupTestApp()
      const admin1Cookie = await registerFirstAdmin(app, 'admin1-del@example.com')

      const admin2 = await createUserWithCredential(app.auth, {
        email: 'admin2-del@example.com',
        name: 'Admin Two Del',
        password: 'password123',
        role: 'admin',
      })
      const admin2Cookie = await signInUser(app, 'admin2-del@example.com')

      const meRes = await app.request('/api/_lontar/me', {
        headers: { cookie: admin1Cookie },
      })
      const meBody = (await meRes.json()) as { user: CleanUser }
      const admin1Id = meBody.user.id

      // Concurrent deletes: admin1 deletes admin2, while admin2 deletes admin1
      const [res1, res2] = await Promise.all([
        app.request(`/api/_lontar/users/${admin2.id}`, {
          method: 'DELETE',
          headers: { cookie: admin1Cookie },
        }),
        app.request(`/api/_lontar/users/${admin1Id}`, {
          method: 'DELETE',
          headers: { cookie: admin2Cookie },
        }),
      ])

      const statuses = [res1.status, res2.status].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 400])

      const failedRes = res1.status === 400 ? res1 : res2
      const failedBody = (await failedRes.json()) as { error: string }
      expect(failedBody.error).toBe('Cannot delete the last administrator')

      // Exactly 1 admin must remain
      const remainingAdmins = await countTotalAdmins(app.auth, 'admin')
      expect(remainingAdmins).toBe(1)
    })

    it('prevents concurrent first-user registrations from creating multiple initial admins (#379)', async () => {
      const { app } = setupTestApp()

      // Two concurrent requests to first-user with different credentials
      const [res1, res2] = await Promise.all([
        app.request('/api/_lontar/first-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'first-concurrent-1@example.com',
            name: 'First Concurrent 1',
            password: 'password123',
          }),
        }),
        app.request('/api/_lontar/first-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'first-concurrent-2@example.com',
            name: 'First Concurrent 2',
            password: 'password123',
          }),
        }),
      ])

      const statuses = [res1.status, res2.status].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 403])

      const failedRes = res1.status === 403 ? res1 : res2
      const failedBody = (await failedRes.json()) as { error: string }
      expect(failedBody.error).toContain('First user has already been created')

      // Total users must be exactly 1
      const totalUsers = await countTotalUsers(app.auth)
      expect(totalUsers).toBe(1)
    })

    it('cleans up user row if account creation fails in createUserWithCredential (#379)', async () => {
      const { app } = setupTestApp()
      const ctx = await app.auth.$context
      const originalCreateAccount = (
        ...args: Parameters<typeof ctx.internalAdapter.createAccount>
      ) => ctx.internalAdapter.createAccount(...args)

      ctx.internalAdapter.createAccount = () =>
        Promise.reject(new Error('Simulated account creation failure'))

      await expect(
        createUserWithCredential(app.auth, {
          email: 'aborted-user@example.com',
          name: 'Aborted User',
          password: 'password123',
          role: 'editor',
        }),
      ).rejects.toThrow('Simulated account creation failure')

      ctx.internalAdapter.createAccount = originalCreateAccount

      // The user row must have been cleaned up
      const checkUser = await getUserByEmail(app.auth, 'aborted-user@example.com')
      expect(checkUser).toBeNull()
    })

    it('cleans up user row if verification creation fails in handleInviteUser (#379)', async () => {
      const mockEmailAdapter: EmailAdapter = {
        sendEmail: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      }
      const config: Config = {
        secret: 'test-secret-that-is-at-least-32-chars-long-12345',
        db: mockAdapter,
        collections: [],
        email: { adapter: mockEmailAdapter, from: 'noreply@example.com' },
      }
      const app = createLontar(config, { baseURL: 'http://localhost:3000' })
      const adminCookie = await registerFirstAdmin(app)

      const ctx = await app.auth.$context
      const originalCreateVerification = (
        ...args: Parameters<typeof ctx.internalAdapter.createVerificationValue>
      ) => ctx.internalAdapter.createVerificationValue(...args)

      ctx.internalAdapter.createVerificationValue = () =>
        Promise.reject(new Error('Simulated verification store failure'))

      const inviteRes = await app.request('/api/_lontar/users', {
        method: 'POST',
        headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'aborted-invite@example.com',
          name: 'Aborted Invite',
          role: 'editor',
          invite: true,
        }),
      })

      expect(inviteRes.status).toBe(500)
      ctx.internalAdapter.createVerificationValue = originalCreateVerification

      // The user row must have been cleaned up
      const checkUser = await getUserByEmail(app.auth, 'aborted-invite@example.com')
      expect(checkUser).toBeNull()
    })
  })
})
