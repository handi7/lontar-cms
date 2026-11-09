import { describe, expect, it } from 'vitest'
import { fakeAdapter, Posts, SECRET } from '../__fixtures__/posts'
import { block, fields as f } from '../fields'
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
})
