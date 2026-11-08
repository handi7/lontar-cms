import { describe, expect, it } from 'vitest'
import { postsConfig } from '../__fixtures__/posts'
import { toClientConfig } from '../config/to-client-config'
import type {
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientNumberField,
  ClientRelationshipField,
  ClientRichTextField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
  ClientUploadField,
} from './client-config'
import { clientFieldsToZod, clientFieldToZod } from './zod'

function text(overrides: Partial<ClientTextField> = {}) {
  const field: ClientTextField = {
    name: 'title',
    type: 'text',
    label: 'Title',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function number(overrides: Partial<ClientNumberField> = {}) {
  const field: ClientNumberField = {
    name: 'views',
    type: 'number',
    label: 'Views',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function textarea(overrides: Partial<ClientTextareaField> = {}) {
  const field: ClientTextareaField = {
    name: 'bio',
    type: 'textarea',
    label: 'Bio',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function email(overrides: Partial<ClientEmailField> = {}) {
  const field: ClientEmailField = {
    name: 'contactEmail',
    type: 'email',
    label: 'Contact Email',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function slug(overrides: Partial<ClientSlugField> = {}) {
  const field: ClientSlugField = {
    name: 'postSlug',
    type: 'slug',
    label: 'Post Slug',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function checkbox(overrides: Partial<ClientCheckboxField> = {}) {
  const field: ClientCheckboxField = {
    name: 'featured',
    type: 'checkbox',
    label: 'Featured',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function select(overrides: Partial<ClientSelectField> = {}) {
  const field: ClientSelectField = {
    name: 'status',
    type: 'select',
    label: 'Status',
    required: false,
    options: [
      { label: 'Draft', value: 'draft' },
      { label: 'Published', value: 'published' },
    ],
    ...overrides,
  }
  return clientFieldToZod(field)
}

function date(overrides: Partial<ClientDateField> = {}) {
  const field: ClientDateField = {
    name: 'publishedAt',
    type: 'date',
    label: 'Published At',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function richText(overrides: Partial<ClientRichTextField> = {}) {
  const field: ClientRichTextField = {
    name: 'content',
    type: 'richText',
    label: 'Content',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function relationship(overrides: Partial<ClientRelationshipField> = {}) {
  const field: ClientRelationshipField = {
    name: 'author',
    type: 'relationship',
    label: 'Author',
    relationTo: 'users',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function upload(overrides: Partial<ClientUploadField> = {}) {
  const field: ClientUploadField = {
    name: 'avatar',
    type: 'upload',
    label: 'Avatar',
    relationTo: 'media',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

describe('clientFieldToZod', () => {
  describe('text', () => {
    it('requires a non-blank string when required', () => {
      const schema = text({ required: true })
      expect(schema.safeParse('Hello').success).toBe(true)
      for (const value of ['', undefined, null, 42]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts an empty string, null and undefined when optional', () => {
      const schema = text()
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('enforces minLength and maxLength', () => {
      const schema = text({ minLength: 3, maxLength: 5 })
      expect(schema.safeParse('ab').success).toBe(false)
      expect(schema.safeParse('abc').success).toBe(true)
      expect(schema.safeParse('abcdef').success).toBe(false)
      expect(schema.safeParse('').success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    })

    it('defaults maxLength to 255 when not specified', () => {
      const schema = text()
      expect(schema.safeParse('a'.repeat(255)).success).toBe(true)
      expect(schema.safeParse('a'.repeat(256)).success).toBe(false)
    })

    it('keeps a minLength above 1 on a required field', () => {
      expect(text({ required: true, minLength: 3 }).safeParse('ab').success).toBe(false)
    })
  })

  describe('number', () => {
    it('rejects values that are not finite numbers', () => {
      const schema = number()
      expect(schema.safeParse(1.5).success).toBe(true)
      for (const value of ['1', Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('enforces integer, min and max', () => {
      const schema = number({ integer: true, min: 0, max: 10 })
      expect(schema.safeParse(10).success).toBe(true)
      for (const value of [1.5, -1, 11]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('requires a value when required', () => {
      const schema = number({ required: true })
      expect(schema.safeParse(0).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
    })
  })

  describe('textarea', () => {
    it('requires a non-blank string when required', () => {
      const schema = textarea({ required: true })
      expect(schema.safeParse('Bio content').success).toBe(true)
      for (const value of ['', undefined, null, 42]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts an empty string, null and undefined when optional', () => {
      const schema = textarea()
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('enforces minLength and maxLength', () => {
      const schema = textarea({ minLength: 5, maxLength: 10 })
      expect(schema.safeParse('abcd').success).toBe(false)
      expect(schema.safeParse('abcde').success).toBe(true)
      expect(schema.safeParse('abcdefghijk').success).toBe(false)
      expect(schema.safeParse('').success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    })
  })

  describe('email', () => {
    it('requires a valid email address when required', () => {
      const schema = email({ required: true })
      expect(schema.safeParse('user@example.com').success).toBe(true)
      for (const value of ['', 'not-an-email', '@no-local.com', undefined, null, 123]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts empty string, null, and undefined when optional', () => {
      const schema = email()
      expect(schema.safeParse('user@example.com').success).toBe(true)
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('rejects invalid email formats when optional and non-empty', () => {
      const schema = email()
      for (const value of ['not-an-email', 'foo@', '@bar.com']) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('enforces maxLength of 255', () => {
      const schema = email({ required: true })
      const validLong = `${'a'.repeat(243)}@example.com` // 255 chars
      const tooLong = `${'a'.repeat(244)}@example.com` // 256 chars
      expect(schema.safeParse(validLong).success).toBe(true)
      expect(schema.safeParse(tooLong).success).toBe(false)
    })
  })

  describe('slug', () => {
    it('requires a valid slug format when required', () => {
      const schema = slug({ required: true })
      expect(schema.safeParse('hello-world').success).toBe(true)
      expect(schema.safeParse('post-123').success).toBe(true)
      expect(schema.safeParse('simple').success).toBe(true)
      for (const value of ['', 'Hello World', 'slug--slug', '-slug', 'slug-', undefined, null]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts empty string, null, and undefined when optional', () => {
      const schema = slug()
      expect(schema.safeParse('my-slug').success).toBe(true)
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('rejects invalid slug formats when optional and non-empty', () => {
      const schema = slug()
      for (const value of ['Invalid Slug', 'slug/with/slash', 'slug_with_underscore']) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('enforces maxLength of 255', () => {
      const schema = slug({ required: true })
      expect(schema.safeParse('a'.repeat(255)).success).toBe(true)
      expect(schema.safeParse('a'.repeat(256)).success).toBe(false)
    })
  })

  describe('checkbox', () => {
    it('requires a boolean value when required', () => {
      const schema = checkbox({ required: true })
      expect(schema.safeParse(true).success).toBe(true)
      expect(schema.safeParse(false).success).toBe(true)
      for (const value of ['true', 1, 0, undefined, null]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts boolean, null, and undefined when optional', () => {
      const schema = checkbox()
      expect(schema.safeParse(true).success).toBe(true)
      expect(schema.safeParse(false).success).toBe(true)
      for (const value of [null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })
  })

  describe('select', () => {
    it('requires a valid option when required', () => {
      const schema = select({ required: true })
      expect(schema.safeParse('draft').success).toBe(true)
      expect(schema.safeParse('published').success).toBe(true)
      for (const value of ['archived', '', undefined, null, 123]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts valid option, empty string, null, and undefined when optional', () => {
      const schema = select()
      expect(schema.safeParse('draft').success).toBe(true)
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('rejects invalid options when optional', () => {
      const schema = select()
      expect(schema.safeParse('unknown').success).toBe(false)
    })
  })

  describe('date', () => {
    it('requires a valid date string or Date object when required', () => {
      const schema = date({ required: true })
      expect(schema.safeParse('2026-11-01').success).toBe(true)
      expect(schema.safeParse('2026-11-01T12:00:00.000Z').success).toBe(true)
      expect(schema.safeParse(new Date()).success).toBe(true)
      for (const value of ['not-a-date', '', undefined, null, 12345]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts valid date string, Date object, empty string, null, and undefined when optional', () => {
      const schema = date()
      expect(schema.safeParse('2026-11-01').success).toBe(true)
      expect(schema.safeParse(new Date()).success).toBe(true)
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('rejects invalid date strings when optional and non-empty', () => {
      const schema = date()
      expect(schema.safeParse('invalid-date').success).toBe(false)
    })
  })

  describe('richText', () => {
    it('requires a non-empty object when required', () => {
      const schema = richText({ required: true })
      expect(
        schema.safeParse({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello' }],
            },
          ],
        }).success,
      ).toBe(true)
      expect(schema.safeParse({ type: 'doc', content: [] }).success).toBe(false)
      expect(schema.safeParse({ type: 'doc', content: [{ type: 'paragraph' }] }).success).toBe(
        false,
      )
      expect(
        schema.safeParse({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
        }).success,
      ).toBe(false)
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
      expect(schema.safeParse('string').success).toBe(false)
      expect(schema.safeParse(123).success).toBe(false)
    })

    it('accepts valid object, null, and undefined when optional', () => {
      const schema = richText()
      expect(schema.safeParse({ type: 'doc' }).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    })

    it('rejects primitives when optional', () => {
      const schema = richText()
      expect(schema.safeParse('not an object').success).toBe(false)
      expect(schema.safeParse(123).success).toBe(false)
    })
  })

  describe('relationship', () => {
    it('validates single relationship as positive integer', () => {
      const schema = relationship({ required: true })
      expect(schema.safeParse(1).success).toBe(true)
      expect(schema.safeParse(42).success).toBe(true)
      expect(schema.safeParse(0).success).toBe(false)
      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(1.5).success).toBe(false)
      expect(schema.safeParse('1').success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
    })

    it('allows null and undefined when optional single relationship', () => {
      const schema = relationship({ required: false })
      expect(schema.safeParse(1).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse(0).success).toBe(false)
    })

    it('validates hasMany relationship as array of positive integers', () => {
      const schema = relationship({ hasMany: true, required: true })
      expect(schema.safeParse([1, 2, 3]).success).toBe(true)
      expect(schema.safeParse([]).success).toBe(false)
      expect(schema.safeParse([1, 0]).success).toBe(false)
      expect(schema.safeParse([1, -2]).success).toBe(false)
      expect(schema.safeParse([1, 2.5]).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
    })

    it('allows empty array, null and undefined when optional hasMany relationship', () => {
      const schema = relationship({ hasMany: true, required: false })
      expect(schema.safeParse([1, 2]).success).toBe(true)
      expect(schema.safeParse([]).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    })

    it('enforces maximum 32-bit signed integer for single relationship', () => {
      const schema = relationship({ required: true })
      expect(schema.safeParse(2147483647).success).toBe(true)
      expect(schema.safeParse(2147483648).success).toBe(false)
      expect(schema.safeParse(3000000000).success).toBe(false)
    })

    it('enforces maximum 32-bit signed integer for hasMany relationship', () => {
      const schema = relationship({ hasMany: true, required: true })
      expect(schema.safeParse([1, 2147483647]).success).toBe(true)
      expect(schema.safeParse([1, 2147483648]).success).toBe(false)
      expect(schema.safeParse([3000000000]).success).toBe(false)
    })
  })

  describe('upload', () => {
    it('validates upload as positive integer within 32-bit signed range', () => {
      const schema = upload({ required: true })
      expect(schema.safeParse(1).success).toBe(true)
      expect(schema.safeParse(2147483647).success).toBe(true)
      expect(schema.safeParse(2147483648).success).toBe(false)
      expect(schema.safeParse(0).success).toBe(false)
      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse('1').success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
    })

    it('allows null and undefined when optional', () => {
      const schema = upload({ required: false })
      expect(schema.safeParse(1).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse(2147483648).success).toBe(false)
    })
  })

  describe('group', () => {
    it('validates an optional group: passes when omitted, null, or valid object', () => {
      const schema = clientFieldToZod({
        name: 'seo',
        type: 'group',
        label: 'SEO',
        required: false,
        fields: [
          { name: 'title', type: 'text', label: 'Title', required: true, maxLength: 60 },
          { name: 'desc', type: 'text', label: 'Desc', required: false, maxLength: 160 },
        ],
      })

      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse({ title: 'My Title' }).success).toBe(true)
      expect(schema.safeParse({ title: 'My Title', desc: 'My Desc' }).success).toBe(true)
      // When group is provided as object, required subfield 'title' must be present
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse({ desc: 'No title' }).success).toBe(false)
    })

    it('validates a required group: rejects null and undefined', () => {
      const schema = clientFieldToZod({
        name: 'seo',
        type: 'group',
        label: 'SEO',
        required: true,
        fields: [{ name: 'title', type: 'text', label: 'Title', required: true, maxLength: 60 }],
      })

      expect(schema.safeParse(undefined).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse({ title: 'Valid' }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(false)
    })
  })

  describe('array fields', () => {
    it('validates an optional array and generates 16-hex row id', () => {
      const schema = clientFieldToZod({
        name: 'gallery',
        type: 'array',
        label: 'Gallery',
        required: false,
        fields: [
          { name: 'caption', type: 'text', label: 'Caption', required: true, maxLength: 60 },
        ],
      })

      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)

      const parsed = schema.parse([
        { caption: 'Pic 1' },
        { id: 'custom-row-id-123', caption: 'Pic 2' },
      ]) as Array<{ id: string; caption: string }>
      expect(parsed).toBeDefined()
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0]?.caption).toBe('Pic 1')
      expect(parsed[0]?.id).toMatch(/^[0-9a-f]{16}$/)
      expect(parsed[1]?.caption).toBe('Pic 2')
      expect(parsed[1]?.id).toBe('custom-row-id-123')

      // Invalid subfield
      expect(schema.safeParse([{}])).toMatchObject({ success: false })
      // Non-array
      expect(schema.safeParse('not an array')).toMatchObject({ success: false })
    })

    it('enforces minRows and maxRows', () => {
      const schema = clientFieldToZod({
        name: 'items',
        type: 'array',
        label: 'Items',
        required: false,
        minRows: 2,
        maxRows: 3,
        fields: [{ name: 'title', type: 'text', label: 'Title', required: true, maxLength: 60 }],
      })

      expect(schema.safeParse([{ title: 'One' }]).success).toBe(false)
      expect(schema.safeParse([{ title: 'One' }, { title: 'Two' }]).success).toBe(true)
      expect(
        schema.safeParse([{ title: 'One' }, { title: 'Two' }, { title: 'Three' }]).success,
      ).toBe(true)
      expect(
        schema.safeParse([
          { title: 'One' },
          { title: 'Two' },
          { title: 'Three' },
          { title: 'Four' },
        ]).success,
      ).toBe(false)
    })

    it('defaults minRows to 1 when required is true', () => {
      const schema = clientFieldToZod({
        name: 'items',
        type: 'array',
        label: 'Items',
        required: true,
        fields: [{ name: 'title', type: 'text', label: 'Title', required: true, maxLength: 60 }],
      })

      expect(schema.safeParse(undefined).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse([]).success).toBe(false)
      expect(schema.safeParse([{ title: 'One' }]).success).toBe(true)
    })
  })
})

describe('clientFieldsToZod', () => {
  // The same path the server takes: config → ClientConfig → Zod.
  const posts = clientFieldsToZod(toClientConfig(postsConfig).collections[0]?.fields ?? [])

  it('accepts a valid posts document', () => {
    expect(posts.parse({ title: 'Hello', views: 3 })).toEqual({ title: 'Hello', views: 3 })
    expect(posts.parse({ title: 'Hello' })).toEqual({ title: 'Hello' })
  })

  it('rejects a posts document that breaks a field rule', () => {
    const result = posts.safeParse({ title: 'x'.repeat(121), views: -1 })
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['title'], ['views']])
  })

  it('strips unknown keys and system fields', () => {
    const input = { title: 'Hello', id: 1, createdAt: '2026-10-31T00:00:00.000Z', extra: true }
    expect(posts.parse(input)).toEqual({ title: 'Hello' })
  })
})
