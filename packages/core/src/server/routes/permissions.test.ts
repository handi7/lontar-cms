import { describe, expect, it, vi } from 'vitest'
import { collection } from '../../config/collection'
import { global } from '../../config/global'
import { fields as f } from '../../fields'
import { createLontar } from '../create-lontar'
import type { DatabaseAdapter, DocumentData } from '../../database/adapter'
import type { Config } from '../../config/types'
import type { CollectionPermission, PermissionsResponse } from '../../access/permissions'

type StoredDoc = DocumentData & { id: number }

function buildTestDb(
  initialDocs: Record<string, Record<number, StoredDoc>>,
  globalDocs: Record<string, DocumentData> = {},
): DatabaseAdapter {
  const store = initialDocs
  const globals = globalDocs

  return {
    name: 'mock',
    find: vi.fn().mockImplementation(({ collection: col }: { collection: { slug: string } }) => {
      const records = Object.values(store[col.slug] ?? {})
      return Promise.resolve({
        docs: records,
        totalDocs: records.length,
        limit: 10,
        page: 1,
        totalPages: 1,
      })
    }),
    findByID: vi
      .fn()
      .mockImplementation(
        ({ collection: col, id }: { collection: { slug: string }; id: number }) => {
          const doc = store[col.slug]?.[id]
          return Promise.resolve(doc ? { ...doc } : null)
        },
      ),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findGlobal: vi.fn().mockImplementation(({ global: glob }: { global: { slug: string } }) => {
      const doc = globals[glob.slug]
      return Promise.resolve(doc ? { ...doc } : null)
    }),
    updateGlobal: vi.fn(),
    toSchemaFile: vi.fn().mockReturnValue(''),
    migrate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Permissions endpoint (GET /api/_lontar/permissions and /api/_lontar/access)', () => {
  const employees = collection({
    slug: 'employees',
    access: {
      read: () => true,
      create: ({ user }) => Boolean(user),
      update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
      delete: ({ user }) => user?.role === 'admin',
    },
    versions: { drafts: true },
    fields: {
      name: f.text({ required: true }),
      salary: f.number({
        access: {
          read: ({ user }) => user?.role === 'admin',
          create: ({ user }) => user?.role === 'admin',
          update: ({ user }) => user?.role === 'admin',
        },
      }),
      meta: f.group({
        fields: {
          publicBio: f.text(),
          ssn: f.text({
            access: {
              read: ({ user }) => user?.role === 'admin',
              create: ({ user }) => user?.role === 'admin',
              update: ({ user }) => user?.role === 'admin',
            },
          }),
        },
      }),
      notes: f.array({
        fields: {
          text: f.text({
            access: {
              read: ({ siblingData, user }) =>
                user?.role === 'admin' ||
                !(siblingData as { isConfidential?: boolean })?.isConfidential,
            },
          }),
          isConfidential: f.checkbox({
            access: {
              read: ({ user }) => user?.role === 'admin',
              create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
              update: ({ siblingData }) =>
                !(siblingData as { isConfidential?: boolean })?.isConfidential,
            },
          }),
        },
      }),
      blocks: f.blocks({
        blocks: [
          {
            slug: 'review',
            fields: {
              rating: f.number(),
              managerNote: f.text({
                access: {
                  read: ({ user }) => user?.role === 'admin',
                  create: ({ user }) => user?.role === 'admin',
                  update: ({ user }) => user?.role === 'admin',
                },
              }),
            },
          },
        ],
      }),
    },
  })

  const privateSettings = global({
    slug: 'settings',
    access: {
      read: ({ user }) => Boolean(user),
      update: ({ user }) => user?.role === 'admin',
    },
    versions: { drafts: true },
    fields: {
      siteName: f.text(),
      apiSecret: f.text({
        access: {
          read: ({ user }) => user?.role === 'admin',
          create: ({ user }) => user?.role === 'admin',
          update: ({ user }) => user?.role === 'admin',
        },
      }),
    },
  })

  const initialDocs: Record<string, Record<number, StoredDoc>> = {
    employees: {
      1: {
        id: 1,
        _status: 'published',
        name: 'Alice',
        salary: 150000,
        meta: { publicBio: 'Staff Eng', ssn: '123-45-6789' },
        notes: [
          { id: 'n1', text: 'Public milestone met', isConfidential: false },
          { id: 'n2', text: 'Sensitive HR note', isConfidential: true },
        ],
        blocks: [{ id: 'b1', blockType: 'review', rating: 5, managerNote: 'Top performer' }],
      },
    },
  }

  const globalDocs = {
    settings: {
      _status: 'published',
      siteName: 'My Lontar App',
      apiSecret: 'super-secret-key-1234',
    },
  }

  function setupApp() {
    const db = buildTestDb(initialDocs, globalDocs)
    const config: Config = {
      secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
      db,
      collections: [employees],
      globals: [privateSettings],
    }
    const app = createLontar(config, { baseURL: 'http://localhost:3000' })
    return { app, config }
  }

  it('evaluates permissions for anonymous callers (user = null)', async () => {
    const { app } = setupApp()

    const res = await app.request('/api/_lontar/permissions')
    expect(res.status).toBe(200)

    const perms = (await res.json()) as PermissionsResponse

    // Collection: employees has public read, but create/update/delete require auth
    const emp = perms.collections.employees!
    expect(emp.read).toBe(true)
    expect(emp.create).toBe(false)
    expect(emp.update).toBe(false)
    expect(emp.delete).toBe(false)
    expect(emp.readVersions).toBe(false) // requires read AND update

    // Top-level fields: name is public, salary is admin-only
    expect(emp.fields.name).toEqual({ read: true, create: true, update: true })
    expect(emp.fields.salary).toEqual({ read: false, create: false, update: false })

    // Group fields: publicBio allowed, ssn denied
    expect(emp.fields['meta.publicBio']).toEqual({ read: true, create: true, update: true })
    expect(emp.fields['meta.ssn']).toEqual({ read: false, create: false, update: false })
    expect(emp.fields.meta!.fields!.publicBio).toEqual({ read: true, create: true, update: true })
    expect(emp.fields.meta!.fields!.ssn).toEqual({ read: false, create: false, update: false })

    // Array fields
    expect(emp.fields['notes.text']).toEqual({ read: true, create: true, update: true })
    expect(emp.fields['notes.isConfidential']).toEqual({ read: false, create: false, update: true })

    // Blocks fields
    expect(emp.fields['blocks.review.rating']).toEqual({ read: true, create: true, update: true })
    expect(emp.fields['blocks.review.managerNote']).toEqual({
      read: false,
      create: false,
      update: false,
    })

    // Global: settings requires auth for read and admin for update
    const settings = perms.globals.settings!
    expect(settings.read).toBe(false)
    expect(settings.update).toBe(false)
    expect(settings.readVersions).toBe(false)
    expect(settings.fields.siteName).toEqual({ read: true, create: true, update: true })
    expect(settings.fields.apiSecret).toEqual({ read: false, create: false, update: false })

    // Alias /_lontar/access returns identical structure
    const aliasRes = await app.request('/api/_lontar/access')
    expect(aliasRes.status).toBe(200)
    expect(await aliasRes.json()).toEqual(perms)
  })

  it('evaluates permissions for restricted role (editor)', async () => {
    const { app } = setupApp()

    // Sign up first user (admin) and then create an editor user
    await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!', name: 'Admin' }),
    })

    const { createUserWithCredential } = await import('../../auth/user')
    await createUserWithCredential(app.auth, {
      email: 'editor@example.com',
      password: 'Password123!',
      name: 'Editor',
      role: 'editor',
    })

    const loginRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'editor@example.com', password: 'Password123!' }),
    })
    const editorCookie = loginRes.headers.get('set-cookie')!

    const res = await app.request('/api/_lontar/permissions', {
      headers: { cookie: editorCookie },
    })
    expect(res.status).toBe(200)
    const perms = (await res.json()) as PermissionsResponse

    const emp = perms.collections.employees!
    expect(emp.read).toBe(true)
    expect(emp.create).toBe(true)
    expect(emp.update).toBe(true)
    expect(emp.delete).toBe(false) // delete is admin only
    expect(emp.readVersions).toBe(true) // editor has read && update

    // Fields: salary is admin only
    expect(emp.fields.salary).toEqual({ read: false, create: false, update: false })
    expect(emp.fields['meta.ssn']).toEqual({ read: false, create: false, update: false })
    expect(emp.fields['notes.isConfidential']).toEqual({ read: false, create: true, update: true })
    expect(emp.fields['blocks.review.managerNote']).toEqual({
      read: false,
      create: false,
      update: false,
    })

    // Global: settings is readable by authenticated editor, but update is admin only
    const settings = perms.globals.settings!
    expect(settings.read).toBe(true)
    expect(settings.update).toBe(false)
    expect(settings.readVersions).toBe(false) // requires read && update
  })

  it('evaluates permissions for admin user', async () => {
    const { app } = setupApp()

    const adminSignUp = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!', name: 'Admin' }),
    })
    const adminCookie = adminSignUp.headers.get('set-cookie')!

    const res = await app.request('/api/_lontar/permissions', {
      headers: { cookie: adminCookie },
    })
    expect(res.status).toBe(200)
    const perms = (await res.json()) as PermissionsResponse

    const emp = perms.collections.employees!
    expect(emp.read).toBe(true)
    expect(emp.create).toBe(true)
    expect(emp.update).toBe(true)
    expect(emp.delete).toBe(true)
    expect(emp.readVersions).toBe(true)

    // Admin has access to all sensitive fields
    expect(emp.fields.salary).toEqual({ read: true, create: true, update: true })
    expect(emp.fields['meta.ssn']).toEqual({ read: true, create: true, update: true })
    expect(emp.fields['notes.isConfidential']).toEqual({ read: true, create: true, update: true })
    expect(emp.fields['blocks.review.managerNote']).toEqual({
      read: true,
      create: true,
      update: true,
    })

    // Global: admin can read, update, and view version history
    const settings = perms.globals.settings!
    expect(settings.read).toBe(true)
    expect(settings.update).toBe(true)
    expect(settings.readVersions).toBe(true)
    expect(settings.fields.apiSecret).toEqual({ read: true, create: true, update: true })
  })

  it('evaluates document-specific permissions with array row rules (/api/_lontar/permissions/:collection/:id)', async () => {
    const { app } = setupApp()

    await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!', name: 'Admin' }),
    })

    const { createUserWithCredential } = await import('../../auth/user')
    await createUserWithCredential(app.auth, {
      email: 'editor@example.com',
      password: 'Password123!',
      name: 'Editor',
      role: 'editor',
    })

    const loginRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'editor@example.com', password: 'Password123!' }),
    })
    const editorCookie = loginRes.headers.get('set-cookie')!

    // 1. Editor requests permissions for document 1
    const docRes = await app.request('/api/_lontar/permissions/employees/1', {
      headers: { cookie: editorCookie },
    })
    expect(docRes.status).toBe(200)
    const docPerm = (await docRes.json()) as CollectionPermission

    expect(docPerm.read).toBe(true)
    expect(docPerm.update).toBe(true)
    expect(docPerm.delete).toBe(false)

    // In document 1, notes array has 2 rows:
    // row 0: isConfidential = false -> text is readable, isConfidential is updatable
    // row 1: isConfidential = true -> text is NOT readable by editor, isConfidential is NOT updatable
    expect(docPerm.fields['notes.0.text']?.read).toBe(true)
    expect(docPerm.fields['notes.0.isConfidential']?.update).toBe(true)

    expect(docPerm.fields['notes.1.text']?.read).toBe(false)
    expect(docPerm.fields['notes.1.isConfidential']?.update).toBe(false)

    // Blocks row evaluation
    expect(docPerm.fields['blocks.0.rating']?.read).toBe(true)
    expect(docPerm.fields['blocks.0.managerNote']?.read).toBe(false) // admin only

    // Document-specific permissions via query parameters: ?collection=employees&id=1
    const queryRes = await app.request('/api/_lontar/permissions?collection=employees&id=1', {
      headers: { cookie: editorCookie },
    })
    expect(queryRes.status).toBe(200)
    expect(await queryRes.json()).toEqual(docPerm)

    // Document-specific alias route: /api/_lontar/access/employees/1
    const aliasRes = await app.request('/api/_lontar/access/employees/1', {
      headers: { cookie: editorCookie },
    })
    expect(aliasRes.status).toBe(200)
    expect(await aliasRes.json()).toEqual(docPerm)
  })

  it('never leaks field values in permissions response', async () => {
    const { app } = setupApp()

    const res = await app.request('/api/_lontar/permissions/employees/1')
    expect(res.status).toBe(200)
    const rawText = await res.text()

    // Values that exist in initialDocs must NEVER be present anywhere in the output
    expect(rawText).not.toContain('150000')
    expect(rawText).not.toContain('123-45-6789')
    expect(rawText).not.toContain('Sensitive HR note')
    expect(rawText).not.toContain('Top performer')
    expect(rawText).not.toContain('super-secret-key-1234')
  })

  it('handles error cases for non-existent collections or documents', async () => {
    const { app } = setupApp()

    // Unknown collection
    const unknownCol = await app.request('/api/_lontar/permissions/nonexistent/1')
    expect(unknownCol.status).toBe(404)
    expect(await unknownCol.json()).toEqual({ error: 'Collection "nonexistent" not found' })

    // Invalid ID format
    const invalidId = await app.request('/api/_lontar/permissions/employees/notanid')
    expect(invalidId.status).toBe(400)
    expect(await invalidId.json()).toEqual({ error: 'Invalid document ID' })

    // Non-existent document
    const missingDoc = await app.request('/api/_lontar/permissions/employees/999')
    expect(missingDoc.status).toBe(404)
    expect(await missingDoc.json()).toEqual({ error: 'Document with ID 999 not found' })

    // Non-existent global
    const missingGlobal = await app.request('/api/_lontar/permissions/globals/nonexistent')
    expect(missingGlobal.status).toBe(404)
    expect(await missingGlobal.json()).toEqual({ error: 'Global "nonexistent" not found' })
  })

  it('caches permissions per request context', async () => {
    const { app, config } = setupApp()

    const spy = vi.spyOn(config.db, 'findGlobal')

    const res = await app.request('/api/_lontar/permissions')
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  describe('Document & Global permissions access control (#372)', () => {
    const confidentialDocs = collection({
      slug: 'confidential',
      access: {
        read: ({ user }) => user?.role === 'admin',
        update: ({ user }) => user?.role === 'admin',
      },
      fields: {
        title: f.text(),
        secretInfo: f.text({
          access: {
            read: ({ doc }) => (doc as { visibility?: string })?.visibility !== 'internal',
          },
        }),
      },
    })

    const articles = collection({
      slug: 'articles',
      access: {
        read: ({ data }) => Boolean((data as { isPublic?: boolean } | undefined)?.isPublic),
        update: ({ user }) => Boolean(user),
      },
      versions: { drafts: true },
      fields: {
        title: f.text(),
        isPublic: f.checkbox(),
      },
    })

    const secureGlobal = global({
      slug: 'secureConfig',
      access: {
        read: ({ user }) => user?.role === 'admin',
        update: ({ user }) => user?.role === 'admin',
      },
      versions: { drafts: true },
      fields: {
        apiKey: f.text(),
      },
    })

    const testStore: Record<string, Record<number, StoredDoc>> = {
      confidential: {
        1: {
          id: 1,
          title: 'Secret Doc',
          secretInfo: 'hidden',
          visibility: 'internal',
        },
      },
      articles: {
        1: {
          id: 1,
          _status: 'published',
          title: 'Private Draft/Article',
          isPublic: false,
        },
        2: { id: 2, _status: 'published', title: 'Public Article', isPublic: true },
        3: { id: 3, _status: 'draft', title: 'WIP Draft Article', isPublic: true },
      },
    }

    const testGlobals: Record<string, DocumentData> = {
      secureConfig: { _status: 'published', apiKey: 'secret-api-key-999' },
    }

    function setupSecuredApp() {
      const db = buildTestDb(
        JSON.parse(JSON.stringify(testStore)) as Record<string, Record<number, StoredDoc>>,
        JSON.parse(JSON.stringify(testGlobals)) as Record<string, DocumentData>,
      )
      const config: Config = {
        secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
        db,
        collections: [confidentialDocs, articles],
        globals: [secureGlobal],
      }
      const app = createLontar(config, {
        baseURL: 'http://localhost:3000',
        rateLimit: { enabled: false },
      })
      return { app, config }
    }

    it('returns 404 for unreadable collection documents to anonymous and unprivileged callers', async () => {
      const { app } = setupSecuredApp()

      // Anonymous -> 404
      const anonRes = await app.request('/api/_lontar/permissions/confidential/1')
      expect(anonRes.status).toBe(404)
      expect(await anonRes.json()).toEqual({ error: 'Document with ID 1 not found' })

      // Query param variant -> 404
      const anonQueryRes = await app.request(
        '/api/_lontar/permissions?collection=confidential&id=1',
      )
      expect(anonQueryRes.status).toBe(404)

      // Access alias -> 404
      const anonAliasRes = await app.request('/api/_lontar/access/confidential/1')
      expect(anonAliasRes.status).toBe(404)

      // Sign up admin first, then create editor
      await app.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'Password123!',
          name: 'Admin',
        }),
      })

      const { createUserWithCredential } = await import('../../auth/user')
      await createUserWithCredential(app.auth, {
        email: 'editor@example.com',
        password: 'Password123!',
        name: 'Editor',
        role: 'editor',
      })

      const loginRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'Password123!' }),
      })
      const editorCookie = loginRes.headers.get('set-cookie')!

      // Unprivileged editor -> 404
      const editorRes = await app.request('/api/_lontar/permissions/confidential/1', {
        headers: { cookie: editorCookie },
      })
      expect(editorRes.status).toBe(404)
      expect(await editorRes.json()).toEqual({ error: 'Document with ID 1 not found' })

      // Admin -> 200
      const adminLoginRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
      })
      const adminCookie = adminLoginRes.headers.get('set-cookie')!

      const adminRes = await app.request('/api/_lontar/permissions/confidential/1', {
        headers: { cookie: adminCookie },
      })
      expect(adminRes.status).toBe(200)
    })

    it('enforces document-dependent read access on permissions endpoint', async () => {
      const { app } = setupSecuredApp()

      // Article 1 is isPublic: false -> anonymous gets 404
      const privRes = await app.request('/api/_lontar/permissions/articles/1')
      expect(privRes.status).toBe(404)
      expect(await privRes.json()).toEqual({ error: 'Document with ID 1 not found' })

      // Article 2 is isPublic: true -> anonymous gets 200
      const pubRes = await app.request('/api/_lontar/permissions/articles/2')
      expect(pubRes.status).toBe(200)
      const pubPerm = (await pubRes.json()) as CollectionPermission
      expect(pubPerm.read).toBe(true)
    })

    it('hides draft-only documents without draft=true and requires update access for drafts', async () => {
      const { app } = setupSecuredApp()

      // Article 3 is draft-only -> request without draft=true returns 404
      const noDraftRes = await app.request('/api/_lontar/permissions/articles/3')
      expect(noDraftRes.status).toBe(404)

      // Request with draft=true anonymously (no update access) returns 404
      const anonDraftRes = await app.request('/api/_lontar/permissions/articles/3?draft=true')
      expect(anonDraftRes.status).toBe(404)

      // Register user who has update access (any authenticated user on articles)
      const adminSignUp = await app.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'Password123!',
          name: 'Admin',
        }),
      })
      const userCookie = adminSignUp.headers.get('set-cookie')!

      // Authenticated user with draft=true returns 200
      const authDraftRes = await app.request('/api/_lontar/permissions/articles/3?draft=true', {
        headers: { cookie: userCookie },
      })
      expect(authDraftRes.status).toBe(200)
    })

    it('returns 404 for unreadable globals to anonymous and unprivileged callers', async () => {
      const { app } = setupSecuredApp()

      // Anonymous -> 404
      const anonRes = await app.request('/api/_lontar/permissions/globals/secureConfig')
      expect(anonRes.status).toBe(404)
      expect(await anonRes.json()).toEqual({ error: 'Global "secureConfig" not found' })

      // Access alias -> 404
      const anonAliasRes = await app.request('/api/_lontar/access/globals/secureConfig')
      expect(anonAliasRes.status).toBe(404)

      // Create editor
      await app.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'Password123!',
          name: 'Admin',
        }),
      })
      const { createUserWithCredential } = await import('../../auth/user')
      await createUserWithCredential(app.auth, {
        email: 'editor@example.com',
        password: 'Password123!',
        name: 'Editor',
        role: 'editor',
      })
      const loginRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'Password123!' }),
      })
      const editorCookie = loginRes.headers.get('set-cookie')!

      // Editor -> 404
      const editorRes = await app.request('/api/_lontar/permissions/globals/secureConfig', {
        headers: { cookie: editorCookie },
      })
      expect(editorRes.status).toBe(404)

      // Admin -> 200
      const adminLoginRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
      })
      const adminCookie = adminLoginRes.headers.get('set-cookie')!
      const adminRes = await app.request('/api/_lontar/permissions/globals/secureConfig', {
        headers: { cookie: adminCookie },
      })
      expect(adminRes.status).toBe(200)
    })

    it('evaluates field create access without id or doc on document permissions endpoint (#385)', async () => {
      let createReceivedId: unknown = 'initial'
      let createReceivedDoc: unknown = 'initial'

      const inspectionCol = collection({
        slug: 'inspections',
        access: {
          read: () => true,
        },
        fields: {
          name: f.text({ required: true }),
          flag: f.text({
            access: {
              read: () => true,
              create: (ctx) => {
                createReceivedId = ctx.id
                createReceivedDoc = ctx.doc
                return true
              },
            },
          }),
        },
      })

      const customStore: Record<string, Record<number, StoredDoc>> = {
        inspections: {
          1: { id: 1, name: 'Sample', flag: 'active' },
        },
      }
      const db = buildTestDb(customStore, {})
      const config: Config = {
        secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
        db,
        collections: [inspectionCol],
      }
      const app = createLontar(config, { baseURL: 'http://localhost:3000' })

      const res = await app.request('/api/_lontar/permissions/inspections/1')
      expect(res.status).toBe(200)
      const data = (await res.json()) as CollectionPermission
      expect(data.fields.flag?.create).toBe(true)
      expect(createReceivedId).toBeUndefined()
      expect(createReceivedDoc).toBeUndefined()
    })
  })
})

describe('custom view permissions (#467)', () => {
  const user = { id: 'u1', email: 'e@x.dev', role: 'editor' }

  function viewsApp(views: NonNullable<Config['admin']>['views']) {
    const config = {
      secret: 'test-secret-value-1234567890',
      db: buildTestDb({}),
      collections: [collection({ slug: 'posts', fields: { title: f.text() } })],
      admin: { views },
    } as unknown as Config
    return createLontar(config, { baseURL: 'http://localhost:3000' })
  }

  it('leaves views out when none are configured', async () => {
    const config = {
      secret: 'test-secret-value-1234567890',
      db: buildTestDb({}),
      collections: [collection({ slug: 'posts', fields: { title: f.text() } })],
    } as unknown as Config
    const res = await createLontar(config, { baseURL: 'http://localhost:3000' }).request(
      '/api/_lontar/permissions',
    )
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('views')
  })

  it('reports the access result per view, and never the function', async () => {
    const access = vi.fn(({ user: u }: { user: { role?: string } | null }) => u?.role === 'admin')
    const app = viewsApp([
      { key: 'seo', label: 'SEO', component: 'seo', access },
      { key: 'open', label: 'Open', component: 'open', access: () => true },
    ])

    const res = await app.request('/api/_lontar/permissions')
    const body = (await res.json()) as PermissionsResponse

    expect(body.views).toEqual({ seo: false, open: true })
    expect(access).toHaveBeenCalledWith(expect.objectContaining({ user: null }))
    expect(JSON.stringify(body)).not.toContain('access')
  })

  it('without an access function, a view is for any authenticated user only', async () => {
    const { getPermissions } = await import('../../access/permissions')
    const config = {
      secret: 'test-secret-value-1234567890',
      db: buildTestDb({}),
      collections: [],
      admin: { views: [{ key: 'v', label: 'V', component: 'v' }] },
    } as unknown as Config

    expect((await getPermissions(config, user as never)).views).toEqual({ v: true })
    expect((await getPermissions(config, null)).views).toEqual({ v: false })
  })

  it('treats a throwing access function as denied', async () => {
    const { getPermissions } = await import('../../access/permissions')
    const config = {
      secret: 'test-secret-value-1234567890',
      db: buildTestDb({}),
      collections: [],
      admin: {
        views: [
          {
            key: 'v',
            label: 'V',
            component: 'v',
            access: () => {
              throw new Error('boom')
            },
          },
        ],
      },
    } as unknown as Config
    expect((await getPermissions(config, user as never)).views).toEqual({ v: false })
  })
})

describe('GET /api/_lontar/permissions with actions (#468)', () => {
  it('reports which collection actions are available evaluating endpoint access with user only', async () => {
    const { getPermissions } = await import('../../access/permissions')
    const config = {
      secret: 'test-secret-value-1234567890',
      db: buildTestDb({}),
      collections: [
        collection({
          slug: 'articles',
          endpoints: [
            {
              name: 'approve',
              method: 'post',
              path: '/:id/approve',
              access: ({ user: u }) => u?.role === 'admin',
              handler: () => new Response('ok'),
            },
            {
              name: 'comment',
              method: 'post',
              path: '/:id/comment',
              handler: () => new Response('ok'),
            },
          ],
          admin: {
            actions: [
              { key: 'approve', label: 'Approve', endpoint: 'approve', scope: ['row'] },
              { key: 'comment', label: 'Comment', endpoint: 'comment', scope: ['document'] },
              { key: 'custom', label: 'Custom', component: 'custom-comp', scope: ['document'] },
            ],
          },
          fields: { title: f.text() },
        }),
      ],
    } as unknown as Config

    const adminUser = { id: 'u1', role: 'admin', email: 'a@example.com' }
    const editorUser = { id: 'u2', role: 'editor', email: 'e@example.com' }

    const adminPerms = await getPermissions(config, adminUser as never)
    expect(adminPerms.collections.articles?.actions).toEqual({
      approve: true,
      comment: true,
      custom: true,
    })

    const editorPerms = await getPermissions(config, editorUser as never)
    expect(editorPerms.collections.articles?.actions).toEqual({
      approve: false,
      comment: true,
      custom: true,
    })

    const anonPerms = await getPermissions(config, null)
    expect(anonPerms.collections.articles?.actions).toEqual({
      approve: false,
      comment: false,
      custom: false,
    })
  })
})
