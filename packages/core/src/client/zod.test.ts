import { describe, expect, it } from 'vitest'
import { postsConfig } from '../__fixtures__/posts'
import { toClientConfig } from '../config/to-client-config'
import type { ClientNumberField, ClientTextField } from './client-config'
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
