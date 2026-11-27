import { describe, expect, it } from 'vitest'
import { postsConfig } from '../__fixtures__/posts'
import { toClientConfig } from '../config/to-client-config'
import type {
  ClientCheckboxField,
  ClientCodeField,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientJsonField,
  ClientNumberField,
  ClientPointField,
  ClientRadioField,
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

function code(overrides: Partial<ClientCodeField> = {}) {
  const field: ClientCodeField = {
    name: 'snippet',
    type: 'code',
    label: 'Snippet',
    required: false,
    ...overrides,
  }
  return clientFieldToZod(field)
}

function json(overrides: Partial<ClientJsonField> = {}) {
  const field: ClientJsonField = {
    name: 'metadata',
    type: 'json',
    label: 'Metadata',
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

function radio(overrides: Partial<ClientRadioField> = {}) {
  const field: ClientRadioField = {
    name: 'theme',
    type: 'radio',
    label: 'Theme',
    layout: 'vertical',
    required: false,
    options: [
      { label: 'Light', value: 'light' },
      { label: 'Dark', value: 'dark' },
    ],
    ...overrides,
  }
  return clientFieldToZod(field)
}

function point(overrides: Partial<ClientPointField> = {}) {
  const field: ClientPointField = {
    name: 'coordinates',
    type: 'point',
    label: 'Coordinates',
    required: false,
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

    it('validates hasMany array of strings and row bounds', () => {
      const schema = text({ hasMany: true, required: true, minRows: 2, maxRows: 3, minLength: 2 })
      expect(schema.safeParse(['ab', 'cd']).success).toBe(true)
      expect(schema.safeParse(['ab', 'cd', 'ef']).success).toBe(true)
      expect(schema.safeParse(['ab']).success).toBe(false)
      expect(schema.safeParse(['ab', 'cd', 'ef', 'gh']).success).toBe(false)
      expect(schema.safeParse(['ab', 'c']).success).toBe(false)
      expect(schema.safeParse(['ab', 123]).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
    })

    it('accepts null/undefined for optional hasMany text', () => {
      const schema = text({ hasMany: true, required: false })
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse([]).success).toBe(true)
      expect(schema.safeParse(['hello']).success).toBe(true)
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

    it('validates hasMany array of numbers and bounds', () => {
      const schema = number({
        hasMany: true,
        required: true,
        minRows: 1,
        maxRows: 2,
        integer: true,
        min: 10,
      })
      expect(schema.safeParse([10]).success).toBe(true)
      expect(schema.safeParse([10, 20]).success).toBe(true)
      expect(schema.safeParse([]).success).toBe(false)
      expect(schema.safeParse([10, 20, 30]).success).toBe(false)
      expect(schema.safeParse([5]).success).toBe(false)
      expect(schema.safeParse([10.5]).success).toBe(false)
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

  describe('code', () => {
    it('requires a non-blank string when required', () => {
      const schema = code({ required: true })
      expect(schema.safeParse('console.log("hello")').success).toBe(true)
      for (const value of ['', undefined, null, 42]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts an empty string, null and undefined when optional', () => {
      const schema = code()
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('enforces minLength and maxLength', () => {
      const schema = code({ minLength: 5, maxLength: 10 })
      expect(schema.safeParse('abcd').success).toBe(false)
      expect(schema.safeParse('abcde').success).toBe(true)
      expect(schema.safeParse('abcdefghijk').success).toBe(false)
      expect(schema.safeParse('').success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    })
  })

  describe('json', () => {
    it('requires a valid JSON value when required', () => {
      const schema = json({ required: true })
      expect(schema.safeParse({ key: 'val' }).success).toBe(true)
      expect(schema.safeParse([1, 2, 3]).success).toBe(true)
      expect(schema.safeParse('hello').success).toBe(true)
      expect(schema.safeParse(123).success).toBe(true)
      expect(schema.safeParse(false).success).toBe(true)
      for (const value of ['', undefined, null]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts null and undefined when optional', () => {
      const schema = json()
      for (const value of [null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
      expect(schema.safeParse({ foo: 'bar' }).success).toBe(true)
    })

    it('enforces maxBytes size limit', () => {
      const schema = json({ maxBytes: 20 })
      expect(schema.safeParse({ a: 1 }).success).toBe(true)
      expect(
        schema.safeParse({ longKeyName: 'very long string value exceeding twenty bytes' }).success,
      ).toBe(false)
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

  describe('radio', () => {
    it('requires a valid option when required', () => {
      const schema = radio({ required: true })
      expect(schema.safeParse('light').success).toBe(true)
      expect(schema.safeParse('dark').success).toBe(true)
      for (const value of ['system', '', undefined, null, 123]) {
        expect(schema.safeParse(value).success).toBe(false)
      }
    })

    it('accepts valid option, empty string, null, and undefined when optional', () => {
      const schema = radio()
      expect(schema.safeParse('light').success).toBe(true)
      for (const value of ['', null, undefined]) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    })

    it('rejects invalid options when optional', () => {
      const schema = radio()
      expect(schema.safeParse('unknown').success).toBe(false)
    })
  })

  describe('point', () => {
    it('accepts valid [lng, lat] coordinate pairs when required', () => {
      const schema = point({ required: true })
      expect(schema.safeParse([106.8456, -6.2088]).success).toBe(true)
      expect(schema.safeParse([-180, -90]).success).toBe(true)
      expect(schema.safeParse([180, 90]).success).toBe(true)
      expect(schema.safeParse([0, 0]).success).toBe(true)
    })

    it('rejects coordinates out of bounds', () => {
      const schema = point({ required: true })
      expect(schema.safeParse([-180.1, 0]).success).toBe(false)
      expect(schema.safeParse([180.1, 0]).success).toBe(false)
      expect(schema.safeParse([0, -90.1]).success).toBe(false)
      expect(schema.safeParse([0, 90.1]).success).toBe(false)
    })

    it('rejects invalid shapes (not 2 elements, non-numbers, null when required)', () => {
      const schema = point({ required: true })
      expect(schema.safeParse([10]).success).toBe(false)
      expect(schema.safeParse([10, 20, 30]).success).toBe(false)
      expect(schema.safeParse(['10', '20']).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
    })

    it('accepts null and undefined when optional', () => {
      const schema = point({ required: false })
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse([106.8456, -6.2088]).success).toBe(true)
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

    it('validates single polymorphic relationship references', () => {
      const schema = relationship({
        relationTo: ['authors', 'editors'],
        required: true,
      })
      expect(schema.safeParse({ relationTo: 'authors', value: 1 }).success).toBe(true)
      expect(schema.safeParse({ relationTo: 'editors', value: 42 }).success).toBe(true)
      expect(schema.safeParse({ relationTo: 'unknown', value: 1 }).success).toBe(false)
      expect(schema.safeParse({ relationTo: 'authors', value: 0 }).success).toBe(false)
      expect(schema.safeParse({ relationTo: 'authors', value: -1 }).success).toBe(false)
      expect(schema.safeParse({ relationTo: 'authors', value: 2147483648 }).success).toBe(false)
      expect(schema.safeParse(1).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)

      const optionalSchema = relationship({
        relationTo: ['authors', 'editors'],
        required: false,
      })
      expect(optionalSchema.safeParse(null).success).toBe(true)
      expect(optionalSchema.safeParse(undefined).success).toBe(true)
      expect(optionalSchema.safeParse({ relationTo: 'authors', value: 5 }).success).toBe(true)
    })

    it('validates hasMany polymorphic relationship references', () => {
      const requiredSchema = relationship({
        relationTo: ['authors', 'editors'],
        hasMany: true,
        required: true,
      })
      expect(
        requiredSchema.safeParse([
          { relationTo: 'authors', value: 1 },
          { relationTo: 'editors', value: 2 },
        ]).success,
      ).toBe(true)
      expect(requiredSchema.safeParse([]).success).toBe(false)
      expect(requiredSchema.safeParse([{ relationTo: 'other', value: 1 }]).success).toBe(false)
      expect(requiredSchema.safeParse([1]).success).toBe(false)

      const optionalSchema = relationship({
        relationTo: ['authors', 'editors'],
        hasMany: true,
        required: false,
      })
      expect(optionalSchema.safeParse([]).success).toBe(true)
      expect(optionalSchema.safeParse(null).success).toBe(true)
      expect(optionalSchema.safeParse(undefined).success).toBe(true)
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

  describe('blocks fields', () => {
    it('validates blocks as a discriminated union on blockType and assigns row id', () => {
      const schema = clientFieldToZod({
        name: 'layout',
        type: 'blocks',
        label: 'Layout',
        required: false,
        blocks: [
          {
            slug: 'hero',
            labels: { singular: 'Hero', plural: 'Heroes' },
            fields: [
              { name: 'heading', type: 'text', label: 'Heading', required: true, maxLength: 80 },
            ],
          },
          {
            slug: 'cta',
            labels: { singular: 'CTA', plural: 'CTAs' },
            fields: [
              { name: 'linkUrl', type: 'text', label: 'Link URL', required: true, maxLength: 200 },
            ],
          },
        ],
      })

      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse(null).success).toBe(true)

      const parsed = schema.parse([
        { blockType: 'hero', heading: 'Welcome' },
        { id: 'custom-cta-1234', blockType: 'cta', linkUrl: 'https://example.com' },
      ]) as Array<{ id: string; blockType: string; heading?: string; linkUrl?: string }>

      expect(parsed).toBeDefined()
      expect(parsed[0]?.blockType).toBe('hero')
      expect(parsed[0]?.heading).toBe('Welcome')
      expect(parsed[0]?.id).toMatch(/^[0-9a-f]{16}$/)

      expect(parsed[1]?.blockType).toBe('cta')
      expect(parsed[1]?.linkUrl).toBe('https://example.com')
      expect(parsed[1]?.id).toBe('custom-cta-1234')

      // Invalid blockType
      expect(schema.safeParse([{ blockType: 'unknown', heading: 'Test' }]).success).toBe(false)

      // Missing required field for blockType
      expect(schema.safeParse([{ blockType: 'hero' }]).success).toBe(false)
      expect(schema.safeParse([{ blockType: 'cta' }]).success).toBe(false)
    })

    it('enforces minRows and maxRows on blocks fields', () => {
      const schema = clientFieldToZod({
        name: 'layout',
        type: 'blocks',
        label: 'Layout',
        required: false,
        minRows: 1,
        maxRows: 2,
        blocks: [
          {
            slug: 'item',
            labels: { singular: 'Item', plural: 'Items' },
            fields: [{ name: 'text', type: 'text', label: 'Text', required: true, maxLength: 50 }],
          },
        ],
      })

      expect(schema.safeParse([]).success).toBe(false)
      expect(schema.safeParse([{ blockType: 'item', text: 'A' }]).success).toBe(true)
      expect(
        schema.safeParse([
          { blockType: 'item', text: 'A' },
          { blockType: 'item', text: 'B' },
        ]).success,
      ).toBe(true)
      expect(
        schema.safeParse([
          { blockType: 'item', text: 'A' },
          { blockType: 'item', text: 'B' },
          { blockType: 'item', text: 'C' },
        ]).success,
      ).toBe(false)
    })

    it('generates row ids recursively for nested arrays inside blocks (#176)', () => {
      const schema = clientFieldToZod({
        name: 'layout',
        type: 'blocks',
        label: 'Layout',
        required: false,
        blocks: [
          {
            slug: 'gallery',
            labels: { singular: 'Gallery', plural: 'Galleries' },
            fields: [
              {
                name: 'images',
                type: 'array',
                label: 'Images',
                required: false,
                fields: [
                  {
                    name: 'caption',
                    type: 'text',
                    label: 'Caption',
                    required: true,
                    maxLength: 50,
                  },
                ],
              },
            ],
          },
        ],
      })

      const parsed = schema.parse([
        {
          blockType: 'gallery',
          images: [{ caption: 'Photo 1' }, { caption: 'Photo 2' }],
        },
      ]) as Array<{
        id: string
        blockType: string
        images: Array<{ id: string; caption: string }>
      }>

      const firstBlock = parsed[0]!
      const img1 = firstBlock.images[0]!
      const img2 = firstBlock.images[1]!
      expect(firstBlock.id).toMatch(/^[0-9a-f]{16}$/)
      expect(firstBlock.images).toHaveLength(2)
      expect(img1.id).toMatch(/^[0-9a-f]{16}$/)
      expect(img2.id).toMatch(/^[0-9a-f]{16}$/)
      expect(img1.id).not.toBe(img2.id)
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

  describe('conditional fields via admin.condition', () => {
    const conditionalFields: ClientField[] = [
      {
        name: 'format',
        type: 'select',
        label: 'Format',
        required: true,
        options: [
          { label: 'Standard', value: 'standard' },
          { label: 'Video', value: 'video' },
        ],
      },
      {
        name: 'videoUrl',
        type: 'text',
        label: 'Video URL',
        required: true,
        minLength: 5,
        condition: { format: { equals: 'video' } },
      },
      {
        name: 'authorBio',
        type: 'text',
        label: 'Author Bio',
        required: false,
        minLength: 10,
        condition: { format: { equals: 'standard' } },
      },
      {
        name: 'seo',
        type: 'group',
        label: 'SEO',
        required: false,
        fields: [
          { name: 'enabled', type: 'checkbox', label: 'Enabled', required: false },
          {
            name: 'keywords',
            type: 'text',
            label: 'Keywords',
            required: true,
            condition: { enabled: { equals: true } },
          },
          {
            name: 'featuredNote',
            type: 'text',
            label: 'Featured Note',
            required: true,
            condition: { '$root.format': { equals: 'video' } },
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
            name: 'mediaType',
            type: 'select',
            label: 'Media Type',
            required: true,
            options: [
              { label: 'Image', value: 'image' },
              { label: 'Embed', value: 'embed' },
            ],
          },
          {
            name: 'embedCode',
            type: 'text',
            label: 'Embed Code',
            required: true,
            condition: { mediaType: { equals: 'embed' } },
          },
        ],
      },
      {
        name: 'sections',
        type: 'blocks',
        label: 'Sections',
        required: false,
        blocks: [
          {
            slug: 'cta',
            labels: { singular: 'CTA', plural: 'CTAs' },
            fields: [
              { name: 'hasButton', type: 'checkbox', label: 'Has Button', required: false },
              {
                name: 'buttonUrl',
                type: 'text',
                label: 'Button URL',
                required: true,
                condition: { hasButton: { equals: true } },
              },
            ],
          },
        ],
      },
    ]

    const schema = clientFieldsToZod(conditionalFields)

    it('enforces required rule when condition matches', () => {
      // format is video, so videoUrl is required
      const result = schema.safeParse({ format: 'video' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'videoUrl')).toBe(true)
      }
    })

    it('skips required rule when condition does not match', () => {
      // format is standard, videoUrl condition is false -> videoUrl is not required
      const result = schema.safeParse({ format: 'standard' })
      expect(result.success).toBe(true)
    })

    it('skips format checks when condition does not match even if value is invalid', () => {
      // videoUrl minLength is 5, but format is standard (condition false) -> videoUrl ignored
      const result = schema.safeParse({ format: 'standard', videoUrl: 'abc' })
      expect(result.success).toBe(true)
    })

    it('enforces format checks when condition matches', () => {
      // format is video, videoUrl has 'abc' (< minLength 5) -> fails minLength!
      const result = schema.safeParse({ format: 'video', videoUrl: 'abc' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'videoUrl')).toBe(true)
      }
    })

    it('passes when active conditional field satisfies validation', () => {
      const result = schema.safeParse({
        format: 'video',
        videoUrl: 'https://youtube.com/watch?v=123',
      })
      expect(result.success).toBe(true)
    })

    it('validates conditional fields inside group with sibling and root scoping', () => {
      // seo.enabled is true -> seo.keywords is required
      const invalidSeo = schema.safeParse({
        format: 'standard',
        seo: { enabled: true },
      })
      expect(invalidSeo.success).toBe(false)
      if (!invalidSeo.success) {
        expect(invalidSeo.error.issues.some((i) => i.path.join('.') === 'seo.keywords')).toBe(true)
      }

      // seo.enabled is false -> seo.keywords is skipped
      const validSeo = schema.safeParse({
        format: 'standard',
        seo: { enabled: false },
      })
      expect(validSeo.success).toBe(true)

      // $root.format is video -> seo.featuredNote is required!
      const rootConditionFail = schema.safeParse({
        format: 'video',
        videoUrl: 'https://example.com/video',
        seo: { enabled: false },
      })
      expect(rootConditionFail.success).toBe(false)
      if (!rootConditionFail.success) {
        expect(
          rootConditionFail.error.issues.some((i) => i.path.join('.') === 'seo.featuredNote'),
        ).toBe(true)
      }
    })

    it('validates conditional fields inside array rows with sibling scoping', () => {
      // Row 0 has embed -> embedCode is required!
      const fail = schema.safeParse({
        format: 'standard',
        gallery: [{ mediaType: 'embed' }],
      })
      expect(fail.success).toBe(false)
      if (!fail.success) {
        expect(fail.error.issues.some((i) => i.path.join('.') === 'gallery.0.embedCode')).toBe(true)
      }

      // Row 0 has image -> embedCode skipped
      const pass = schema.safeParse({
        format: 'standard',
        gallery: [{ mediaType: 'image' }],
      })
      expect(pass.success).toBe(true)
    })

    it('validates conditional fields inside blocks items with sibling scoping', () => {
      // Block hasButton is true -> buttonUrl required
      const fail = schema.safeParse({
        format: 'standard',
        sections: [{ blockType: 'cta', hasButton: true }],
      })
      expect(fail.success).toBe(false)
      if (!fail.success) {
        expect(fail.error.issues.some((i) => i.path.join('.') === 'sections.0.buttonUrl')).toBe(
          true,
        )
      }

      // Block hasButton is false -> buttonUrl skipped
      const pass = schema.safeParse({
        format: 'standard',
        sections: [{ blockType: 'cta', hasButton: false }],
      })
      expect(pass.success).toBe(true)
    })

    it('supports schema.partial() without throwing and respects partial semantics', () => {
      const partialSchema = schema.partial()
      expect(typeof partialSchema.safeParse).toBe('function')

      // In partial update, omitted format or videoUrl does not fail required
      const pass = partialSchema.safeParse({ authorBio: 'Experienced technical writer' })
      expect(pass.success).toBe(true)

      // If format is video and videoUrl is provided but invalid (< minLength 5), it fails
      const fail = partialSchema.safeParse({ format: 'video', videoUrl: 'abc' })
      expect(fail.success).toBe(false)
    })

    it('enforces required conditional fields revealed by PATCH when originalDoc is provided (#174)', () => {
      const originalDoc = { format: 'standard', videoUrl: null }
      const partialSchema = clientFieldsToZod(conditionalFields, { partial: true, originalDoc })

      // PATCH { format: 'video' } reveals videoUrl, but it is absent from patch and null in original -> fails
      const fail = partialSchema.safeParse({ format: 'video' })
      expect(fail.success).toBe(false)
      if (!fail.success) {
        expect(fail.error.issues.some((i) => i.path[0] === 'videoUrl')).toBe(true)
      }

      // Supplying the revealed required field satisfies validation
      const pass = partialSchema.safeParse({
        format: 'video',
        videoUrl: 'https://youtube.com/watch?v=123',
      })
      expect(pass.success).toBe(true)
    })

    it('allows PATCH of unrelated fields when required conditional field is already satisfied in originalDoc (#174)', () => {
      const originalDoc = {
        format: 'video',
        videoUrl: 'https://youtube.com/watch?v=123',
      }
      const partialSchema = clientFieldsToZod(conditionalFields, { partial: true, originalDoc })

      // Editing authorBio while format is already video and videoUrl already exists in originalDoc
      const pass = partialSchema.safeParse({ authorBio: 'New author bio' })
      expect(pass.success).toBe(true)
    })

    it('allows PATCH turning condition OFF without providing the conditional field (#174)', () => {
      const originalDoc = {
        format: 'video',
        videoUrl: 'https://youtube.com/watch?v=123',
      }
      const partialSchema = clientFieldsToZod(conditionalFields, { partial: true, originalDoc })

      // Switching format back to standard hides videoUrl
      const pass = partialSchema.safeParse({ format: 'standard' })
      expect(pass.success).toBe(true)
    })

    it('enforces required conditional fields inside group revealed by PATCH with originalDoc (#174)', () => {
      const originalDoc = {
        format: 'standard',
        seo: { enabled: false, keywords: null },
      }
      const partialSchema = clientFieldsToZod(conditionalFields, { partial: true, originalDoc })

      // Enabling seo without keywords -> fails because keywords is required when enabled is true
      const fail = partialSchema.safeParse({ seo: { enabled: true } })
      expect(fail.success).toBe(false)
      if (!fail.success) {
        expect(fail.error.issues.some((i) => i.path.join('.') === 'seo.keywords')).toBe(true)
      }

      // Enabling seo with keywords provided -> succeeds
      const pass = partialSchema.safeParse({
        seo: { enabled: true, keywords: 'lontar, cms' },
      })
      expect(pass.success).toBe(true)
    })

    it('strips _status if provided in input', () => {
      const schema = clientFieldsToZod([
        { name: 'title', type: 'text', label: 'Title', required: true },
      ])
      const result = schema.parse({ title: 'Hello', _status: 'published' })
      expect(result).toEqual({ title: 'Hello' })
      expect(result).not.toHaveProperty('_status')
    })

    describe('localization write schemas', () => {
      const localizedFields: ClientField[] = [
        { name: 'title', type: 'text', label: 'Title', required: true, localized: true },
        { name: 'slug', type: 'slug', label: 'Slug', required: true, localized: true },
        { name: 'authorId', type: 'number', label: 'Author', required: true },
        {
          name: 'gallery',
          type: 'array',
          label: 'Gallery',
          required: false,
          fields: [
            { name: 'caption', type: 'text', label: 'Caption', localized: true, required: true },
          ],
        },
        {
          name: 'localizedBlocks',
          type: 'blocks',
          label: 'Localized Blocks',
          required: false,
          localized: true,
          blocks: [
            {
              slug: 'quote',
              labels: { singular: 'Quote', plural: 'Quotes' },
              fields: [{ name: 'text', type: 'text', label: 'Text', required: true }],
            },
          ],
        },
      ]

      it('validates flat single-locale write payload by default', () => {
        const schema = clientFieldsToZod(localizedFields)

        const valid = schema.safeParse({
          title: 'Hello World',
          slug: 'hello-world',
          authorId: 1,
          gallery: [{ caption: 'Photo caption' }],
          localizedBlocks: [{ blockType: 'quote', text: 'To be or not to be' }],
        })
        expect(valid.success).toBe(true)

        // Invalid: missing required flat title
        const invalid = schema.safeParse({
          slug: 'hello-world',
          authorId: 1,
        })
        expect(invalid.success).toBe(false)
      })

      it('validates locale=all write payload with localized dictionaries', () => {
        const schemaAll = clientFieldsToZod(localizedFields, { locale: 'all' })

        const valid = schemaAll.safeParse({
          title: { en: 'Hello World', id: 'Halo Dunia' },
          slug: { en: 'hello-world', id: 'halo-dunia' },
          authorId: 1, // non-localized stays flat
          gallery: [
            {
              caption: { en: 'Mountain photo', id: 'Foto gunung' },
            },
          ],
          localizedBlocks: {
            en: [{ blockType: 'quote', text: 'English quote' }],
            id: [{ blockType: 'quote', text: 'Kutipan bahasa Indonesia' }],
          },
        })
        expect(valid.success).toBe(true)

        // Required localized field rejects empty dictionary
        const emptyTitle = schemaAll.safeParse({
          title: {},
          authorId: 1,
        })
        expect(emptyTitle.success).toBe(false)

        // Required localized field accepts single locale in dictionary
        const partialLocales = schemaAll.safeParse({
          title: { id: 'Halo Dunia' },
          slug: { id: 'halo-dunia' },
          authorId: 1,
        })
        expect(partialLocales.success).toBe(true)
      })
    })
  })
})

describe('clientFieldsToZod with a localized group and locale=all', () => {
  const groupFields: ClientField[] = [
    {
      name: 'seo',
      type: 'group',
      label: 'Seo',
      required: false,
      localized: true,
      fields: [
        { name: 'title', type: 'text', label: 'Title', required: true, localized: true },
        { name: 'note', type: 'text', label: 'Note', required: false, localized: true },
      ],
    },
  ]

  it('expects the per-locale record on the subfields, not around the group', () => {
    const schema = clientFieldsToZod(groupFields, { locale: 'all' })
    const canonical = { seo: { title: { en: 'x', id: 'y' }, note: { en: 'n' } } }
    expect(schema.safeParse(canonical).success).toBe(true)
    expect(schema.safeParse({ seo: { en: { title: { en: 'x' } } } }).success).toBe(false)
  })

  it('still requires a value for a required localized subfield', () => {
    const schema = clientFieldsToZod(groupFields, { locale: 'all' })
    expect(schema.safeParse({ seo: { title: {} } }).success).toBe(false)
  })
})

describe('clientFieldsToZod with layout fields (tabs, row, collapsible)', () => {
  const layoutFields: ClientField[] = [
    {
      name: 'enableSeo',
      type: 'checkbox',
      label: 'Enable SEO',
      required: false,
    },
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
              name: 'titleRow',
              type: 'row',
              label: 'Title Row',
              required: false,
              fields: [
                { name: 'title', type: 'text', label: 'Title', required: true },
                { name: 'slug', type: 'slug', label: 'Slug', required: true, from: 'title' },
              ],
            },
          ],
        },
        {
          label: 'SEO',
          condition: { enableSeo: { equals: true } },
          fields: [
            {
              name: 'seoCollapsible',
              type: 'collapsible',
              label: 'Meta',
              required: false,
              fields: [{ name: 'metaTitle', type: 'text', label: 'Meta Title', required: true }],
            },
          ],
        },
      ],
    },
  ]

  it('validates flattened document data matching fields inside layout containers', () => {
    const schema = clientFieldsToZod(layoutFields)
    const valid = schema.safeParse({
      title: 'Hello',
      slug: 'hello',
      enableSeo: false,
    })
    expect(valid.success).toBe(true)

    const missingTitle = schema.safeParse({
      slug: 'hello',
      enableSeo: false,
    })
    expect(missingTitle.success).toBe(false)
  })

  it('inherits tab condition so required fields in conditional tabs are optional when condition evaluates to false', () => {
    const schema = clientFieldsToZod(layoutFields)

    // When enableSeo is false, metaTitle is not required
    const noSeo = schema.safeParse({
      title: 'Hello',
      slug: 'hello',
      enableSeo: false,
    })
    expect(noSeo.success).toBe(true)

    // When enableSeo is true, metaTitle IS required
    const withSeoMissingMeta = schema.safeParse({
      title: 'Hello',
      slug: 'hello',
      enableSeo: true,
    })
    expect(withSeoMissingMeta.success).toBe(false)

    // With metaTitle provided, it passes
    const withSeoValid = schema.safeParse({
      title: 'Hello',
      slug: 'hello',
      enableSeo: true,
      metaTitle: 'Meta Title',
    })
    expect(withSeoValid.success).toBe(true)
  })
})

describe('clientFieldsToZod with join fields (ADR 0033)', () => {
  const authorFields: ClientField[] = [
    { name: 'name', type: 'text', label: 'Name', required: true },
    {
      name: 'posts',
      type: 'join',
      label: 'Posts',
      required: false,
      collection: 'posts',
      on: 'author',
      limit: 10,
    },
  ]

  it('allows omitting join fields on create and partial update', () => {
    const schema = clientFieldsToZod(authorFields)
    expect(schema.safeParse({ name: 'Alice' })).toEqual({
      success: true,
      data: { name: 'Alice' },
    })
    expect(schema.partial().safeParse({ name: 'Alice Updated' })).toEqual({
      success: true,
      data: { name: 'Alice Updated' },
    })
  })

  it('rejects any value sent for a read-only join field on create or update', () => {
    const schema = clientFieldsToZod(authorFields)
    for (const badVal of [[], null, { docs: [], totalDocs: 0 }, 'posts']) {
      const createRes = schema.safeParse({ name: 'Alice', posts: badVal })
      expect(createRes.success).toBe(false)
      if (!createRes.success) {
        expect(createRes.error.issues[0]?.message).toContain('read-only')
      }

      const updateRes = schema.partial().safeParse({ posts: badVal })
      expect(updateRes.success).toBe(false)
      if (!updateRes.success) {
        expect(updateRes.error.issues[0]?.message).toContain('read-only')
      }
    }
  })
})
