import { describe, expect, it } from 'vitest'
import { fakeAdapter, Posts, SECRET } from '../__fixtures__/posts'
import { fields as f } from '../fields'
import { defineConfig, LontarConfigError } from './define-config'
import type { CollectionConfig } from './types'

function notes(overrides: Partial<CollectionConfig> = {}): CollectionConfig {
  return { slug: 'notes', fields: { title: f.text() }, ...overrides }
}

function issuesOf(collections: CollectionConfig[]): readonly string[] {
  try {
    defineConfig({ secret: SECRET, db: fakeAdapter, collections })
  } catch (error) {
    if (error instanceof LontarConfigError) return error.issues
    throw error
  }
  return []
}

describe('defineConfig', () => {
  it('returns a valid config unchanged', () => {
    const config = { secret: SECRET, db: fakeAdapter, collections: [Posts] }
    expect(defineConfig(config)).toBe(config)
  })

  // `undefined` is what `secret: process.env.LONTAR_SECRET!` gives when the variable is unset.
  it.each([[''], [undefined]])('rejects a secret of %j', (secret) => {
    const run = () =>
      defineConfig({ secret: secret as string, db: fakeAdapter, collections: [Posts] })
    expect(run).toThrow('`secret` must be a non-empty string')
  })

  it('rejects a slug used twice', () => {
    expect(issuesOf([notes(), notes()])).toEqual(['Collection slug "notes" is used twice.'])
  })

  it.each(['Notes', 'blog_posts', '1notes', ''])('rejects the non-kebab-case slug %j', (slug) => {
    expect(issuesOf([notes({ slug })])).toEqual([expect.stringContaining('must be kebab-case')])
  })

  it('rejects a slug that collides with a fixed route', () => {
    expect(issuesOf([notes({ slug: 'globals' })])).toEqual([
      'Collection slug "globals" is reserved.',
    ])
  })

  it.each(['my-field', '2nd', 'has space'])('rejects the field name %j', (name) => {
    expect(issuesOf([notes({ fields: { [name]: f.text() } })])).toEqual([
      expect.stringContaining(`field name "${name}" must start with`),
    ])
  })

  it.each(['id', 'createdAt', 'updatedAt'])('rejects the system field name %j', (name) => {
    expect(issuesOf([notes({ fields: { [name]: f.text() } })])).toEqual([
      `Collection "notes": field name "${name}" is reserved for a system field.`,
    ])
  })

  it('rejects admin options that name an unknown field', () => {
    const collection = notes({
      admin: { useAsTitle: 'heading', defaultColumns: ['title', 'body'] },
    })
    expect(issuesOf([collection])).toEqual([
      'Collection "notes": admin.useAsTitle refers to unknown field "heading".',
      'Collection "notes": admin.defaultColumns refers to unknown field "body".',
    ])
  })

  it('accepts admin options that name system fields', () => {
    const collection = notes({ admin: { useAsTitle: 'id', defaultColumns: ['id', 'createdAt'] } })
    expect(issuesOf([collection])).toEqual([])
  })

  it('accepts valid access functions', () => {
    const collection = notes({
      access: {
        read: () => true,
        create: ({ user }) => Boolean(user),
        update: () => false,
        delete: () => false,
      },
    })
    expect(issuesOf([collection])).toEqual([])
  })

  it('rejects access properties that are not functions', () => {
    const collection = notes({
      access: {
        // @ts-expect-error test invalid access property
        read: 'invalid',
        // @ts-expect-error test invalid access property
        delete: 123,
      },
    })
    expect(issuesOf([collection])).toEqual([
      'Collection "notes": access.read must be a function.',
      'Collection "notes": access.delete must be a function.',
    ])
  })

  it('reports every problem in one error', () => {
    const run = () =>
      defineConfig({
        secret: '',
        db: fakeAdapter,
        collections: [notes({ slug: 'Notes', fields: { id: f.number() } })],
      })

    expect(run).toThrow(LontarConfigError)
    expect(run).toThrow(/secret[\s\S]*kebab-case[\s\S]*reserved for a system field/)
  })

  it('validates globals configuration', () => {
    const valid = defineConfig({
      secret: SECRET,
      db: fakeAdapter,
      collections: [notes()],
      globals: [
        {
          slug: 'header',
          fields: { title: f.text() },
          access: { read: () => true, update: () => true },
        },
      ],
    })
    expect(valid.globals).toBeDefined()

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          { slug: 'header', fields: { title: f.text() } },
          { slug: 'header', fields: { title: f.text() } },
        ],
      }),
    ).toThrow('Global slug "header" is used twice.')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes({ slug: 'header' })],
        globals: [{ slug: 'header', fields: { title: f.text() } }],
      }),
    ).toThrow('Global slug "header" collides with a collection slug.')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [{ slug: 'Header', fields: { title: f.text() } }],
      }),
    ).toThrow('must be kebab-case')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [{ slug: 'globals', fields: { title: f.text() } }],
      }),
    ).toThrow('Global slug "globals" is reserved.')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [{ slug: 'header', fields: { id: f.text() } }],
      }),
    ).toThrow('reserved for a system field')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          {
            slug: 'header',
            fields: { title: f.text() },
            // @ts-expect-error invalid access function
            access: { read: 'invalid' },
          },
        ],
      }),
    ).toThrow('access.read must be a function')
  })

  it('rejects upload collection without storage adapter configured', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes({ upload: true })],
      }),
    ).toThrow('A collection has `upload` enabled, but no `storage` adapter was provided')
  })

  it('accepts upload collection when storage adapter is provided', () => {
    const mockStorage = {
      name: 'test-storage',
      upload: () => Promise.resolve({ filename: 'f', url: 'u' }),
      delete: () => Promise.resolve(),
      getUrl: () => 'u',
    }
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      storage: mockStorage,
      collections: [notes({ upload: true })],
    }
    expect(defineConfig(config)).toBe(config)
  })
})
