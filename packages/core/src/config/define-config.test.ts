import { describe, expect, it } from 'vitest'
import { fakeAdapter, Posts, SECRET } from '../__fixtures__/posts'
import { block, fields as f } from '../fields'
import { defineConfig, LontarConfigError } from './define-config'
import type {
  CollectionConfig,
  CollectionWebhookConfig,
  WebhookConfig,
  WebhookEvent,
} from './types'

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

  it('rejects slugs that collide with auth tables or fixed routes (#375)', () => {
    for (const slug of [
      'globals',
      'auth',
      'user',
      'session',
      'account',
      'verification',
      'apikey',
      'rate-limit',
      'ratelimit',
    ]) {
      expect(issuesOf([notes({ slug })])).toEqual([`Collection slug "${slug}" is reserved.`])
    }
  })

  it('rejects collection slugs that generate colliding schema identifiers (#375)', () => {
    expect(issuesOf([notes({ slug: 'foo-1' }), notes({ slug: 'foo1' })])).toEqual([
      'Collection slug "foo1" generates identifier "foo1" which collides with "foo-1".',
    ])
  })

  it('allows non-colliding slugs containing api or limit', () => {
    expect(issuesOf([notes({ slug: 'api-keys' })])).toEqual([])
    expect(issuesOf([notes({ slug: 'rate-limits' })])).toEqual([])
  })

  it.each(['my-field', '2nd', 'has space'])('rejects the field name %j', (name) => {
    expect(issuesOf([notes({ fields: { [name]: f.text() } })])).toEqual([
      expect.stringContaining(`field name "${name}" must start with`),
    ])
  })

  it('rejects field names containing "__" (reserved as group-column separator)', () => {
    expect(issuesOf([notes({ fields: { weird__name: f.text() } })])).toEqual([
      'Collection "notes": field name "weird__name" cannot contain "__" (reserved as the group-column separator).',
    ])
  })

  it('rejects nested field names containing "__" in groups, arrays, and blocks', () => {
    const collection = notes({
      fields: {
        seo: f.group({
          fields: {
            bad__subfield: f.text(),
          },
        }),
        gallery: f.array({
          fields: {
            img__alt: f.text(),
          },
        }),
        layout: f.blocks({
          blocks: [
            block({
              slug: 'hero',
              fields: {
                hero__title: f.text(),
              },
            }),
          ],
        }),
      },
    })
    expect(issuesOf([collection])).toEqual([
      'Collection "notes" -> group "seo": field name "bad__subfield" cannot contain "__" (reserved as the group-column separator).',
      'Collection "notes" -> array "gallery": field name "img__alt" cannot contain "__" (reserved as the group-column separator).',
      'Collection "notes" -> blocks "layout" -> block "hero": field name "hero__title" cannot contain "__" (reserved as the group-column separator).',
    ])
  })

  it.each(['id', '_status', 'createdAt', 'updatedAt'])(
    'rejects the system field name %j',
    (name) => {
      expect(issuesOf([notes({ fields: { [name]: f.text() } })])).toEqual([
        `Collection "notes": field name "${name}" is reserved for a system field.`,
      ])
    },
  )

  it('validates versions configuration on collections', () => {
    expect(issuesOf([notes({ versions: 'invalid' as never })])).toEqual([
      'Collection "notes": `versions` must be an object.',
    ])
    expect(issuesOf([notes({ versions: { drafts: 'yes' as never } })])).toEqual([
      'Collection "notes": versions.drafts must be a boolean or an object.',
    ])
    expect(issuesOf([notes({ versions: { autosave: true } })])).toEqual([
      'Collection "notes": versions.autosave requires drafts to be enabled.',
    ])
    expect(issuesOf([notes({ versions: { drafts: false, autosave: true } })])).toEqual([
      'Collection "notes": versions.autosave requires drafts to be enabled.',
    ])
    expect(issuesOf([notes({ versions: { drafts: true, autosave: { interval: 200 } } })])).toEqual([
      'Collection "notes": versions: autosave.interval must be an integer of at least 500ms.',
    ])
    expect(issuesOf([notes({ versions: { maxPerDoc: -1 } })])).toEqual([
      'Collection "notes": versions.maxPerDoc must be a non-negative integer.',
    ])
    expect(issuesOf([notes({ versions: { maxPerDoc: 1.5 } })])).toEqual([
      'Collection "notes": versions.maxPerDoc must be a non-negative integer.',
    ])
    expect(issuesOf([notes({ versions: { drafts: true, maxPerDoc: 10 } })])).toEqual([])
    expect(issuesOf([notes({ versions: { drafts: true, autosave: true } })])).toEqual([])
    expect(
      issuesOf([notes({ versions: { drafts: { autosave: { interval: 3000 } }, maxPerDoc: 10 } })]),
    ).toEqual([])
  })

  it('rejects field named "versions" when versions are enabled on a collection or global', () => {
    expect(
      issuesOf([notes({ versions: { drafts: true }, fields: { versions: f.text() } })]),
    ).toEqual(['Collection "notes": field name "versions" is reserved when versions are enabled.'])

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [],
        globals: [
          {
            slug: 'site-settings',
            versions: { drafts: true },
            fields: { versions: f.text() },
          },
        ],
      }),
    ).toThrow(
      'Global "site-settings": field name "versions" is reserved when versions are enabled.',
    )

    // Accepted when versions are NOT enabled
    expect(issuesOf([notes({ fields: { versions: f.text() } })])).toEqual([])
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
        globals: [{ slug: 'apikey', fields: { title: f.text() } }],
      }),
    ).toThrow('Global slug "apikey" is reserved.')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [{ slug: 'rate-limit', fields: { title: f.text() } }],
      }),
    ).toThrow('Global slug "rate-limit" is reserved.')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes({ slug: 'site-1' })],
        globals: [{ slug: 'site1', fields: { title: f.text() } }],
      }),
    ).toThrow('Global slug "site1" generates identifier "site1" which collides with "site-1"')

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

  it('rejects upload collection fields that collide with upload system fields', () => {
    const mockStorage = {
      name: 'test-storage',
      upload: () => Promise.resolve({ filename: 'f', url: 'u' }),
      delete: () => Promise.resolve(),
      getUrl: () => 'u',
    }
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        storage: mockStorage,
        collections: [
          notes({
            upload: true,
            fields: {
              filename: f.text(),
            },
          }),
        ],
      }),
    ).toThrow('field name "filename" is reserved for an upload collection field')
  })

  it('rejects upload field targeting unknown collection', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              cover: f.upload({ relationTo: 'media' }),
            },
          }),
        ],
      }),
    ).toThrow('upload field "cover" refers to unknown collection "media"')
  })

  it('rejects upload field targeting collection without upload enabled', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            slug: 'posts',
            fields: {
              cover: f.upload({ relationTo: 'other' }),
            },
          }),
          notes({
            slug: 'other',
            fields: { title: f.text() },
          }),
        ],
      }),
    ).toThrow(
      'upload field "cover" refers to collection "other" which does not have upload enabled',
    )
  })

  it('accepts upload field targeting upload collection', () => {
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
      collections: [
        notes({
          slug: 'media',
          upload: true,
          admin: { useAsTitle: 'filename' },
        }),
        notes({
          slug: 'posts',
          fields: {
            cover: f.upload({ relationTo: 'media' }),
          },
        }),
      ],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('rejects text field with maxLength exceeding MySQL limit of 16383', () => {
    expect(issuesOf([notes({ fields: { title: f.text({ maxLength: 20000 }) } })])).toEqual([
      'Collection "notes": text field "title" maxLength (20000) exceeds MySQL VARCHAR limit of 16383. Use a textarea field for longer text.',
    ])
  })

  it('rejects text field with negative or zero maxLength', () => {
    expect(issuesOf([notes({ fields: { title: f.text({ maxLength: 0 }) } })])).toEqual([
      'Collection "notes": text field "title" maxLength must be a positive integer.',
    ])
    expect(issuesOf([notes({ fields: { title: f.text({ maxLength: -5 }) } })])).toEqual([
      'Collection "notes": text field "title" maxLength must be a positive integer.',
    ])
  })

  it('rejects text field with negative minLength', () => {
    expect(issuesOf([notes({ fields: { title: f.text({ minLength: -1 }) } })])).toEqual([
      'Collection "notes": text field "title" minLength must be a non-negative integer.',
    ])
  })

  it('rejects text field where minLength exceeds maxLength', () => {
    expect(
      issuesOf([notes({ fields: { title: f.text({ minLength: 10, maxLength: 5 }) } })]),
    ).toEqual([
      'Collection "notes": text field "title" minLength (10) cannot be greater than maxLength (5).',
    ])
  })

  it('accepts valid text field with maxLength up to 16383', () => {
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      collections: [notes({ fields: { title: f.text({ maxLength: 16383 }) } })],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('validates global text fields for maxLength exceeding 16383', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          {
            slug: 'site-settings',
            fields: {
              tagline: f.text({ maxLength: 20000 }),
            },
          },
        ],
      }),
    ).toThrow(
      'Global "site-settings": text field "tagline" maxLength (20000) exceeds MySQL VARCHAR limit of 16383',
    )
  })

  it('allows maxLength exceeding 16383 on adapters without maxStringLength limit (e.g. Postgres)', () => {
    const postgresFakeAdapter = { ...fakeAdapter, name: 'postgres', maxStringLength: undefined }
    const config = {
      secret: SECRET,
      db: postgresFakeAdapter,
      collections: [notes({ fields: { title: f.text({ maxLength: 50000 }) } })],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('reports custom adapter name and limit when exceeding adapter maxStringLength', () => {
    const customAdapter = { ...fakeAdapter, name: 'custom-db', maxStringLength: 1000 }
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: customAdapter,
        collections: [notes({ fields: { title: f.text({ maxLength: 2000 }) } })],
      }),
    ).toThrow(
      'Collection "notes": text field "title" maxLength (2000) exceeds custom-db VARCHAR limit of 1000',
    )
  })

  it('rejects collection pagination with non-positive defaultLimit or maxLimit', () => {
    expect(issuesOf([notes({ pagination: { defaultLimit: 0 } })])).toEqual([
      'Collection "notes": pagination.defaultLimit must be a positive integer.',
    ])
    expect(issuesOf([notes({ pagination: { maxLimit: -1 } })])).toEqual([
      'Collection "notes": pagination.maxLimit must be a positive integer.',
    ])
    expect(issuesOf([notes({ pagination: { defaultLimit: 1.5 } })])).toEqual([
      'Collection "notes": pagination.defaultLimit must be a positive integer.',
    ])
  })

  it('rejects collection pagination when defaultLimit exceeds maxLimit', () => {
    expect(issuesOf([notes({ pagination: { defaultLimit: 50, maxLimit: 20 } })])).toEqual([
      'Collection "notes": pagination.defaultLimit (50) cannot be greater than pagination.maxLimit (20).',
    ])
  })

  it('rejects config-level pagination with invalid limits', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        pagination: { defaultLimit: 200, maxLimit: 50 },
        collections: [notes()],
      }),
    ).toThrow(
      'Config: pagination.defaultLimit (200) cannot be greater than pagination.maxLimit (50)',
    )
  })

  it('accepts valid collection and config pagination settings', () => {
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      pagination: { defaultLimit: 20, maxLimit: 100 },
      collections: [notes({ pagination: { defaultLimit: 15, maxLimit: 50 } })],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('rejects relationship field targeting unknown collection', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              author: f.relationship({ relationTo: 'users' }),
            },
          }),
        ],
      }),
    ).toThrow('relationship field "author" refers to unknown collection "users"')
  })

  it('accepts relationship field targeting existing collection', () => {
    const authors = notes({ slug: 'authors', fields: { name: f.text() } })
    const posts = notes({
      slug: 'posts',
      fields: {
        author: f.relationship({ relationTo: 'authors' }),
        coauthors: f.relationship({ relationTo: 'authors', hasMany: true }),
      },
    })
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      collections: [authors, posts],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('accepts self-referential relationship field', () => {
    const categories = notes({
      slug: 'categories',
      fields: {
        parent: f.relationship({ relationTo: 'categories' }),
      },
    })
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      collections: [categories],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('rejects global relationship field targeting unknown collection', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          {
            slug: 'site-settings',
            fields: {
              featuredAuthor: f.relationship({ relationTo: 'authors' }),
            },
          },
        ],
      }),
    ).toThrow(
      'Global "site-settings": relationship field "featuredAuthor" refers to unknown collection "authors"',
    )
  })

  it('accepts global relationship field targeting existing collection', () => {
    const authors = notes({ slug: 'authors', fields: { name: f.text() } })
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      collections: [authors],
      globals: [
        {
          slug: 'site-settings',
          fields: {
            featuredAuthor: f.relationship({ relationTo: 'authors' }),
          },
        },
      ],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('validates global upload fields', () => {
    const mockStorage = {
      name: 'test-storage',
      upload: () => Promise.resolve({ filename: 'f', url: 'u' }),
      delete: () => Promise.resolve(),
      getUrl: () => 'u',
    }

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          {
            slug: 'site-settings',
            fields: {
              logo: f.upload({ relationTo: 'media' }),
            },
          },
        ],
      }),
    ).toThrow('Global "site-settings": upload field "logo" refers to unknown collection "media"')

    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes({ slug: 'other' })],
        globals: [
          {
            slug: 'site-settings',
            fields: {
              logo: f.upload({ relationTo: 'other' }),
            },
          },
        ],
      }),
    ).toThrow(
      'Global "site-settings": upload field "logo" refers to collection "other" which does not have upload enabled',
    )

    const validConfig = {
      secret: SECRET,
      db: fakeAdapter,
      storage: mockStorage,
      collections: [notes({ slug: 'media', upload: true })],
      globals: [
        {
          slug: 'site-settings',
          fields: {
            logo: f.upload({ relationTo: 'media' }),
          },
        },
      ],
    }
    expect(defineConfig(validConfig)).toBe(validConfig)
  })

  it('accepts slug field without from option (manual slug)', () => {
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      collections: [
        notes({
          fields: {
            slug: f.slug(),
          },
        }),
      ],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('accepts slug field with valid from option pointing to text-like fields', () => {
    const config = {
      secret: SECRET,
      db: fakeAdapter,
      collections: [
        notes({
          fields: {
            title: f.text(),
            slugFromText: f.slug({ from: 'title' }),
            summary: f.textarea(),
            slugFromTextarea: f.slug({ from: 'summary' }),
            contactEmail: f.email(),
            slugFromEmail: f.slug({ from: 'contactEmail' }),
            category: f.select({ options: ['tech', 'life'] }),
            slugFromSelect: f.slug({ from: 'category' }),
          },
        }),
      ],
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('rejects slug field when from refers to unknown field', () => {
    expect(
      issuesOf([
        notes({
          fields: {
            title: f.text(),
            slug: f.slug({ from: 'nonexistent' }),
          },
        }),
      ]),
    ).toEqual([
      'Collection "notes": slug field "slug" `from` refers to unknown field "nonexistent".',
    ])
  })

  it('rejects slug field when from refers to itself', () => {
    expect(
      issuesOf([
        notes({
          fields: {
            slug: f.slug({ from: 'slug' }),
          },
        }),
      ]),
    ).toEqual(['Collection "notes": slug field "slug" cannot refer to itself in `from`.'])
  })

  it('rejects slug field when from refers to a non-text field', () => {
    expect(
      issuesOf([
        notes({
          fields: {
            views: f.number(),
            slug: f.slug({ from: 'views' }),
          },
        }),
      ]),
    ).toEqual([
      'Collection "notes": slug field "slug" `from` must refer to a text-like field, but "views" is of type "number".',
    ])

    expect(
      issuesOf([
        notes({
          fields: {
            isPublished: f.checkbox(),
            slug: f.slug({ from: 'isPublished' }),
          },
        }),
      ]),
    ).toEqual([
      'Collection "notes": slug field "slug" `from` must refer to a text-like field, but "isPublished" is of type "checkbox".',
    ])

    expect(
      issuesOf([
        notes({
          fields: {
            originalSlug: f.slug(),
            slug: f.slug({ from: 'originalSlug' }),
          },
        }),
      ]),
    ).toEqual([
      'Collection "notes": slug field "slug" `from` must refer to a text-like field, but "originalSlug" is of type "slug".',
    ])
  })

  it('validates slug fields in globals', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          {
            slug: 'site-settings',
            fields: {
              slug: f.slug({ from: 'missing' }),
            },
          },
        ],
      }),
    ).toThrow('Global "site-settings": slug field "slug" `from` refers to unknown field "missing"')
  })

  it('rejects nested containers deeper than 3 levels', () => {
    // Level 1: array, Level 2: group, Level 3: group, Level 4: group -> invalid!
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              l1: f.array({
                fields: {
                  l2: f.group({
                    fields: {
                      l3: f.group({
                        fields: {
                          l4: f.group({
                            fields: {
                              deep: f.text(),
                            },
                          }),
                        },
                      }),
                    },
                  }),
                },
              }),
            },
          }),
        ],
      }),
    ).toThrow('exceeds maximum nesting depth of 3')
  })

  it('validates array admin.rowLabel refers to a known subfield', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              items: f.array({
                admin: { rowLabel: 'nonexistent' },
                fields: {
                  title: f.text(),
                },
              }),
            },
          }),
        ],
      }),
    ).toThrow('admin.rowLabel refers to unknown field "nonexistent"')
  })

  it('rejects reserved subfield name "id" in nested containers', () => {
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              info: f.group({
                fields: {
                  id: f.text(),
                },
              }),
            },
          }),
        ],
      }),
    ).toThrow('field name "id" is reserved')
  })

  it('validates blocks fields (duplicate slugs, reserved subfield names, and depth)', () => {
    const hero1 = block({ slug: 'hero', fields: { title: f.text() } })
    const hero2 = block({ slug: 'hero', fields: { subtitle: f.text() } })

    // Duplicate slugs
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              layout: {
                type: 'blocks',
                blocks: [hero1, hero2],
              },
            },
          }),
        ],
      }),
    ).toThrow('duplicate block slug "hero"')

    // Reserved blockType name
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              layout: {
                type: 'blocks',
                blocks: [
                  {
                    slug: 'custom',
                    fields: {
                      blockType: f.text(),
                    },
                  },
                ],
              },
            },
          }),
        ],
      }),
    ).toThrow('field name "blockType" is reserved')

    // Reserved id name
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              layout: {
                type: 'blocks',
                blocks: [
                  {
                    slug: 'custom',
                    fields: {
                      id: f.text(),
                    },
                  },
                ],
              },
            },
          }),
        ],
      }),
    ).toThrow('field name "id" is reserved')

    // Target validation inside block subfields
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              layout: {
                type: 'blocks',
                blocks: [
                  {
                    slug: 'promo',
                    fields: {
                      featuredAuthor: f.relationship({ relationTo: 'unknown-authors' }),
                    },
                  },
                ],
              },
            },
          }),
        ],
      }),
    ).toThrow('refers to unknown collection "unknown-authors"')
  })

  it('validates admin.preview on collections and globals', () => {
    // Non-object preview
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            // @ts-expect-error invalid preview type
            admin: { preview: 'https://example.com' },
          }),
        ],
      }),
    ).toThrow('admin.preview must be an object')

    // Empty URL
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            admin: { preview: { url: '   ' } },
          }),
        ],
      }),
    ).toThrow('admin.preview.url must be a non-empty string')

    // Empty URL on global
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        globals: [
          {
            slug: 'site-settings',
            admin: { preview: { url: '' } },
            fields: { siteName: f.text() },
          },
        ],
      }),
    ).toThrow('admin.preview.url must be a non-empty string')

    // Valid preview on collection and global
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            admin: { preview: { url: 'https://example.com/posts/{slug}?preview=1' } },
          }),
        ],
        globals: [
          {
            slug: 'site-settings',
            admin: { preview: { url: '/api/preview/settings' } },
            fields: { siteName: f.text() },
          },
        ],
      }),
    ).not.toThrow()
  })

  it('validates webhooks configurations on root, collections, and globals', () => {
    // Non-array webhooks
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        webhooks: 'invalid' as unknown as readonly WebhookConfig[],
      }),
    ).toThrow('Config: webhooks must be an array')

    // Invalid URL
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        webhooks: [{ url: 'not-a-valid-url', events: ['publish'] }],
      }),
    ).toThrow('webhooks[0].url must be a valid http or https URL')

    // Empty events
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        webhooks: [{ url: 'https://example.com/webhook', events: [] }],
      }),
    ).toThrow('webhooks[0].events must be a non-empty array')

    // Invalid event name
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        webhooks: [
          {
            url: 'https://example.com/webhook',
            events: ['invalid-event' as unknown as WebhookEvent],
          },
        ],
      }),
    ).toThrow('webhooks[0].events contains invalid event "invalid-event"')

    // Unknown collection target on root
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        webhooks: [
          {
            url: 'https://example.com/webhook',
            collections: ['unknown-collection'],
            events: ['publish'],
          },
        ],
      }),
    ).toThrow('webhooks[0].collections refers to unknown collection "unknown-collection"')

    // Unknown global target on root
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        webhooks: [
          {
            url: 'https://example.com/webhook',
            globals: ['unknown-global'],
            events: ['update'],
          },
        ],
      }),
    ).toThrow('webhooks[0].globals refers to unknown global "unknown-global"')

    // Collection webhook specifying collections target
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            webhooks: [
              {
                url: 'https://example.com/webhook',
                collections: ['notes'],
                events: ['publish'],
              } as unknown as CollectionWebhookConfig,
            ],
          }),
        ],
      }),
    ).toThrow('Collection "notes": webhooks[0] cannot specify "collections"')

    // Valid configurations
    expect(() =>
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            webhooks: [
              {
                url: 'https://example.com/collection-webhook',
                events: ['publish', 'unpublish'],
                secret: 'col-secret',
                includeDoc: true,
              },
            ],
          }),
        ],
        globals: [
          {
            slug: 'site-settings',
            fields: { name: f.text() },
            webhooks: [
              {
                url: 'https://example.com/global-webhook',
                events: ['update'],
              },
            ],
          },
        ],
        webhooks: [
          {
            url: 'https://example.com/root-webhook',
            collections: ['notes'],
            globals: '*',
            events: ['publish', 'change', 'delete'],
            secret: 'root-secret',
          },
        ],
      }),
    ).not.toThrow()
  })

  describe('auth validation', () => {
    it('accepts a valid auth roles configuration', () => {
      const config = {
        secret: SECRET,
        db: fakeAdapter,
        collections: [Posts],
        auth: {
          roles: ['admin', 'editor', 'author'] as const,
          defaultRole: 'author',
          adminRole: 'admin',
        },
      }
      expect(defineConfig(config)).toBe(config)
    })

    it('rejects auth if it is not an object', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: 'invalid' as unknown as undefined,
        }),
      ).toThrow('`auth` must be an object.')
    })

    it('rejects empty roles array', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: [] },
        }),
      ).toThrow('`auth.roles` must contain at least one role.')
    })

    it('rejects duplicate roles in roles array', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: ['admin', 'admin'] },
        }),
      ).toThrow('Role "admin" is duplicated in auth.roles.')
    })

    it('rejects non-string or empty role values', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: ['admin', '   '] },
        }),
      ).toThrow('Each role in `auth.roles` must be a non-empty string.')
    })

    it('rejects defaultRole not in roles', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: ['admin', 'viewer'], defaultRole: 'editor' },
        }),
      ).toThrow('Default role "editor" is not in auth.roles.')
    })

    it('requires defaultRole when editor is not in roles', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: ['admin', 'viewer'] },
        }),
      ).toThrow('Default role "editor" is not in auth.roles. Specify auth.defaultRole.')
    })

    it('rejects adminRole not in roles', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: ['admin', 'editor'], adminRole: 'root' },
        }),
      ).toThrow('Admin role "root" is not in auth.roles.')
    })

    it('requires adminRole when admin is not in roles', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [Posts],
          auth: { roles: ['manager', 'editor'], defaultRole: 'editor' },
        }),
      ).toThrow('Admin role "admin" is not in auth.roles. Specify auth.adminRole.')
    })
  })

  describe('field access validation', () => {
    it('allows valid field access functions', () => {
      const config = {
        secret: SECRET,
        db: fakeAdapter,
        collections: [
          notes({
            fields: {
              secret: f.text({
                access: {
                  read: () => true,
                  create: () => false,
                  update: () => true,
                },
              }),
            },
          }),
        ],
      }
      expect(defineConfig(config)).toBe(config)
    })

    it('rejects field access when not an object', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [
            notes({
              fields: {
                secret: f.text({
                  // @ts-expect-error - testing invalid access type
                  access: 'invalid',
                }),
              },
            }),
          ],
        }),
      ).toThrow('Collection "notes": field "secret" access must be an object.')
    })

    it('rejects unsupported access keys on fields', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [
            notes({
              fields: {
                secret: f.text({
                  access: {
                    // @ts-expect-error - testing invalid access key
                    delete: () => true,
                  },
                }),
              },
            }),
          ],
        }),
      ).toThrow(
        'Collection "notes": field "secret" access does not support "delete". Only "read", "create", and "update" are supported.',
      )
    })

    it('rejects non-function access values on fields', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [
            notes({
              fields: {
                secret: f.text({
                  access: {
                    // @ts-expect-error - testing non-function access value
                    read: true,
                  },
                }),
              },
            }),
          ],
        }),
      ).toThrow('Collection "notes": field "secret" access.read must be a function.')
    })

    it('validates access on nested fields in group, array, and blocks', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [
            notes({
              fields: {
                meta: f.group({
                  fields: {
                    internalNote: f.text({
                      access: {
                        // @ts-expect-error - testing invalid access
                        read: 123,
                      },
                    }),
                  },
                }),
              },
            }),
          ],
        }),
      ).toThrow(
        'Collection "notes" -> group "meta": field "internalNote" access.read must be a function.',
      )
    })
  })

  describe('localization', () => {
    it('accepts valid localization config with string codes and object locales', () => {
      const config = defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        localization: {
          locales: ['en', { code: 'id', label: 'Bahasa Indonesia' }],
          defaultLocale: 'en',
          fallback: true,
        },
        collections: [
          notes({
            fields: {
              title: f.text({ localized: true }),
            },
          }),
        ],
      })
      expect(config.localization?.defaultLocale).toBe('en')
    })

    it('rejects non-object localization', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          // @ts-expect-error - testing invalid localization type
          localization: 'en',
          collections: [notes()],
        }),
      ).toThrow('`localization` must be an object.')
    })

    it('rejects non-array or empty locales', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          // @ts-expect-error - testing invalid locales
          localization: { locales: 'en', defaultLocale: 'en' },
          collections: [notes()],
        }),
      ).toThrow('`localization.locales` must be an array of locale codes or locale objects.')

      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          localization: { locales: [], defaultLocale: 'en' },
          collections: [notes()],
        }),
      ).toThrow('`localization.locales` must contain at least one locale.')
    })

    it('rejects invalid locale codes', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          localization: {
            locales: ['en_US', 'invalid-long-locale-code', ''],
            defaultLocale: 'en_US',
          },
          collections: [notes()],
        }),
      ).toThrow(
        'Locale code "en_US" is invalid. Codes must match format (e.g. "en", "id", "en-US", "zh-CN") and be at most 10 characters without underscores.',
      )
    })

    it('rejects duplicate locale codes', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          localization: {
            locales: ['en', { code: 'en', label: 'English' }],
            defaultLocale: 'en',
          },
          collections: [notes()],
        }),
      ).toThrow('Duplicate locale code "en" in localization.locales.')
    })

    it('rejects missing or invalid defaultLocale', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          // @ts-expect-error - testing missing defaultLocale
          localization: { locales: ['en', 'id'] },
          collections: [notes()],
        }),
      ).toThrow('`localization.defaultLocale` must be a non-empty string.')

      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          localization: { locales: ['en', 'id'], defaultLocale: 'fr' },
          collections: [notes()],
        }),
      ).toThrow('Default locale "fr" is not in localization.locales.')
    })

    it('rejects non-boolean fallback', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          // @ts-expect-error - testing non-boolean fallback
          localization: { locales: ['en'], defaultLocale: 'en', fallback: 'yes' },
          collections: [notes()],
        }),
      ).toThrow('`localization.fallback` must be a boolean.')
    })

    it('rejects localized: true on field when localization is not configured', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          collections: [
            notes({
              fields: {
                title: f.text({ localized: true }),
              },
            }),
          ],
        }),
      ).toThrow(
        'Collection "notes": field "title" has localized: true, but localization is not configured in defineConfig({ localization: ... }).',
      )
    })

    it('rejects localized: true on subfield when array container is localized', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          localization: { locales: ['en', 'id'], defaultLocale: 'en' },
          collections: [
            notes({
              fields: {
                items: f.array({
                  localized: true,
                  fields: {
                    title: f.text({ localized: true }),
                  },
                }),
              },
            }),
          ],
        }),
      ).toThrow(
        'Collection "notes" -> array "items": field "title" cannot be localized because its parent container is already localized.',
      )
    })

    it('rejects localized: true on subfield when blocks container is localized', () => {
      expect(() =>
        defineConfig({
          secret: SECRET,
          db: fakeAdapter,
          localization: { locales: ['en', 'id'], defaultLocale: 'en' },
          collections: [
            notes({
              fields: {
                content: f.blocks({
                  localized: true,
                  blocks: [
                    block({
                      slug: 'hero',
                      fields: {
                        heading: f.text({ localized: true }),
                      },
                    }),
                  ],
                }),
              },
            }),
          ],
        }),
      ).toThrow(
        'Collection "notes" -> blocks "content" -> block "hero": field "heading" cannot be localized because its parent container is already localized.',
      )
    })

    it('allows localized: true on subfields when array or blocks container is not localized', () => {
      const config = defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        localization: { locales: ['en', 'id'], defaultLocale: 'en' },
        collections: [
          notes({
            fields: {
              items: f.array({
                fields: {
                  title: f.text({ localized: true }),
                },
              }),
              content: f.blocks({
                blocks: [
                  block({
                    slug: 'hero',
                    fields: {
                      heading: f.text({ localized: true }),
                    },
                  }),
                ],
              }),
            },
          }),
        ],
      })
      expect(config.collections[0]?.fields.items).toBeDefined()
    })
  })
})

describe('admin.component validation (#465)', () => {
  it('accepts a component key on leaf fields, including inside containers', () => {
    expect(
      issuesOf([
        notes({
          fields: {
            rating: f.number({ admin: { component: 'rating-stars' } }),
            seo: f.group({ fields: { score: f.number({ admin: { component: 'rating-stars' } }) } }),
            rows: f.array({ fields: { note: f.text({ admin: { component: 'note-input' } }) } }),
          },
        }),
      ]),
    ).toEqual([])
  })

  it.each([
    ['', 'non-empty string'],
    ['   ', 'non-empty string'],
    [42 as unknown as string, 'non-empty string'],
  ])('rejects the component value %j', (component, message) => {
    const issues = issuesOf([notes({ fields: { rating: f.number({ admin: { component } }) } })])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('field "rating"')
    expect(issues[0]).toContain(message)
  })

  it('rejects a component on group, array and blocks, naming the field', () => {
    const issues = issuesOf([
      notes({
        fields: {
          seo: f.group({ admin: { component: 'x' }, fields: { a: f.text() } } as never),
          rows: f.array({ admin: { component: 'x' }, fields: { a: f.text() } }),
          body: f.blocks({
            admin: { component: 'x' },
            blocks: [block({ slug: 'hero', fields: { a: f.text() } })],
          }),
        },
      }),
    ])
    expect(issues).toHaveLength(3)
    expect(issues.join('\n')).toMatch(/group field "seo" cannot set admin.component/)
    expect(issues.join('\n')).toMatch(/array field "rows" cannot set admin.component/)
    expect(issues.join('\n')).toMatch(/blocks field "body" cannot set admin.component/)
  })
})

describe('admin.dashboard validation (#466)', () => {
  function issuesOfAdmin(admin: unknown): readonly string[] {
    try {
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections: [notes()],
        admin: admin as never,
      })
    } catch (error) {
      if (error instanceof LontarConfigError) return error.issues
      throw error
    }
    return []
  }

  it('accepts widgets with and without a width', () => {
    expect(
      issuesOfAdmin({
        dashboard: { widgets: [{ component: 'a' }, { component: 'b', width: 'half' }] },
      }),
    ).toEqual([])
  })

  it('accepts an empty admin block and empty widgets', () => {
    expect(issuesOfAdmin({})).toEqual([])
    expect(issuesOfAdmin({ dashboard: {} })).toEqual([])
    expect(issuesOfAdmin({ dashboard: { widgets: [] } })).toEqual([])
  })

  it.each([
    ['admin is not an object', 'nope', 'admin must be an object'],
    ['dashboard is not an object', { dashboard: 3 }, 'admin.dashboard must be an object'],
    ['widgets is not an array', { dashboard: { widgets: {} } }, 'widgets must be an array'],
    [
      'a widget is not an object',
      { dashboard: { widgets: ['x'] } },
      'widgets[0]: must be an object',
    ],
    ['component is missing', { dashboard: { widgets: [{}] } }, 'component must be a non-empty'],
    [
      'component is blank',
      { dashboard: { widgets: [{ component: '  ' }] } },
      'component must be a non-empty',
    ],
    [
      'width is unknown',
      { dashboard: { widgets: [{ component: 'a', width: 'third' }] } },
      'width must be "full" or "half"',
    ],
  ])('rejects when %s', (_name, admin, message) => {
    const issues = issuesOfAdmin(admin)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(message)
  })

  it('names the widget by position', () => {
    const issues = issuesOfAdmin({
      dashboard: { widgets: [{ component: 'ok' }, { component: '' }] },
    })
    expect(issues[0]).toContain('widgets[1]')
  })
})

describe('admin.views validation (#467)', () => {
  const ok = { key: 'seo-audit', label: 'SEO audit', component: 'seo-audit' }

  function issuesOfViews(views: unknown, collections: CollectionConfig[] = [notes()]) {
    try {
      defineConfig({
        secret: SECRET,
        db: fakeAdapter,
        collections,
        admin: { views } as never,
      })
    } catch (error) {
      if (error instanceof LontarConfigError) return error.issues
      throw error
    }
    return []
  }

  it('accepts valid views, with and without access', () => {
    expect(
      issuesOfViews([ok, { ...ok, key: 'two', access: ({ user }: { user: unknown }) => !!user }]),
    ).toEqual([])
    expect(issuesOfViews([])).toEqual([])
  })

  it.each([
    ['views is not an array', {}, 'admin.views must be an array'],
    ['a view is not an object', ['x'], 'views[0]: must be an object'],
    ['key is missing', [{ ...ok, key: undefined }], 'key must be kebab-case'],
    ['key has uppercase', [{ ...ok, key: 'SeoAudit' }], 'key must be kebab-case'],
    ['key has a slash', [{ ...ok, key: 'a/b' }], 'key must be kebab-case'],
    ['key starts with a digit', [{ ...ok, key: '1a' }], 'key must be kebab-case'],
    ['label is blank', [{ ...ok, label: ' ' }], 'label must be a non-empty'],
    ['component is missing', [{ ...ok, component: undefined }], 'component must be a non-empty'],
    ['access is not a function', [{ ...ok, access: true }], 'access must be a function'],
  ])('rejects when %s', (_name, views, message) => {
    const issues = issuesOfViews(views)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(message)
  })

  it('rejects a repeated key', () => {
    const issues = issuesOfViews([ok, { ...ok, label: 'Again' }])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('"seo-audit" is used twice')
  })

  it('rejects a collection slug "views" only when views are configured', () => {
    const views = notes({ slug: 'views' })
    const issues = issuesOfViews([ok], [views])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('Collection slug "views" conflicts with admin.views')

    expect(issuesOfViews([], [views])).toEqual([])
    expect(issuesOfViews(undefined, [views])).toEqual([])
  })
})
