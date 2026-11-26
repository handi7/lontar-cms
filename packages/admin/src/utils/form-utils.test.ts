import { describe, expect, it } from 'vitest'
import { clientFieldsToZod, type ClientField, type FieldPermission } from '@lontar/core/client'
import {
  buildFormValidationFields,
  computeDefaultValues,
  filterReadableFields,
  formatDateForInput,
  formatDateForSubmit,
  formatDocForForm,
  formatDocForSubmit,
  isFieldReadOnly,
  isFieldVisible,
  isSameDoc,
  stripReadOnlyFields,
} from './form-utils'

describe('form-utils', () => {
  describe('formatDateForInput', () => {
    it('returns empty string for null, undefined, or empty string', () => {
      expect(formatDateForInput(null)).toBe('')
      expect(formatDateForInput(undefined)).toBe('')
      expect(formatDateForInput('')).toBe('')
    })

    it('returns raw string if not a valid date', () => {
      expect(formatDateForInput('invalid-date')).toBe('invalid-date')
    })

    it('formats a date to YYYY-MM-DDTHH:mm in local time', () => {
      const d = new Date(2024, 4, 1, 10, 30, 0) // May 1, 2024 10:30 local
      expect(formatDateForInput(d)).toBe('2024-05-01T10:30')
    })

    it('includes seconds when seconds are non-zero', () => {
      const d = new Date(2024, 4, 1, 10, 30, 45) // May 1, 2024 10:30:45 local
      expect(formatDateForInput(d)).toBe('2024-05-01T10:30:45')
    })
  })

  describe('formatDateForSubmit', () => {
    it('returns null for null, undefined, or empty string', () => {
      expect(formatDateForSubmit(null)).toBeNull()
      expect(formatDateForSubmit(undefined)).toBeNull()
      expect(formatDateForSubmit('')).toBeNull()
      expect(formatDateForSubmit('   ')).toBeNull()
    })

    it('converts local datetime string to UTC ISO-8601 string', () => {
      const localString = '2024-05-01T10:30'
      const expectedIso = new Date(localString).toISOString()
      expect(formatDateForSubmit(localString)).toBe(expectedIso)
    })

    it('preserves ISO string already containing timezone offset', () => {
      const iso = '2024-05-01T03:00:00.000Z'
      expect(formatDateForSubmit(iso)).toBe(iso)
    })

    it('converts Date instance to ISO string', () => {
      const d = new Date(2024, 4, 1, 10, 30)
      expect(formatDateForSubmit(d)).toBe(d.toISOString())
    })
  })

  describe('round-tripping date through input and submit', () => {
    it('preserves the exact instant when formatted for input and submitted without changes', () => {
      const initialIso = '2024-05-01T03:00:00.000Z'
      const inputVal = formatDateForInput(initialIso)
      const submittedIso = formatDateForSubmit(inputVal)
      expect(submittedIso).toBe(initialIso)
    })

    it('preserves instant with seconds', () => {
      const initialIso = '2024-05-01T03:00:45.000Z'
      const inputVal = formatDateForInput(initialIso)
      const submittedIso = formatDateForSubmit(inputVal)
      expect(submittedIso).toBe(initialIso)
    })
  })

  describe('formatDocForSubmit', () => {
    const fields: ClientField[] = [
      { name: 'title', type: 'text', label: 'Title', required: true },
      { name: 'publishedAt', type: 'date', label: 'Published At', required: true },
      { name: 'optionalDate', type: 'date', label: 'Optional Date', required: false },
      { name: 'views', type: 'number', label: 'Views', required: false },
    ]

    it('converts date fields to ISO strings and leaves other fields untouched', () => {
      const input = {
        title: 'My Post',
        publishedAt: '2024-05-01T10:00',
        optionalDate: '',
        views: 42,
      }

      const formatted = formatDocForSubmit(fields, input)
      expect(formatted.title).toBe('My Post')
      expect(formatted.views).toBe(42)
      expect(formatted.optionalDate).toBeNull()
      expect(formatted.publishedAt).toBe(new Date('2024-05-01T10:00').toISOString())
    })

    it('strips document-level system fields (id, createdAt, updatedAt, _status, _isPublished, latestVersionId) (#244)', () => {
      const input = {
        id: 123,
        title: 'Draft Post',
        publishedAt: '2024-05-01T10:00',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        _status: 'published',
        _isPublished: true,
        latestVersionId: 45,
      }

      const formatted = formatDocForSubmit(fields, input)
      expect(formatted).toEqual({
        title: 'Draft Post',
        publishedAt: new Date('2024-05-01T10:00').toISOString(),
      })
      expect(formatted).not.toHaveProperty('id')
      expect(formatted).not.toHaveProperty('createdAt')
      expect(formatted).not.toHaveProperty('updatedAt')
      expect(formatted).not.toHaveProperty('_status')
      expect(formatted).not.toHaveProperty('_isPublished')
      expect(formatted).not.toHaveProperty('latestVersionId')
    })
  })

  describe('formatDocForForm and computeDefaultValues', () => {
    const fields: ClientField[] = [
      { name: 'title', type: 'text', label: 'Title', required: true, defaultValue: 'Untitled' },
      {
        name: 'publishedAt',
        type: 'date',
        label: 'Published At',
        required: true,
        defaultValue: '2024-05-01T03:00:00.000Z',
      },
      { name: 'featured', type: 'checkbox', label: 'Featured', required: false },
      {
        name: 'categories',
        type: 'relationship',
        relationTo: 'categories',
        label: 'Categories',
        required: false,
        hasMany: true,
      },
    ]

    it('computes default values with date formatted for datetime-local input', () => {
      const defaults = computeDefaultValues(fields)
      expect(defaults.title).toBe('Untitled')
      expect(defaults.featured).toBe(false)
      expect(defaults.categories).toEqual([])
      expect(defaults.publishedAt).toBe(formatDateForInput('2024-05-01T03:00:00.000Z'))
    })

    it('formats existing doc for form inputs', () => {
      const doc = {
        title: 'Loaded Post',
        publishedAt: '2024-05-01T03:00:00.000Z',
        categories: [{ id: 1 }, { id: 2 }],
      }

      const formDoc = formatDocForForm(fields, doc)
      expect(formDoc.title).toBe('Loaded Post')
      expect(formDoc.publishedAt).toBe(formatDateForInput('2024-05-01T03:00:00.000Z'))
      expect(formDoc.categories).toEqual([1, 2])
    })

    it('strips document-level system fields (createdAt, updatedAt, _status, _isPublished, latestVersionId) (#232)', () => {
      const doc = {
        id: 42,
        title: 'Loaded Post',
        publishedAt: '2024-05-01T03:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-05-01T03:00:00.000Z',
        _status: 'draft',
        _isPublished: false,
        latestVersionId: 10,
      }

      const formDoc = formatDocForForm(fields, doc)
      expect(formDoc.title).toBe('Loaded Post')
      expect(formDoc.id).toBe(42)
      expect('createdAt' in formDoc).toBe(false)
      expect('updatedAt' in formDoc).toBe(false)
      expect('_status' in formDoc).toBe(false)
      expect('_isPublished' in formDoc).toBe(false)
      expect('latestVersionId' in formDoc).toBe(false)
    })

    it('handles nested group fields for defaults, formatDocForForm, and formatDocForSubmit', () => {
      const groupFields: ClientField[] = [
        {
          name: 'seo',
          type: 'group',
          label: 'SEO',
          required: false,
          fields: [
            {
              name: 'metaTitle',
              type: 'text',
              label: 'Meta Title',
              required: true,
              defaultValue: 'Default SEO',
            },
            { name: 'releaseDate', type: 'date', label: 'Release Date', required: false },
          ],
        },
      ]

      const defaults = computeDefaultValues(groupFields)
      expect(defaults.seo).toEqual({ metaTitle: 'Default SEO' })

      const incomingDoc = {
        seo: {
          metaTitle: 'Custom Meta',
          releaseDate: '2024-06-01T12:00:00.000Z',
        },
      }
      const formDoc = formatDocForForm(groupFields, incomingDoc)
      expect(formDoc.seo).toEqual({
        metaTitle: 'Custom Meta',
        releaseDate: formatDateForInput('2024-06-01T12:00:00.000Z'),
      })

      const submittingDoc = {
        seo: {
          metaTitle: 'Custom Meta',
          releaseDate: '2024-06-01T12:00',
        },
      }
      const submitDoc = formatDocForSubmit(groupFields, submittingDoc)
      expect(submitDoc.seo).toEqual({
        metaTitle: 'Custom Meta',
        releaseDate: formatDateForSubmit('2024-06-01T12:00'),
      })
    })

    it('handles array fields for defaults, formatDocForForm, and formatDocForSubmit', () => {
      const arrayFields: ClientField[] = [
        {
          name: 'gallery',
          type: 'array',
          label: 'Gallery',
          required: false,
          fields: [
            { name: 'caption', type: 'text', label: 'Caption', required: true },
            { name: 'capturedAt', type: 'date', label: 'Captured At', required: false },
          ],
        },
      ]

      const defaults = computeDefaultValues(arrayFields)
      expect(defaults.gallery).toEqual([])

      const incomingDoc = {
        gallery: [
          {
            id: 'row-1',
            caption: 'Sunset',
            capturedAt: '2024-07-04T18:00:00.000Z',
          },
        ],
      }
      const formDoc = formatDocForForm(arrayFields, incomingDoc)
      expect(formDoc.gallery).toEqual([
        {
          id: 'row-1',
          caption: 'Sunset',
          capturedAt: formatDateForInput('2024-07-04T18:00:00.000Z'),
        },
      ])

      const submittingDoc = {
        gallery: [
          {
            id: 'row-1',
            caption: 'Sunset',
            capturedAt: '2024-07-04T18:00',
          },
        ],
      }
      const submitDoc = formatDocForSubmit(arrayFields, submittingDoc)
      expect(submitDoc.gallery).toEqual([
        {
          id: 'row-1',
          caption: 'Sunset',
          capturedAt: formatDateForSubmit('2024-07-04T18:00'),
        },
      ])
    })

    it('seeds minRows rows with ids and subfield defaults for array fields (#180)', () => {
      const arrayFields: ClientField[] = [
        {
          name: 'items',
          type: 'array',
          label: 'Items',
          required: false,
          minRows: 2,
          fields: [
            {
              name: 'name',
              type: 'text',
              label: 'Name',
              required: false,
              defaultValue: 'Untitled',
            },
            { name: 'enabled', type: 'checkbox', label: 'Enabled', required: false },
          ],
        },
      ]

      const defaults = computeDefaultValues(arrayFields)
      const rows = defaults.items as Array<Record<string, unknown>>
      expect(rows).toHaveLength(2)
      expect(rows[0]!.id).toBeDefined()
      expect(typeof rows[0]!.id).toBe('string')
      expect(rows[1]!.id).toBeDefined()
      expect(typeof rows[1]!.id).toBe('string')
      expect(rows[0]!.id).not.toBe(rows[1]!.id)
      expect(rows[0]!.name).toBe('Untitled')
      expect(rows[0]!.enabled).toBe(false)
      expect(rows[1]!.name).toBe('Untitled')
      expect(rows[1]!.enabled).toBe(false)
    })

    it('seeds 1 row when array field is required without explicit minRows (#180)', () => {
      const arrayFields: ClientField[] = [
        {
          name: 'items',
          type: 'array',
          label: 'Items',
          required: true,
          fields: [{ name: 'name', type: 'text', label: 'Name', required: false }],
        },
      ]

      const defaults = computeDefaultValues(arrayFields)
      const rows = defaults.items as Array<Record<string, unknown>>
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBeDefined()
      expect(typeof rows[0]!.id).toBe('string')
    })

    it('does not seed rows for blocks field even if minRows is set (#180)', () => {
      const blocksFields: ClientField[] = [
        {
          name: 'layout',
          type: 'blocks',
          label: 'Layout',
          required: false,
          minRows: 2,
          blocks: [
            {
              slug: 'hero',
              labels: { singular: 'Hero', plural: 'Heroes' },
              fields: [{ name: 'title', type: 'text', label: 'Title', required: true }],
            },
          ],
        },
      ]

      const defaults = computeDefaultValues(blocksFields)
      expect(defaults.layout).toEqual([])
    })

    it('handles blocks fields for defaults, formatDocForForm, and formatDocForSubmit', () => {
      const blocksFields: ClientField[] = [
        {
          name: 'layout',
          type: 'blocks',
          label: 'Layout',
          required: false,
          blocks: [
            {
              slug: 'hero',
              labels: { singular: 'Hero', plural: 'Heroes' },
              fields: [
                { name: 'heading', type: 'text', label: 'Heading', required: true },
                { name: 'date', type: 'date', label: 'Date', required: false },
              ],
            },
            {
              slug: 'cta',
              labels: { singular: 'CTA', plural: 'CTAs' },
              fields: [{ name: 'text', type: 'text', label: 'Text', required: true }],
            },
          ],
        },
      ]

      const defaults = computeDefaultValues(blocksFields)
      expect(defaults.layout).toEqual([])

      const incomingDoc = {
        layout: [
          {
            id: 'row-hero',
            blockType: 'hero',
            heading: 'Main Hero',
            date: '2024-08-10T09:00:00.000Z',
          },
          {
            id: 'row-cta',
            blockType: 'cta',
            text: 'Click here',
          },
        ],
      }
      const formDoc = formatDocForForm(blocksFields, incomingDoc)
      expect(formDoc.layout).toEqual([
        {
          id: 'row-hero',
          blockType: 'hero',
          heading: 'Main Hero',
          date: formatDateForInput('2024-08-10T09:00:00.000Z'),
        },
        {
          id: 'row-cta',
          blockType: 'cta',
          text: 'Click here',
        },
      ])

      const submittingDoc = {
        layout: [
          {
            id: 'row-hero',
            blockType: 'hero',
            heading: 'Main Hero',
            date: '2024-08-10T09:00',
          },
          {
            id: 'row-cta',
            blockType: 'cta',
            text: 'Click here',
          },
        ],
      }
      const submitDoc = formatDocForSubmit(blocksFields, submittingDoc)
      expect(submitDoc.layout).toEqual([
        {
          id: 'row-hero',
          blockType: 'hero',
          heading: 'Main Hero',
          date: formatDateForSubmit('2024-08-10T09:00'),
        },
        {
          id: 'row-cta',
          blockType: 'cta',
          text: 'Click here',
        },
      ])
    })

    it('normalizes populated relationship and upload objects into IDs inside nested fields', () => {
      const nestedFields: ClientField[] = [
        {
          name: 'seo',
          type: 'group',
          label: 'SEO',
          required: false,
          fields: [
            {
              name: 'ogImage',
              type: 'upload',
              label: 'OG Image',
              relationTo: 'media',
              required: false,
            },
            {
              name: 'author',
              type: 'relationship',
              label: 'Author',
              relationTo: 'users',
              required: false,
            },
          ],
        },
        {
          name: 'gallery',
          type: 'array',
          label: 'Gallery',
          required: false,
          fields: [
            {
              name: 'photo',
              type: 'upload',
              label: 'Photo',
              relationTo: 'media',
              required: false,
            },
            {
              name: 'tags',
              type: 'relationship',
              label: 'Tags',
              relationTo: 'tags',
              hasMany: true,
              required: false,
            },
          ],
        },
        {
          name: 'layout',
          type: 'blocks',
          label: 'Layout',
          required: false,
          blocks: [
            {
              slug: 'hero',
              labels: { singular: 'Hero', plural: 'Heroes' },
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  label: 'Image',
                  relationTo: 'media',
                  required: false,
                },
                {
                  name: 'relatedPost',
                  type: 'relationship',
                  label: 'Post',
                  relationTo: 'posts',
                  required: false,
                },
              ],
            },
          ],
        },
      ]

      const populatedDoc = {
        seo: {
          ogImage: { id: 10, filename: 'og.jpg', url: '/uploads/og.jpg' },
          author: { id: 1, name: 'Alice' },
        },
        gallery: [
          {
            id: 'row-1',
            photo: { id: 20, filename: 'photo.jpg' },
            tags: [
              { id: 100, name: 'Tech' },
              { id: 200, name: 'Design' },
            ],
          },
        ],
        layout: [
          {
            id: 'row-b1',
            blockType: 'hero',
            image: { id: 30, filename: 'hero.jpg' },
            relatedPost: { id: 301, title: 'My Post' },
          },
        ],
      }

      const formDoc = formatDocForForm(nestedFields, populatedDoc)
      expect(formDoc).toEqual({
        seo: {
          ogImage: 10,
          author: 1,
        },
        gallery: [
          {
            id: 'row-1',
            photo: 20,
            tags: [100, 200],
          },
        ],
        layout: [
          {
            id: 'row-b1',
            blockType: 'hero',
            image: 30,
            relatedPost: 301,
          },
        ],
      })

      const submitDoc = formatDocForSubmit(nestedFields, formDoc)
      expect(submitDoc).toEqual({
        seo: {
          ogImage: 10,
          author: 1,
        },
        gallery: [
          {
            id: 'row-1',
            photo: 20,
            tags: [100, 200],
          },
        ],
        layout: [
          {
            id: 'row-b1',
            blockType: 'hero',
            image: 30,
            relatedPost: 301,
          },
        ],
      })
    })
  })

  describe('isSameDoc', () => {
    it('returns true when references are identical', () => {
      const doc = { id: 1, title: 'Test' }
      expect(isSameDoc(doc, doc)).toBe(true)
      expect(isSameDoc(null, null)).toBe(true)
      expect(isSameDoc(undefined, undefined)).toBe(true)
    })

    it('returns false when one is null/undefined and the other is not', () => {
      const doc = { id: 1, title: 'Test' }
      expect(isSameDoc(doc, null)).toBe(false)
      expect(isSameDoc(null, doc)).toBe(false)
      expect(isSameDoc(doc, undefined)).toBe(false)
    })

    it('returns true when id and updatedAt match', () => {
      const docA = { id: 1, title: 'Draft 1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const docB = { id: 1, title: 'Draft 2', updatedAt: '2026-01-01T00:00:00.000Z' }
      expect(isSameDoc(docA, docB)).toBe(true)
    })

    it('returns false when ids differ', () => {
      const docA = { id: 1, updatedAt: '2026-01-01T00:00:00.000Z' }
      const docB = { id: 2, updatedAt: '2026-01-01T00:00:00.000Z' }
      expect(isSameDoc(docA, docB)).toBe(false)
    })

    it('returns false when updatedAt differs', () => {
      const docA = { id: 1, updatedAt: '2026-01-01T00:00:00.000Z' }
      const docB = { id: 1, updatedAt: '2026-01-02T00:00:00.000Z' }
      expect(isSameDoc(docA, docB)).toBe(false)
    })
  })

  describe('permissions form helpers (#341)', () => {
    it('isFieldReadOnly evaluates create vs edit mode and readOnlyDoc', () => {
      const perm: FieldPermission = { read: true, create: false, update: true }
      expect(isFieldReadOnly(perm, 'create')).toBe(true)
      expect(isFieldReadOnly(perm, 'edit')).toBe(false)
      expect(isFieldReadOnly(perm, 'edit', true)).toBe(true)
      expect(isFieldReadOnly(undefined, 'create')).toBe(false)
    })

    it('isFieldVisible returns true unless read is explicitly false', () => {
      expect(isFieldVisible(undefined)).toBe(true)
      expect(isFieldVisible({ read: true, create: true, update: true })).toBe(true)
      expect(isFieldVisible({ read: false, create: true, update: true })).toBe(false)
    })

    it('filterReadableFields omits unreadable fields and nested subfields', () => {
      const fields: ClientField[] = [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'secret', type: 'text', label: 'Secret', required: false },
        {
          name: 'meta',
          type: 'group',
          label: 'Meta',
          required: false,
          fields: [
            { name: 'visibleSub', type: 'text', label: 'Visible Sub', required: false },
            { name: 'secretSub', type: 'text', label: 'Secret Sub', required: false },
          ],
        },
      ]

      const perms: Record<string, FieldPermission> = {
        title: { read: true, create: true, update: true },
        secret: { read: false, create: false, update: false },
        meta: {
          read: true,
          create: true,
          update: true,
          fields: {
            visibleSub: { read: true, create: true, update: true },
            secretSub: { read: false, create: false, update: false },
          },
        },
      }

      const filtered = filterReadableFields(fields, perms)
      expect(filtered.map((f) => f.name)).toEqual(['title', 'meta'])
      const groupField = filtered[1] as { fields: ClientField[] }
      expect(groupField.fields.map((f) => f.name)).toEqual(['visibleSub'])
    })

    it('stripReadOnlyFields drops non-writable fields in create and edit mode', () => {
      const fields: ClientField[] = [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'author', type: 'text', label: 'Author', required: false },
        {
          name: 'groupField',
          type: 'group',
          label: 'Group',
          required: false,
          fields: [
            { name: 'editable', type: 'text', label: 'Editable', required: false },
            { name: 'locked', type: 'text', label: 'Locked', required: false },
          ],
        },
        {
          name: 'arrayField',
          type: 'array',
          label: 'Array',
          required: false,
          fields: [
            { name: 'text', type: 'text', label: 'Text', required: false },
            { name: 'readOnlyText', type: 'text', label: 'ReadOnly', required: false },
          ],
        },
      ]

      const perms: Record<string, FieldPermission> = {
        title: { read: true, create: true, update: true },
        author: { read: true, create: false, update: true },
        groupField: {
          read: true,
          create: true,
          update: true,
          fields: {
            editable: { read: true, create: true, update: true },
            locked: { read: true, create: true, update: false },
          },
        },
        arrayField: {
          read: true,
          create: true,
          update: true,
          fields: {
            text: { read: true, create: true, update: true },
            readOnlyText: { read: true, create: true, update: false },
          },
        },
      }

      const inputDoc = {
        title: 'New Post',
        author: 'John',
        groupField: { editable: 'yes', locked: 'no' },
        arrayField: [{ text: 'item 1', readOnlyText: 'locked 1' }],
      }

      // In create mode: author has create: false, so it is stripped
      const createStripped = stripReadOnlyFields(fields, inputDoc, perms, 'create')
      expect(createStripped.title).toBe('New Post')
      expect(createStripped.author).toBeUndefined()
      // In create mode, locked inside group has create: true, so it is kept
      expect(createStripped.groupField).toEqual({ editable: 'yes', locked: 'no' })

      // In edit mode: author has update: true, so it is kept
      // groupField.locked has update: false, so it is stripped!
      // arrayField[0].readOnlyText has update: false, so it is stripped!
      const editStripped = stripReadOnlyFields(fields, inputDoc, perms, 'edit')
      expect(editStripped.title).toBe('New Post')
      expect(editStripped.author).toBe('John')
      expect(editStripped.groupField).toEqual({ editable: 'yes' })
      expect(editStripped.arrayField).toEqual([{ text: 'item 1' }])
    })

    it('formatDocForSubmit incorporates stripReadOnlyFields when permissions passed', () => {
      const fields: ClientField[] = [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'views', type: 'number', label: 'Views', required: false },
      ]
      const perms: Record<string, FieldPermission> = {
        title: { read: true, create: true, update: true },
        views: { read: true, create: false, update: false },
      }

      const submitted = formatDocForSubmit(
        fields,
        { title: 'Hello', views: 100 },
        true,
        perms,
        'edit',
      )
      expect(submitted).toEqual({ title: 'Hello' })
    })

    describe('buildFormValidationFields (#373)', () => {
      const baseFields: ClientField[] = [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'secret', type: 'text', label: 'Secret', required: true },
        { name: 'lockedField', type: 'text', label: 'Locked', required: true },
        {
          name: 'groupField',
          type: 'group',
          label: 'Group',
          required: true,
          fields: [
            { name: 'groupSub', type: 'text', label: 'Group Sub', required: true },
            { name: 'unreadableSub', type: 'text', label: 'Unreadable Sub', required: true },
          ],
        },
        {
          name: 'items',
          type: 'array',
          label: 'Items',
          required: true,
          minRows: 2,
          fields: [{ name: 'itemText', type: 'text', label: 'Item Text', required: true }],
        },
      ]

      const samplePerms: Record<string, FieldPermission> = {
        title: { read: true, create: true, update: true },
        secret: { read: false, create: false, update: false },
        lockedField: { read: true, create: false, update: false },
        groupField: {
          read: true,
          create: true,
          update: false,
          fields: {
            groupSub: { read: true, create: true, update: true },
            unreadableSub: { read: false, create: false, update: false },
          },
        },
        items: {
          read: true,
          create: false,
          update: false,
          fields: {
            itemText: { read: true, create: true, update: true },
          },
        },
      }

      it('omits unreadable fields and marks non-writable fields optional in edit mode', () => {
        const validationFields = buildFormValidationFields(baseFields, samplePerms, 'edit')

        // secret should be omitted completely (read: false)
        expect(validationFields.find((f) => f.name === 'secret')).toBeUndefined()

        // title is writable, remains required: true
        const title = validationFields.find((f) => f.name === 'title')
        expect(title?.required).toBe(true)

        // lockedField has update: false, becomes required: false
        const locked = validationFields.find((f) => f.name === 'lockedField')
        expect(locked?.required).toBe(false)

        // groupField has update: false, becomes required: false
        const group = validationFields.find((f) => f.name === 'groupField') as {
          required?: boolean
          fields: ClientField[]
        }
        expect(group?.required).toBe(false)
        // unreadableSub inside group is omitted
        expect(group?.fields.find((f) => f.name === 'unreadableSub')).toBeUndefined()
        // groupSub inside locked group becomes required: false because parent is locked
        expect(group?.fields.find((f) => f.name === 'groupSub')?.required).toBe(false)

        // items array has update: false, becomes required: false and minRows: 0
        const items = validationFields.find((f) => f.name === 'items') as {
          required?: boolean
          minRows?: number
        }
        expect(items?.required).toBe(false)
        expect(items?.minRows).toBe(0)
      })

      it('marks fields with create: false optional in create mode', () => {
        const validationFields = buildFormValidationFields(baseFields, samplePerms, 'create')

        // secret omitted
        expect(validationFields.find((f) => f.name === 'secret')).toBeUndefined()

        // title remains required: true
        expect(validationFields.find((f) => f.name === 'title')?.required).toBe(true)

        // lockedField has create: false, becomes required: false
        expect(validationFields.find((f) => f.name === 'lockedField')?.required).toBe(false)

        // groupField has create: true, remains required: true
        const group = validationFields.find((f) => f.name === 'groupField') as {
          required?: boolean
          fields: ClientField[]
        }
        expect(group?.required).toBe(true)
        // groupSub has create: true, remains required: true
        expect(group?.fields.find((f) => f.name === 'groupSub')?.required).toBe(true)

        // items has create: false, becomes required: false and minRows: 0
        const items = validationFields.find((f) => f.name === 'items') as {
          required?: boolean
          minRows?: number
        }
        expect(items?.required).toBe(false)
        expect(items?.minRows).toBe(0)
      })

      it('makes all fields optional when readOnlyDoc is true', () => {
        const validationFields = buildFormValidationFields(
          baseFields,
          samplePerms,
          'edit',
          true, // readOnlyDoc
        )
        const title = validationFields.find((f) => f.name === 'title')
        expect(title?.required).toBe(false)
      })

      it('allows form submission and validation when required field has read: false (#373 scenario 1)', () => {
        const fields = buildFormValidationFields(baseFields, samplePerms, 'edit')
        const schema = clientFieldsToZod(fields)

        // secret is missing from doc because server omitted it on read
        const formData = {
          title: 'Valid Title',
          // lockedField is omitted or empty
        }

        const parseResult = schema.safeParse(formData)
        expect(parseResult.success).toBe(true)
      })

      it('allows create submission when required field has create: false filled by hook (#373 scenario 2)', () => {
        const fields = buildFormValidationFields(baseFields, samplePerms, 'create')
        const schema = clientFieldsToZod(fields)

        // lockedField is left undefined/empty by user because disabled on create
        const formData = {
          title: 'New Doc',
          groupField: { groupSub: 'Nested value' },
          // items has create: false, omitted
        }

        const parseResult = schema.safeParse(formData)
        expect(parseResult.success).toBe(true)
      })

      it('allows autosave to validate payload when required field has update: false (#373 scenario 3)', () => {
        const fields = buildFormValidationFields(baseFields, samplePerms, 'edit')
        const schema = clientFieldsToZod(fields)

        // In edit mode: lockedField has update: false.
        // Before #373, formatDocForSubmit stripped lockedField from payload,
        // causing non-partial schema to fail validation because lockedField was required.
        // With #373, unstripped payload has lockedField or schema makes lockedField optional:
        const unstrippedPayload = formatDocForSubmit(
          baseFields,
          { title: 'Draft in progress', lockedField: 'existing' },
          true,
          undefined, // unstripped
          'edit',
        )

        const parseResult = schema.safeParse(unstrippedPayload)
        expect(parseResult.success).toBe(true)

        // Also, if stripped payload is passed, schema marked lockedField optional so it still passes:
        const strippedPayload = formatDocForSubmit(
          baseFields,
          { title: 'Draft in progress', lockedField: 'existing' },
          true,
          samplePerms,
          'edit',
        )
        expect(strippedPayload.lockedField).toBeUndefined()
        expect(schema.safeParse(strippedPayload).success).toBe(true)
      })

      it('still rejects autosave when a writable required field is empty', () => {
        const fields = buildFormValidationFields(baseFields, samplePerms, 'edit')
        const schema = clientFieldsToZod(fields)

        const invalidPayload = formatDocForSubmit(
          baseFields,
          { title: '', lockedField: 'existing' },
          true,
          undefined,
          'edit',
        )

        expect(schema.safeParse(invalidPayload).success).toBe(false)
      })
    })
  })

  describe('layout fields (tabs, row, collapsible) (#510)', () => {
    const layoutFields: ClientField[] = [
      { name: 'showExtra', type: 'checkbox', label: 'Show Extra', required: false },
      {
        name: 'mainTabs',
        type: 'tabs',
        label: 'Main Tabs',
        required: false,
        tabs: [
          {
            label: 'General',
            fields: [
              {
                name: 'row1',
                type: 'row',
                label: 'Row 1',
                required: false,
                fields: [
                  {
                    name: 'title',
                    type: 'text',
                    label: 'Title',
                    required: true,
                    defaultValue: 'Untitled',
                  },
                  {
                    name: 'publishedAt',
                    type: 'date',
                    label: 'Published At',
                    required: false,
                  },
                ],
              },
            ],
          },
          {
            label: 'Extra',
            condition: { showExtra: { equals: true } },
            fields: [
              {
                name: 'details',
                type: 'collapsible',
                label: 'Details',
                required: false,
                initiallyCollapsed: true,
                fields: [
                  { name: 'secretNote', type: 'text', label: 'Secret Note', required: true },
                  { name: 'lockedNote', type: 'text', label: 'Locked Note', required: true },
                ],
              },
            ],
          },
        ],
      },
    ]

    it('computes defaults, formats for form, and formats/sanitizes for submit across layout containers', () => {
      expect(computeDefaultValues(layoutFields)).toEqual({
        showExtra: false,
        title: 'Untitled',
      })

      const formDoc = formatDocForForm(layoutFields, {
        showExtra: true,
        title: 'Hello',
        publishedAt: '2024-05-01T03:00:00.000Z',
      })
      expect(formDoc.publishedAt).toBe(formatDateForInput('2024-05-01T03:00:00.000Z'))

      // When showExtra is false, fields inside the conditional tab are sanitized to null
      const submitHidden = formatDocForSubmit(layoutFields, {
        showExtra: false,
        title: 'Hello',
        publishedAt: '2024-05-01T10:00',
        secretNote: 'Should null out',
      })
      expect(submitHidden.publishedAt).toBe(formatDateForSubmit('2024-05-01T10:00'))
      expect(submitHidden.secretNote).toBeNull()
    })

    it('filters readable fields, strips read-only fields, and relaxes validation inside layout containers', () => {
      const perms: Record<string, FieldPermission> = {
        showExtra: { read: true, create: true, update: true },
        title: { read: true, create: true, update: true },
        publishedAt: { read: true, create: true, update: true },
        secretNote: { read: false, create: false, update: false },
        lockedNote: { read: true, create: true, update: false },
      }

      const readable = filterReadableFields(layoutFields, perms)
      const tabs = readable[1] as Extract<ClientField, { type: 'tabs' }>
      const extraTab = tabs.tabs[1]!
      const collapsible = extraTab.fields[0] as Extract<ClientField, { type: 'collapsible' }>
      expect(collapsible.fields.map((f) => f.name)).toEqual(['lockedNote'])

      const stripped = stripReadOnlyFields(
        layoutFields,
        { showExtra: true, title: 'Hello', lockedNote: 'Locked' },
        perms,
        'edit',
      )
      expect(stripped.lockedNote).toBeUndefined()

      const validationFields = buildFormValidationFields(layoutFields, perms, 'edit')
      const schema = clientFieldsToZod(validationFields)
      // Both secretNote (read: false) and lockedNote (update: false) were required, now optional
      expect(schema.safeParse({ showExtra: true, title: 'Valid' }).success).toBe(true)
    })
  })
})
