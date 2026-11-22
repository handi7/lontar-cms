import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  collection,
  createLontar,
  createUserWithCredential,
  defineConfig,
  fields as f,
  type AccessArgs,
  type AuthUser,
  type Config,
  type DatabaseAdapter,
  type Where,
} from '@lontar/core'
import { findDrizzleKitBin } from './drizzle-kit'
import type { ConformanceSuiteContext, TestDatabaseHandle } from './types'

// ADR 0030 (#470): the same row-level constraints must select the same rows on every adapter,
// through plain, nested, localized and relationship paths, for reads, writes, versions and
// population. Everything goes through the REST app so the whole stack is exercised.

const isAdmin = (user: AuthUser | null): boolean => user?.role === 'admin'

// The relationship constraint closes over an id that is only known after seeding.
let visibleArticleId = 0

function constrained(rule: (args: AccessArgs) => Where): (args: AccessArgs) => boolean | Where {
  return (args) => (isAdmin(args.user) ? true : args.user ? rule(args) : false)
}

const owned = constrained(({ user }) => ({ owner: { equals: user?.id } }))
const signedIn = ({ user }: AccessArgs): boolean => Boolean(user)

const articles = collection({
  slug: 'articles',
  versions: { drafts: true },
  access: { read: owned, create: signedIn, update: owned, delete: owned },
  fields: { title: f.text(), owner: f.text() },
})

const notes = collection({
  slug: 'notes',
  access: {
    read: constrained(() => ({ 'meta.visibility': { equals: 'public' } })),
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: { title: f.text(), meta: f.group({ fields: { visibility: f.text() } }) },
})

const labels = collection({
  slug: 'labels',
  access: {
    read: constrained(() => ({ title: { contains: 'Public' } })),
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: { title: f.text({ localized: true }) },
})

const reviews = collection({
  slug: 'reviews',
  access: {
    read: constrained(() => ({ article: { equals: visibleArticleId } })),
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: { body: f.text(), article: f.relationship({ relationTo: 'articles' }) },
})

const comments = collection({
  slug: 'comments',
  access: { read: () => true, create: signedIn, update: signedIn, delete: signedIn },
  fields: { body: f.text(), post: f.relationship({ relationTo: 'articles' }) },
})

interface ListBody<T> {
  docs: T[]
  totalDocs: number
}

export function registerRowAccessConformanceSuite(context: ConformanceSuiteContext): void {
  describe(`${context.name}: row-level access constraints (integration)`, () => {
    let testDb: TestDatabaseHandle
    let adapter: DatabaseAdapter
    let config: Config
    let tempDir: string
    let app: ReturnType<typeof createLontar>
    let adminCookie: string
    let editorCookie: string
    let editorId: string
    // Filled by beforeAll; zero until then.
    const ids = {
      mine: 0,
      theirs: 0,
      publicNote: 0,
      privateNote: 0,
      publicLabel: 0,
      hiddenLabel: 0,
      reviewMine: 0,
      reviewTheirs: 0,
      commentMine: 0,
      commentTheirs: 0,
    }

    const json = { 'Content-Type': 'application/json' }
    const request = (cookie: string, url: string, init: RequestInit = {}) =>
      app.request(url, { ...init, headers: { ...json, cookie, ...init.headers } })
    const send = (cookie: string, method: string, url: string, body?: unknown) =>
      request(cookie, url, { method, body: body === undefined ? undefined : JSON.stringify(body) })
    const list = async <T = Record<string, unknown>>(cookie: string, url: string) => {
      const res = await request(cookie, url)
      expect(res.status).toBe(200)
      return (await res.json()) as ListBody<T>
    }
    async function seed(cookie: string, url: string, body: unknown): Promise<number> {
      const res = await send(cookie, 'POST', url, body)
      expect(res.status).toBe(201)
      return ((await res.json()) as { id: number }).id
    }

    beforeAll(async () => {
      testDb = await context.setupTestDatabase()
      adapter = context.createAdapter(testDb.url)
      config = defineConfig({
        secret: 'a-very-long-secret-key-that-is-at-least-32-chars-long!',
        db: adapter,
        collections: [articles, notes, labels, reviews, comments],
        localization: { locales: ['en', 'id'], defaultLocale: 'en' },
      })

      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lontar-row-access-${context.dialect}-`))
      const schemaFile = path.join(tempDir, 'schema.ts')
      const migrationsDir = path.join(tempDir, 'migrations')
      fs.writeFileSync(schemaFile, adapter.toSchemaFile(config), 'utf-8')
      execFileSync(process.execPath, [
        findDrizzleKitBin(),
        'generate',
        '--dialect',
        context.dialect,
        '--schema',
        schemaFile,
        '--out',
        migrationsDir,
      ])
      await adapter.migrate({ migrationsDir })

      app = createLontar(config, { baseURL: 'http://localhost:3000' })
      const adminRes = await app.request('/api/_lontar/first-user', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'Password123!',
          name: 'Admin User',
        }),
      })
      expect(adminRes.status).toBe(200)
      adminCookie = adminRes.headers.get('set-cookie')!

      const editor = await createUserWithCredential(app.auth, {
        email: 'editor@example.com',
        password: 'Password123!',
        name: 'Editor User',
        role: 'editor',
      })
      editorId = String((editor as unknown as AuthUser).id)
      const loginRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: 'editor@example.com', password: 'Password123!' }),
      })
      expect(loginRes.status).toBe(200)
      editorCookie = loginRes.headers.get('set-cookie')!

      ids.mine = await seed(adminCookie, '/api/articles', { title: 'Mine', owner: editorId })
      ids.theirs = await seed(adminCookie, '/api/articles', { title: 'Theirs', owner: 'someone' })
      visibleArticleId = ids.mine

      ids.publicNote = await seed(adminCookie, '/api/notes', {
        title: 'Open',
        meta: { visibility: 'public' },
      })
      ids.privateNote = await seed(adminCookie, '/api/notes', {
        title: 'Closed',
        meta: { visibility: 'private' },
      })

      ids.publicLabel = await seed(adminCookie, '/api/labels?locale=en', { title: 'Public label' })
      const idRes = await send(adminCookie, 'PATCH', `/api/labels/${ids.publicLabel}?locale=id`, {
        title: 'Label umum',
      })
      expect(idRes.status).toBe(200)
      ids.hiddenLabel = await seed(adminCookie, '/api/labels?locale=en', { title: 'Hidden label' })

      ids.reviewMine = await seed(adminCookie, '/api/reviews', { body: 'R1', article: ids.mine })
      ids.reviewTheirs = await seed(adminCookie, '/api/reviews', {
        body: 'R2',
        article: ids.theirs,
      })

      ids.commentMine = await seed(adminCookie, '/api/comments', { body: 'C1', post: ids.mine })
      ids.commentTheirs = await seed(adminCookie, '/api/comments', {
        body: 'C2',
        post: ids.theirs,
      })
    })

    afterAll(async () => {
      try {
        const closable = adapter as { close?: () => Promise<void> }
        if (typeof closable.close === 'function') await closable.close()
        if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
      } finally {
        if (testDb) await testDb.teardown()
      }
    })

    it('lists only the rows inside the constraint, and counts only those', async () => {
      const mine = await list<{ id: number }>(editorCookie, '/api/articles')
      expect(mine.docs.map((d) => d.id)).toEqual([ids.mine])
      expect(mine.totalDocs).toBe(1)

      const all = await list(adminCookie, '/api/articles')
      expect(all.totalDocs).toBe(2)
    })

    it('does not let the request widen the constraint', async () => {
      const other = await list(editorCookie, '/api/articles?where[owner][equals]=someone')
      expect(other.docs).toEqual([])

      const viaOr = await list(
        editorCookie,
        '/api/articles?where[or][0][owner][equals]=someone&where[or][1][title][equals]=Mine',
      )
      expect(viaOr.docs.map((d) => (d as { id: number }).id)).toEqual([ids.mine])
    })

    it('reads one row inside the constraint, and a row outside is 404 like a missing id', async () => {
      const inside = await request(editorCookie, `/api/articles/${ids.mine}`)
      expect(inside.status).toBe(200)

      const outside = await request(editorCookie, `/api/articles/${ids.theirs}`)
      const missing = await request(editorCookie, '/api/articles/999999')
      expect(outside.status).toBe(404)
      expect(missing.status).toBe(404)
      const outsideBody = (await outside.json()) as { error: string }
      const missingBody = (await missing.json()) as { error: string }
      expect(outsideBody.error.replace(String(ids.theirs), 'N')).toBe(
        missingBody.error.replace('999999', 'N'),
      )
    })

    it('updates a row inside the constraint and leaves a row outside it untouched', async () => {
      const outside = await send(editorCookie, 'PATCH', `/api/articles/${ids.theirs}`, {
        title: 'Hijacked',
      })
      expect(outside.status).toBe(404)
      const stored = await request(adminCookie, `/api/articles/${ids.theirs}`)
      expect(((await stored.json()) as { title: string }).title).toBe('Theirs')

      const inside = await send(editorCookie, 'PATCH', `/api/articles/${ids.mine}`, {
        title: 'Mine, edited',
      })
      expect(inside.status).toBe(200)
      const after = await request(adminCookie, `/api/articles/${ids.mine}`)
      expect(((await after.json()) as { title: string }).title).toBe('Mine, edited')
    })

    it('deletes a row inside the constraint and keeps a row outside it', async () => {
      const outside = await send(editorCookie, 'DELETE', `/api/articles/${ids.theirs}`)
      expect(outside.status).toBe(404)
      expect((await request(adminCookie, `/api/articles/${ids.theirs}`)).status).toBe(200)

      const created = await seed(editorCookie, '/api/articles', { title: 'Temp', owner: editorId })
      const inside = await send(editorCookie, 'DELETE', `/api/articles/${created}`)
      expect(inside.status).toBe(200)
      expect((await request(adminCookie, `/api/articles/${created}`)).status).toBe(404)
    })

    it('publishes and lists versions only for a row inside the constraint', async () => {
      const outsidePublish = await send(editorCookie, 'POST', `/api/articles/${ids.theirs}/publish`)
      expect(outsidePublish.status).toBe(404)
      const outsideVersions = await request(editorCookie, `/api/articles/${ids.theirs}/versions`)
      expect(outsideVersions.status).toBe(404)

      const insideVersions = await request(editorCookie, `/api/articles/${ids.mine}/versions`)
      expect(insideVersions.status).toBe(200)
    })

    it('applies a constraint on a nested group path', async () => {
      const visible = await list<{ id: number }>(editorCookie, '/api/notes')
      expect(visible.docs.map((d) => d.id)).toEqual([ids.publicNote])
      expect((await request(editorCookie, `/api/notes/${ids.privateNote}`)).status).toBe(404)
      expect((await request(editorCookie, `/api/notes/${ids.publicNote}`)).status).toBe(200)
    })

    it('evaluates a constraint on a localized field in the request locale', async () => {
      const en = await list<{ id: number }>(editorCookie, '/api/labels?locale=en')
      expect(en.docs.map((d) => d.id)).toEqual([ids.publicLabel])

      const id = await list(editorCookie, '/api/labels?locale=id')
      expect(id.docs).toEqual([])
    })

    it('applies a constraint on a relationship path', async () => {
      const visible = await list<{ id: number }>(editorCookie, '/api/reviews')
      expect(visible.docs.map((d) => d.id)).toEqual([ids.reviewMine])
      expect((await request(editorCookie, `/api/reviews/${ids.reviewTheirs}`)).status).toBe(404)
    })

    it('does not populate a related document outside the target constraint', async () => {
      const res = await list<{ id: number; post: unknown }>(editorCookie, '/api/comments?depth=1')
      const byId = new Map(res.docs.map((d) => [d.id, d.post]))
      expect(byId.get(ids.commentMine)).toMatchObject({ id: ids.mine })
      expect(byId.get(ids.commentTheirs)).toBeNull()

      const admin = await list<{ id: number; post: unknown }>(adminCookie, '/api/comments?depth=1')
      for (const doc of admin.docs)
        expect(doc.post).toMatchObject({ id: expect.any(Number) as number })
    })

    it('answers the permissions endpoints exactly', async () => {
      const inside = await request(editorCookie, `/api/_lontar/permissions/articles/${ids.mine}`)
      expect(inside.status).toBe(200)
      expect(await inside.json()).toMatchObject({ read: true, update: true, delete: true })

      const outside = await request(editorCookie, `/api/_lontar/permissions/articles/${ids.theirs}`)
      expect(outside.status).toBe(404)

      const overview = await request(editorCookie, '/api/_lontar/permissions')
      const body = (await overview.json()) as {
        collections: Record<string, { read: boolean; constrained?: { read?: boolean } }>
      }
      expect(body.collections.articles).toMatchObject({ read: true, constrained: { read: true } })
      const adminOverview = await request(adminCookie, '/api/_lontar/permissions')
      const adminBody = (await adminOverview.json()) as {
        collections: Record<string, { constrained?: unknown }>
      }
      expect(adminBody.collections.articles).not.toHaveProperty('constrained')
    })
  })
}
