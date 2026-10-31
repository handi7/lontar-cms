import { describe, expect, it } from 'vitest'
import { postsConfig } from '../__fixtures__/posts'
import { toClientConfig } from '../config/to-client-config'
import type {
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientNumberField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
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
