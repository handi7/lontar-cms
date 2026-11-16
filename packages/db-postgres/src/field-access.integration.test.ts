import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import {
  collection,
  createLontar,
  createUserWithCredential,
  defineConfig,
  fields as f,
  getLontar,
  type AuthUser,
  type Config,
} from '@lontar/core'
import { findDrizzleKitBin } from '@lontar/db-test-suite'
import { postgresAdapter, type PostgresAdapter } from './adapter'
import { isPostgresAvailable, setupTestDatabase, type TestDatabase } from './test-database'

const postgresAvailable = await isPostgresAvailable()

const employees = collection({
  slug: 'employees',
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
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
        text: f.text({ required: true }),
        isConfidential: f.checkbox({
          access: {
            read: ({ user }) => user?.role === 'admin',
            create: ({ user }) => user?.role === 'admin',
            update: ({ user }) => user?.role === 'admin',
          },
        }),
      },
    }),
    blocks: f.blocks({
      blocks: [
        {
          slug: 'review',
          fields: {
            rating: f.number({ required: true }),
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

const projects = collection({
  slug: 'projects',
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: {
    title: f.text({ required: true }),
    lead: f.relationship({
      relationTo: 'employees',
    }),
  },
})

interface EmployeeResponse {
  id: number
  name: string
  salary?: number
  meta?: {
    publicBio?: string
    ssn?: string
  }
  notes?: Array<{ id: string; text: string; isConfidential?: boolean }>
  blocks?: Array<{ id: string; blockType: string; rating?: number; managerNote?: string }>
}

interface ProjectResponse {
  id: number
  title: string
  lead?: EmployeeResponse
}

function assertAdminEmployeeRead(doc: EmployeeResponse): void {
  expect(doc.salary).toBe(150000)
  expect(doc.meta!.ssn).toBe('123-45-6789')
  expect(doc.notes![0]!.isConfidential).toBe(true)
  expect(doc.blocks![0]!.managerNote).toBe('Promote soon')
}

function assertUserEmployeeRead(doc: EmployeeResponse): void {
  expect(doc.name).toBe('Alice')
  expect(doc.salary).toBeUndefined()
  expect(doc.meta!.publicBio).toBe('Staff Engineer')
  expect(doc.meta!.ssn).toBeUndefined()
  expect(doc.notes![0]!.text).toBe('Quarterly review done')
  expect(doc.notes![0]!.isConfidential).toBeUndefined()
  expect(doc.blocks![0]!.blockType).toBe('review')
  expect(doc.blocks![0]!.rating).toBe(5)
  expect(doc.blocks![0]!.managerNote).toBeUndefined()
}

function assertUserProjectRead(doc: ProjectResponse): void {
  expect(doc.title).toBe('Project Titan')
  expect(doc.lead!.name).toBe('Alice')
  expect(doc.lead!.salary).toBeUndefined()
  expect(doc.lead!.meta!.ssn).toBeUndefined()
}

describe.skipIf(!postgresAvailable)('Field-Level Access Control PostgreSQL (integration)', () => {
  let testDb: TestDatabase
  let adapter: PostgresAdapter
  let tempDir: string
  let migrationsDir: string
  let pool: pg.Pool
  let adminCookie: string
  let regularCookie: string
  let regularUser: AuthUser
  let testConfig: Config

  beforeAll(async () => {
    testDb = await setupTestDatabase()
    pool = new pg.Pool({ connectionString: testDb.url })
    adapter = postgresAdapter({ url: testDb.url })

    testConfig = defineConfig({
      secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
      db: adapter,
      collections: [employees, projects],
    })

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-field-access-pg-'))
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

    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    // 1. Create first user (admin)
    const adminRes = await app.request('/api/_lontar/first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password123!',
        name: 'Admin User',
      }),
    })
    expect(adminRes.status).toBe(200)
    adminCookie = adminRes.headers.get('set-cookie')!

    // 2. Create regular user
    const createdUser = await createUserWithCredential(app.auth, {
      email: 'editor@example.com',
      password: 'Password123!',
      name: 'Editor User',
      role: 'editor',
    })
    regularUser = createdUser as unknown as AuthUser

    const loginRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'editor@example.com',
        password: 'Password123!',
      }),
    })
    expect(loginRes.status).toBe(200)
    regularCookie = loginRes.headers.get('set-cookie')!
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

  it('enforces read stripping across top-level, group, array, and blocks', async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    // Admin creates employee
    const createEmpRes = await app.request('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Alice',
        salary: 150000,
        meta: { publicBio: 'Staff Engineer', ssn: '123-45-6789' },
        notes: [{ text: 'Quarterly review done', isConfidential: true }],
        blocks: [{ blockType: 'review', rating: 5, managerNote: 'Promote soon' }],
      }),
    })
    expect(createEmpRes.status).toBe(201)
    const empDoc = (await createEmpRes.json()) as { id: number }
    const empId = empDoc.id

    // Admin reads employee -> sees everything
    const adminReadRes = await app.request(`/api/employees/${empId}`, {
      headers: { cookie: adminCookie },
    })
    expect(adminReadRes.status).toBe(200)
    assertAdminEmployeeRead((await adminReadRes.json()) as EmployeeResponse)

    // Regular user reads employee -> sensitive fields are stripped
    const userReadRes = await app.request(`/api/employees/${empId}`, {
      headers: { cookie: regularCookie },
    })
    expect(userReadRes.status).toBe(200)
    assertUserEmployeeRead((await userReadRes.json()) as EmployeeResponse)
  })

  it('enforces read stripping on populated relationships', async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    const createEmpRes = await app.request('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Alice',
        salary: 150000,
        meta: { publicBio: 'Staff Engineer', ssn: '123-45-6789' },
      }),
    })
    expect(createEmpRes.status).toBe(201)
    const empDoc = (await createEmpRes.json()) as { id: number }
    const empId = empDoc.id

    // Admin creates project referencing employee
    const createProjRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        title: 'Project Titan',
        lead: empId,
      }),
    })
    expect(createProjRes.status).toBe(201)
    const projDoc = (await createProjRes.json()) as { id: number }
    const projId = projDoc.id

    // Regular user reads project with depth: 1 -> lead's sensitive fields are stripped
    const projReadRes = await app.request(`/api/projects/${projId}?depth=1`, {
      headers: { cookie: regularCookie },
    })
    expect(projReadRes.status).toBe(200)
    assertUserProjectRead((await projReadRes.json()) as ProjectResponse)
  })

  it('silently drops forbidden fields on create and update, preserving existing database values', async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    // Regular user creates employee with forbidden salary and ssn
    const createRes = await app.request('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: regularCookie },
      body: JSON.stringify({
        name: 'Bob',
        salary: 90000,
        meta: { publicBio: 'Junior Dev', ssn: '000-00-0000' },
      }),
    })
    expect(createRes.status).toBe(201)
    const createdDoc = (await createRes.json()) as { id: number }
    const bobId = createdDoc.id

    // Check direct database values for Bob
    const bobRes = await pool.query<{
      name: string
      salary: number | null
      meta__publicBio: string | null
      meta__ssn: string | null
    }>('SELECT "name", "salary", "meta__publicBio", "meta__ssn" FROM "employees" WHERE "id" = $1', [
      bobId,
    ])
    expect(bobRes.rows[0]?.name).toBe('Bob')
    expect(bobRes.rows[0]?.salary).toBeNull()
    expect(bobRes.rows[0]?.meta__publicBio).toBe('Junior Dev')
    expect(bobRes.rows[0]?.meta__ssn).toBeNull()

    // Admin updates Bob to have a valid salary and ssn
    await app.request(`/api/employees/${bobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        salary: 95000,
        meta: { ssn: '999-99-9999' },
      }),
    })

    // Verify DB now has 95000
    const bobUpdatedRes = await pool.query<{ salary: number | null }>(
      'SELECT salary FROM employees WHERE id = $1',
      [bobId],
    )
    expect(Number(bobUpdatedRes.rows[0]?.salary)).toBe(95000)

    // Regular user attempts to update Bob's salary to 120000
    const userUpdateRes = await app.request(`/api/employees/${bobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: regularCookie },
      body: JSON.stringify({
        name: 'Robert',
        salary: 120000,
      }),
    })
    expect(userUpdateRes.status).toBe(200)

    // Verify Bob's salary in DB was NOT changed by regular user
    const bobCheckRes = await pool.query<{ name: string; salary: number | null }>(
      'SELECT name, salary FROM employees WHERE id = $1',
      [bobId],
    )
    expect(bobCheckRes.rows[0]?.name).toBe('Robert')
    expect(Number(bobCheckRes.rows[0]?.salary)).toBe(95000)
  })

  it('rejects where filter and sort on unreadable field with 400 Bad Request', async () => {
    const app = createLontar(testConfig, { baseURL: 'http://localhost:3000' })

    const whereRes = await app.request('/api/employees?where[salary][greater_than]=50000', {
      headers: { cookie: regularCookie },
    })
    expect(whereRes.status).toBe(400)
    expect(await whereRes.json()).toEqual({
      error: 'Validation failed',
      message: "Field 'salary' cannot be filtered or sorted by current user",
      issues: [
        {
          path: 'salary',
          message: "Field 'salary' cannot be filtered or sorted by current user",
        },
      ],
    })

    const sortRes = await app.request('/api/employees?sort=-salary', {
      headers: { cookie: regularCookie },
    })
    expect(sortRes.status).toBe(400)
    expect(await sortRes.json()).toEqual({
      error: 'Validation failed',
      message: "Field 'salary' cannot be filtered or sorted by current user",
      issues: [
        {
          path: 'salary',
          message: "Field 'salary' cannot be filtered or sorted by current user",
        },
      ],
    })
  })

  it('enforces field access in Local API with overrideAccess: false', async () => {
    const lontar = await getLontar(testConfig)

    // Local API with overrideAccess: true (default) returns all fields
    const full = await lontar.find('employees', { overrideAccess: true })
    const fullAlice = full.docs.find((d) => d.name === 'Alice')
    expect(fullAlice?.salary).toBe(150000)

    // Local API with overrideAccess: false, user: regularUser strips fields
    const restricted = await lontar.find('employees', {
      overrideAccess: false,
      user: regularUser,
    })
    const restAlice = restricted.docs.find((d) => d.name === 'Alice')
    expect(restAlice?.name).toBe('Alice')
    expect(restAlice?.salary).toBeUndefined()
    expect((restAlice?.meta as Record<string, unknown> | undefined)?.ssn).toBeUndefined()

    // Local API with overrideAccess: false, where on unreadable field throws ValidationError
    await expect(
      lontar.find('employees', {
        where: { salary: { greater_than: 50000 } },
        overrideAccess: false,
        user: regularUser,
      }),
    ).rejects.toThrow('Validation failed')
  })
})
