import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../auth/types'
import { collection } from '../config/collection'
import { fields as f } from '../fields'
import { validateQueryAccess } from './query-access'

function makeUser(role = 'user', email = 'u@example.com'): AuthUser {
  return {
    id: `${role}-${email}`,
    name: 'User',
    email,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    role,
  }
}

describe('validateQueryAccess', () => {
  const testCollection = collection({
    slug: 'employees',
    fields: {
      name: f.text(),
      salary: f.number({
        access: {
          read: ({ user }) => user?.role === 'admin',
        },
      }),
      department: f.text(),
      meta: f.group({
        fields: {
          publicBio: f.text(),
          ssn: f.text({
            access: {
              read: ({ user }) => user?.role === 'admin',
            },
          }),
        },
      }),
      notes: f.array({
        fields: {
          text: f.text(),
          isConfidential: f.checkbox({
            access: {
              read: ({ user }) => user?.role === 'admin',
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
              managerOnlyNote: f.text({
                access: {
                  read: ({ user }) => user?.role === 'admin',
                },
              }),
            },
          },
        ],
      }),
    },
  })

  it('allows system fields and readable fields for regular user', async () => {
    const user = makeUser('user')
    const issues = await validateQueryAccess(
      {
        and: [
          { id: { equals: 1 } },
          { name: { equals: 'Alice' } },
          { 'meta.publicBio': { contains: 'developer' } },
        ],
      },
      ['name', 'id'],
      testCollection,
      user,
    )
    expect(issues).toEqual([])
  })

  it('allows all fields for admin user', async () => {
    const admin = makeUser('admin')
    const issues = await validateQueryAccess(
      {
        salary: { gt: 50000 },
        'meta.ssn': { equals: '123' },
      },
      ['-salary', 'meta.ssn'],
      testCollection,
      admin,
    )
    expect(issues).toEqual([])
  })

  it('rejects unreadable top-level field in where', async () => {
    const user = makeUser('user')
    const issues = await validateQueryAccess(
      { salary: { gt: 50000 } },
      undefined,
      testCollection,
      user,
    )
    expect(issues).toEqual([
      {
        path: 'salary',
        message: "Field 'salary' cannot be filtered or sorted by current user",
      },
    ])
  })

  it('rejects unreadable top-level field in sort', async () => {
    const user = makeUser('user')
    const issues = await validateQueryAccess(undefined, '-salary', testCollection, user)
    expect(issues).toEqual([
      {
        path: 'salary',
        message: "Field 'salary' cannot be filtered or sorted by current user",
      },
    ])
  })

  it('rejects unreadable nested group field (dot and object notation)', async () => {
    const user = makeUser('user')
    const issuesDot = await validateQueryAccess(
      { 'meta.ssn': { equals: '123' } },
      undefined,
      testCollection,
      user,
    )
    expect(issuesDot).toEqual([
      {
        path: 'meta.ssn',
        message: "Field 'meta.ssn' cannot be filtered or sorted by current user",
      },
    ])

    const issuesObj = await validateQueryAccess(
      { meta: { ssn: { equals: '123' } } },
      undefined,
      testCollection,
      user,
    )
    expect(issuesObj).toEqual([
      {
        path: 'meta.ssn',
        message: "Field 'meta.ssn' cannot be filtered or sorted by current user",
      },
    ])
  })

  it('rejects unreadable array and blocks field paths', async () => {
    const user = makeUser('user')
    const issues = await validateQueryAccess(
      {
        and: [
          { 'notes.isConfidential': { equals: true } },
          { 'blocks.review.managerOnlyNote': { contains: 'secret' } },
        ],
      },
      undefined,
      testCollection,
      user,
    )
    expect(issues).toEqual([
      {
        path: 'notes.isConfidential',
        message: "Field 'notes.isConfidential' cannot be filtered or sorted by current user",
      },
      {
        path: 'blocks.review.managerOnlyNote',
        message:
          "Field 'blocks.review.managerOnlyNote' cannot be filtered or sorted by current user",
      },
    ])
  })
})

describe('validateQueryAccess with document-dependent read access', () => {
  const docCollection = collection({
    slug: 'articles',
    fields: {
      title: f.text(),
      internal: f.text({
        access: {
          // Returns true when no document is supplied, which must not open the field to filters.
          read: ({ doc }) => !doc || (doc as { public?: boolean }).public === true,
        },
      }),
    },
  })

  it('denies filtering and sorting on a field whose read rule depends on the document', async () => {
    const user = makeUser('editor')
    expect(
      await validateQueryAccess({ internal: { equals: 'x' } }, undefined, docCollection, user),
    ).toEqual([
      {
        path: 'internal',
        message: "Field 'internal' cannot be filtered or sorted by current user",
      },
    ])
    expect(await validateQueryAccess(undefined, '-internal', docCollection, user)).toHaveLength(1)
  })

  it('still allows fields without document-dependent rules', async () => {
    expect(
      await validateQueryAccess({ title: { equals: 'x' } }, 'title', docCollection, makeUser()),
    ).toEqual([])
  })
})

describe('validateQueryAccess with locale-suffixed paths', () => {
  const localized = collection({
    slug: 'notes',
    fields: {
      title: f.text({ localized: true }),
      secretNote: f.text({
        localized: true,
        access: { read: ({ user }) => user?.role === 'admin' },
      }),
      seo: f.group({
        fields: {
          hidden: f.text({
            localized: true,
            access: { read: ({ user }) => user?.role === 'admin' },
          }),
        },
      }),
      layout: f.blocks({
        localized: true,
        access: { read: ({ user }) => user?.role === 'admin' },
        blocks: [{ slug: 'hero', fields: { heading: f.text() } }],
      }),
    },
  })

  it('denies where on a locale-suffixed field the user cannot read', async () => {
    const issues = await validateQueryAccess(
      { secretNote_en: { contains: 'x' } },
      undefined,
      localized,
      makeUser(),
    )
    expect(issues.map((i) => i.path)).toEqual(['secretNote_en'])
  })

  it('denies sort and nested group paths with a locale suffix', async () => {
    const issues = await validateQueryAccess(
      { seo__hidden_en: { equals: 'x' } },
      '-secretNote_id',
      localized,
      makeUser(),
    )
    expect(issues.map((i) => i.path).sort()).toEqual(['secretNote_id', 'seo__hidden_en'])
  })

  it('denies a locale-suffixed blocks path', async () => {
    const issues = await validateQueryAccess(
      { 'layout_en.blockType': { equals: 'hero' } },
      undefined,
      localized,
      makeUser(),
    )
    expect(issues).toHaveLength(1)
  })

  it('allows readable suffixed fields and permitted users', async () => {
    expect(
      await validateQueryAccess({ title_en: { equals: 'x' } }, undefined, localized, makeUser()),
    ).toEqual([])
    expect(
      await validateQueryAccess(
        { secretNote_en: { equals: 'x' } },
        undefined,
        localized,
        makeUser('admin'),
      ),
    ).toEqual([])
  })
})
