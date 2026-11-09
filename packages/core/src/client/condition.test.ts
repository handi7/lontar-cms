import { describe, expect, it } from 'vitest'
import {
  evaluateFieldFilter,
  getValueByPath,
  matchesCondition,
  resolveConditionTarget,
  sanitizeConditionalFields,
} from './condition'
import type { ClientField } from './client-config'

describe('condition evaluator', () => {
  describe('getValueByPath', () => {
    it('retrieves top-level and nested properties', () => {
      const data = { a: 1, b: { c: 'hello', d: { e: true } } }
      expect(getValueByPath(data, 'a')).toBe(1)
      expect(getValueByPath(data, 'b.c')).toBe('hello')
      expect(getValueByPath(data, 'b.d.e')).toBe(true)
      expect(getValueByPath(data, 'b.unknown')).toBeUndefined()
      expect(getValueByPath(data, 'x.y.z')).toBeUndefined()
    })

    it('rejects forbidden prototype pollution keys', () => {
      const data = { a: 1 }
      expect(getValueByPath(data, '__proto__.polluted')).toBeUndefined()
      expect(getValueByPath(data, 'constructor.prototype')).toBeUndefined()
    })
  })

  describe('resolveConditionTarget', () => {
    const root = { status: 'draft', author: { id: 10 } }
    const sibling = { status: 'published', type: 'article' }

    it('resolves unqualified paths from sibling data when provided, or root data when sibling is omitted', () => {
      expect(resolveConditionTarget('status', root, sibling)).toBe('published')
      expect(resolveConditionTarget('type', root, sibling)).toBe('article')
      expect(resolveConditionTarget('status', root)).toBe('draft')
      expect(resolveConditionTarget('author.id', root)).toBe(10)
      // Unqualified paths do not fall back to root when siblingData is provided (ADR 0022)
      expect(resolveConditionTarget('author.id', root, sibling)).toBeUndefined()
    })

    it('resolves $root. paths from root data even when sibling data is provided', () => {
      expect(resolveConditionTarget('$root.status', root, sibling)).toBe('draft')
      expect(resolveConditionTarget('$root.author.id', root, sibling)).toBe(10)
    })
  })

  describe('evaluateFieldFilter', () => {
    it('evaluates primitive equality shorthand', () => {
      expect(evaluateFieldFilter('video', 'video')).toBe(true)
      expect(evaluateFieldFilter('video', 'audio')).toBe(false)
      expect(evaluateFieldFilter(100, 100)).toBe(true)
      expect(evaluateFieldFilter(100, 200)).toBe(false)
      expect(evaluateFieldFilter(true, true)).toBe(true)
      expect(evaluateFieldFilter(true, false)).toBe(false)
    })

    it('evaluates equals and not_equals', () => {
      expect(evaluateFieldFilter('video', { equals: 'video' })).toBe(true)
      expect(evaluateFieldFilter('video', { equals: 'audio' })).toBe(false)
      expect(evaluateFieldFilter('video', { not_equals: 'audio' })).toBe(true)
      expect(evaluateFieldFilter('video', { not_equals: 'video' })).toBe(false)
    })

    it('evaluates Date equality', () => {
      const date1 = new Date('2026-01-01T00:00:00.000Z')
      const date2 = new Date('2026-01-01T00:00:00.000Z')
      const date3 = new Date('2026-01-02T00:00:00.000Z')
      expect(evaluateFieldFilter(date1, { equals: date2 })).toBe(true)
      expect(evaluateFieldFilter(date1, { equals: '2026-01-01T00:00:00.000Z' })).toBe(true)
      expect(evaluateFieldFilter(date1, { equals: date3 })).toBe(false)
      expect(evaluateFieldFilter(date1, { not_equals: date3 })).toBe(true)
    })

    it('evaluates in operator', () => {
      expect(evaluateFieldFilter('video', { in: ['video', 'audio'] })).toBe(true)
      expect(evaluateFieldFilter('text', { in: ['video', 'audio'] })).toBe(false)
      expect(evaluateFieldFilter(42, { in: [1, 2, 42] })).toBe(true)
      expect(evaluateFieldFilter(99, { in: [1, 2, 42] })).toBe(false)
    })

    it('evaluates contains operator', () => {
      expect(evaluateFieldFilter('hello world', { contains: 'world' })).toBe(true)
      expect(evaluateFieldFilter('hello world', { contains: 'earth' })).toBe(false)
      expect(evaluateFieldFilter(['apple', 'banana'], { contains: 'apple' })).toBe(true)
      expect(evaluateFieldFilter(['apple', 'banana'], { contains: 'orange' })).toBe(false)
    })

    it('evaluates numeric comparisons', () => {
      expect(evaluateFieldFilter(10, { greater_than: 5 })).toBe(true)
      expect(evaluateFieldFilter(5, { greater_than: 10 })).toBe(false)
      expect(evaluateFieldFilter(5, { greater_than_equal: 5 })).toBe(true)
      expect(evaluateFieldFilter(4, { greater_than_equal: 5 })).toBe(false)

      expect(evaluateFieldFilter(3, { less_than: 5 })).toBe(true)
      expect(evaluateFieldFilter(5, { less_than: 3 })).toBe(false)
      expect(evaluateFieldFilter(5, { less_than_equal: 5 })).toBe(true)
      expect(evaluateFieldFilter(6, { less_than_equal: 5 })).toBe(false)
    })

    it('evaluates date comparisons', () => {
      expect(
        evaluateFieldFilter('2026-05-01', {
          greater_than: '2026-01-01',
          less_than: '2026-12-31',
        }),
      ).toBe(true)
      expect(
        evaluateFieldFilter('2027-01-01', {
          less_than: '2026-12-31',
        }),
      ).toBe(false)
    })

    it('evaluates exists operator', () => {
      // exists: true
      expect(evaluateFieldFilter('some text', { exists: true })).toBe(true)
      expect(evaluateFieldFilter(0, { exists: true })).toBe(true)
      expect(evaluateFieldFilter(false, { exists: true })).toBe(true)
      expect(evaluateFieldFilter('', { exists: true })).toBe(false)
      expect(evaluateFieldFilter(null, { exists: true })).toBe(false)
      expect(evaluateFieldFilter(undefined, { exists: true })).toBe(false)

      // exists: false
      expect(evaluateFieldFilter('', { exists: false })).toBe(true)
      expect(evaluateFieldFilter(null, { exists: false })).toBe(true)
      expect(evaluateFieldFilter(undefined, { exists: false })).toBe(true)
      expect(evaluateFieldFilter('hello', { exists: false })).toBe(false)
      expect(evaluateFieldFilter(0, { exists: false })).toBe(false)
    })
  })

  describe('matchesCondition', () => {
    it('returns true when condition is undefined or empty', () => {
      expect(matchesCondition(undefined, { foo: 'bar' })).toBe(true)
      expect(matchesCondition({}, { foo: 'bar' })).toBe(true)
    })

    it('evaluates single field conditions', () => {
      const data = { format: 'video', views: 150 }
      expect(matchesCondition({ format: { equals: 'video' } }, data)).toBe(true)
      expect(matchesCondition({ format: { equals: 'audio' } }, data)).toBe(false)
      expect(matchesCondition({ views: { greater_than: 100 } }, data)).toBe(true)
      expect(matchesCondition({ views: { less_than: 50 } }, data)).toBe(false)
    })

    it('evaluates multiple top-level condition keys as implicit AND', () => {
      const data = { format: 'video', isPublished: true }
      expect(
        matchesCondition(
          {
            format: { equals: 'video' },
            isPublished: { equals: true },
          },
          data,
        ),
      ).toBe(true)

      expect(
        matchesCondition(
          {
            format: { equals: 'video' },
            isPublished: { equals: false },
          },
          data,
        ),
      ).toBe(false)
    })

    it('evaluates explicit and compound logic', () => {
      const data = { type: 'quote', author: 'Mark Twain' }
      expect(
        matchesCondition(
          {
            and: [{ type: { equals: 'quote' } }, { author: { exists: true } }],
          },
          data,
        ),
      ).toBe(true)

      expect(
        matchesCondition(
          {
            and: [{ type: { equals: 'quote' } }, { author: { equals: 'Unknown' } }],
          },
          data,
        ),
      ).toBe(false)
    })

    it('evaluates explicit or compound logic', () => {
      const data = { role: 'editor' }
      expect(
        matchesCondition(
          {
            or: [{ role: { equals: 'admin' } }, { role: { equals: 'editor' } }],
          },
          data,
        ),
      ).toBe(true)

      expect(
        matchesCondition(
          {
            or: [{ role: { equals: 'admin' } }, { role: { equals: 'author' } }],
          },
          data,
        ),
      ).toBe(false)
    })

    it('evaluates sibling vs $root scoping', () => {
      const rootDoc = { status: 'published', defaultLayout: 'grid' }
      const itemRow = { layout: 'custom', enabled: true }

      // Unqualified 'layout' looks up sibling itemRow
      expect(matchesCondition({ layout: { equals: 'custom' } }, rootDoc, itemRow)).toBe(true)
      expect(matchesCondition({ layout: { equals: 'grid' } }, rootDoc, itemRow)).toBe(false)

      // $root.status looks up rootDoc
      expect(matchesCondition({ '$root.status': { equals: 'published' } }, rootDoc, itemRow)).toBe(
        true,
      )
      expect(matchesCondition({ '$root.status': { equals: 'draft' } }, rootDoc, itemRow)).toBe(
        false,
      )
    })
  })

  describe('sanitizeConditionalFields', () => {
    const fields: ClientField[] = [
      { name: 'format', type: 'select', label: 'Format', required: true, options: [] },
      {
        name: 'videoUrl',
        type: 'text',
        label: 'Video URL',
        required: true,
        condition: { format: { equals: 'video' } },
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
            required: false,
            condition: { enabled: { equals: true } },
          },
        ],
      },
      {
        name: 'gallery',
        type: 'array',
        label: 'Gallery',
        required: false,
        fields: [
          { name: 'type', type: 'select', label: 'Type', required: true, options: [] },
          {
            name: 'caption',
            type: 'text',
            label: 'Caption',
            required: false,
            condition: { type: { equals: 'photo' } },
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
              { name: 'hasButton', type: 'checkbox', label: 'Has Button', required: false },
              {
                name: 'buttonText',
                type: 'text',
                label: 'Button Text',
                required: false,
                condition: { hasButton: { equals: true } },
              },
            ],
          },
        ],
      },
    ]

    it('sets inactive top-level field to null', () => {
      const sanitized = sanitizeConditionalFields(fields, {
        format: 'standard',
        videoUrl: 'https://youtube.com/watch?v=123',
      })
      expect(sanitized.format).toBe('standard')
      expect(sanitized.videoUrl).toBeNull()
    })

    it('preserves active top-level field', () => {
      const sanitized = sanitizeConditionalFields(fields, {
        format: 'video',
        videoUrl: 'https://youtube.com/watch?v=123',
      })
      expect(sanitized.format).toBe('video')
      expect(sanitized.videoUrl).toBe('https://youtube.com/watch?v=123')
    })

    it('clears inactive top-level field on update when condition toggled to false', () => {
      const original = { format: 'video', videoUrl: 'https://youtube.com/watch?v=123' }
      const updateData = { format: 'standard' }
      const sanitized = sanitizeConditionalFields(fields, updateData, original)
      expect(sanitized.format).toBe('standard')
      expect(sanitized.videoUrl).toBeNull()
    })

    it('sets inactive group subfields to null', () => {
      const sanitized = sanitizeConditionalFields(fields, {
        seo: {
          enabled: false,
          keywords: 'cms, headless',
        },
      })
      expect(sanitized.seo).toEqual({
        enabled: false,
        keywords: null,
      })
    })

    it('strips inactive properties in array rows', () => {
      const sanitized = sanitizeConditionalFields(fields, {
        gallery: [
          { type: 'photo', caption: 'Sunset' },
          { type: 'video', caption: 'Ignored caption' },
        ],
      })
      expect(sanitized.gallery).toEqual([{ type: 'photo', caption: 'Sunset' }, { type: 'video' }])
    })

    it('strips inactive properties in blocks rows', () => {
      const sanitized = sanitizeConditionalFields(fields, {
        layout: [
          { blockType: 'hero', hasButton: true, buttonText: 'Click Me' },
          { blockType: 'hero', hasButton: false, buttonText: 'Do Not Show' },
        ],
      })
      expect(sanitized.layout).toEqual([
        { blockType: 'hero', hasButton: true, buttonText: 'Click Me' },
        { blockType: 'hero', hasButton: false },
      ])
    })
  })
})
