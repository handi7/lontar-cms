import { describe, expect, it } from 'vitest'
import {
  evaluateFieldFilter,
  extractConditionPaths,
  getValueByPath,
  matchesCondition,
  resolveConditionTarget,
  sanitizeConditionalFields,
  setValueByPath,
} from './condition'
import type { ClientField } from './client-config'

describe('condition evaluator', () => {
  describe('setValueByPath', () => {
    it('sets top-level and nested properties on empty objects', () => {
      const data: Record<string, unknown> = {}
      setValueByPath(data, 'status', 'published')
      setValueByPath(data, 'seo.title', 'My SEO Title')
      expect(data).toEqual({
        status: 'published',
        seo: { title: 'My SEO Title' },
      })
    })

    it('sets array index properties when path segment is numeric', () => {
      const data: Record<string, unknown> = {}
      setValueByPath(data, 'items.0.name', 'Item 1')
      setValueByPath(data, 'items.1.name', 'Item 2')
      expect(data).toEqual({
        items: [{ name: 'Item 1' }, { name: 'Item 2' }],
      })
    })

    it('preserves existing properties in target objects', () => {
      const data: Record<string, unknown> = {
        title: 'Original Title',
        author: { name: 'Alice' },
      }
      setValueByPath(data, 'author.email', 'alice@example.com')
      expect(data).toEqual({
        title: 'Original Title',
        author: { name: 'Alice', email: 'alice@example.com' },
      })
    })

    it('rejects forbidden prototype pollution keys', () => {
      const data: Record<string, unknown> = {}
      setValueByPath(data, '__proto__.polluted', true)
      setValueByPath(data, 'constructor.prototype.polluted', true)
      expect(data).toEqual({})
      expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined()
    })
  })

  describe('extractConditionPaths (#177)', () => {
    it('returns empty array for undefined, null, or empty condition', () => {
      expect(extractConditionPaths(undefined)).toEqual([])
      expect(extractConditionPaths({})).toEqual([])
    })

    it('extracts top-level condition field paths', () => {
      expect(extractConditionPaths({ format: { equals: 'video' } })).toEqual(['format'])
      expect(extractConditionPaths({ format: 'video' })).toEqual(['format'])
    })

    it('resolves sibling paths with pathPrefix and leaves $root. paths at root level', () => {
      expect(extractConditionPaths({ format: { equals: 'video' } }, 'items.0')).toEqual([
        'items.0.format',
      ])
      expect(extractConditionPaths({ '$root.status': { equals: 'published' } }, 'items.0')).toEqual(
        ['status'],
      )
      expect(
        extractConditionPaths({ '$root.author.role': { equals: 'admin' } }, 'layout.2'),
      ).toEqual(['author.role'])
    })

    it('extracts paths recursively from compound and/or conditions and deduplicates', () => {
      const compound = {
        and: [
          { format: { equals: 'video' } },
          {
            or: [
              { duration: { greater_than: 60 } },
              { format: { equals: 'long-video' } },
              { '$root.status': { equals: 'published' } },
            ],
          },
        ],
      }
      expect(extractConditionPaths(compound, 'gallery.1')).toEqual([
        'gallery.1.format',
        'gallery.1.duration',
        'status',
      ])
    })

    it('ignores forbidden keys in condition paths', () => {
      expect(
        extractConditionPaths({
          __proto__: { equals: 'bad' },
          '$root.__proto__': { equals: 'bad' },
          'constructor.prototype': { equals: 'bad' },
          valid: { equals: true },
        }),
      ).toEqual(['valid'])
    })
  })

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

    it('sanitizes group -> array nested conditional fields (#175)', () => {
      const nestedFields: ClientField[] = [
        {
          name: 'settings',
          type: 'group',
          label: 'Settings',
          required: false,
          fields: [
            { name: 'mode', type: 'text', label: 'Mode', required: false },
            {
              name: 'items',
              type: 'array',
              label: 'Items',
              required: false,
              fields: [
                { name: 'kind', type: 'select', label: 'Kind', required: true, options: [] },
                {
                  name: 'url',
                  type: 'text',
                  label: 'URL',
                  required: false,
                  condition: { kind: { equals: 'link' } },
                },
              ],
            },
          ],
        },
      ]

      const sanitized = sanitizeConditionalFields(nestedFields, {
        settings: {
          mode: 'a',
          items: [
            { id: 'r1', kind: 'text', url: 'http://zombie' },
            { id: 'r2', kind: 'link', url: 'https://example.com' },
          ],
        },
      })

      expect(sanitized.settings).toEqual({
        mode: 'a',
        items: [
          { id: 'r1', kind: 'text' },
          { id: 'r2', kind: 'link', url: 'https://example.com' },
        ],
      })
    })

    it('sanitizes array -> group nested conditional fields (#175)', () => {
      const nestedFields: ClientField[] = [
        {
          name: 'items',
          type: 'array',
          label: 'Items',
          required: false,
          fields: [
            {
              name: 'meta',
              type: 'group',
              label: 'Meta',
              required: false,
              fields: [
                { name: 'featured', type: 'checkbox', label: 'Featured', required: false },
                {
                  name: 'badge',
                  type: 'text',
                  label: 'Badge',
                  required: false,
                  condition: { featured: { equals: true } },
                },
              ],
            },
          ],
        },
      ]

      const sanitized = sanitizeConditionalFields(nestedFields, {
        items: [
          { id: 'r1', meta: { featured: false, badge: 'Zombie' } },
          { id: 'r2', meta: { featured: true, badge: 'Active' } },
        ],
      })

      expect(sanitized.items).toEqual([
        { id: 'r1', meta: { featured: false, badge: null } },
        { id: 'r2', meta: { featured: true, badge: 'Active' } },
      ])
    })

    it('sanitizes blocks -> group nested conditional fields (#175)', () => {
      const nestedFields: ClientField[] = [
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
                  name: 'cta',
                  type: 'group',
                  label: 'CTA',
                  required: false,
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
          ],
        },
      ]

      const sanitized = sanitizeConditionalFields(nestedFields, {
        layout: [
          { blockType: 'hero', id: 'b1', cta: { hasButton: false, buttonText: 'Hidden' } },
          { blockType: 'hero', id: 'b2', cta: { hasButton: true, buttonText: 'Shown' } },
        ],
      })

      expect(sanitized.layout).toEqual([
        { blockType: 'hero', id: 'b1', cta: { hasButton: false, buttonText: null } },
        { blockType: 'hero', id: 'b2', cta: { hasButton: true, buttonText: 'Shown' } },
      ])
    })

    it('sanitizes array -> array nested conditional fields (#175)', () => {
      const nestedFields: ClientField[] = [
        {
          name: 'tables',
          type: 'array',
          label: 'Tables',
          required: false,
          fields: [
            {
              name: 'columns',
              type: 'array',
              label: 'Columns',
              required: false,
              fields: [
                { name: 'sortable', type: 'checkbox', label: 'Sortable', required: false },
                {
                  name: 'direction',
                  type: 'text',
                  label: 'Direction',
                  required: false,
                  condition: { sortable: { equals: true } },
                },
              ],
            },
          ],
        },
      ]

      const sanitized = sanitizeConditionalFields(nestedFields, {
        tables: [
          {
            id: 't1',
            columns: [
              { id: 'c1', sortable: false, direction: 'asc' },
              { id: 'c2', sortable: true, direction: 'desc' },
            ],
          },
        ],
      })

      expect(sanitized.tables).toEqual([
        {
          id: 't1',
          columns: [
            { id: 'c1', sortable: false },
            { id: 'c2', sortable: true, direction: 'desc' },
          ],
        },
      ])
    })

    it('sanitizes group -> blocks nested conditional fields (#175)', () => {
      const nestedFields: ClientField[] = [
        {
          name: 'page',
          type: 'group',
          label: 'Page',
          required: false,
          fields: [
            {
              name: 'sections',
              type: 'blocks',
              label: 'Sections',
              required: false,
              blocks: [
                {
                  slug: 'banner',
                  labels: { singular: 'Banner', plural: 'Banners' },
                  fields: [
                    {
                      name: 'dismissible',
                      type: 'checkbox',
                      label: 'Dismissible',
                      required: false,
                    },
                    {
                      name: 'storageKey',
                      type: 'text',
                      label: 'Storage Key',
                      required: false,
                      condition: { dismissible: { equals: true } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]

      const sanitized = sanitizeConditionalFields(nestedFields, {
        page: {
          sections: [
            { blockType: 'banner', id: 's1', dismissible: false, storageKey: 'cookie-banner' },
            { blockType: 'banner', id: 's2', dismissible: true, storageKey: 'promo-banner' },
          ],
        },
      })

      expect(sanitized.page).toEqual({
        sections: [
          { blockType: 'banner', id: 's1', dismissible: false },
          { blockType: 'banner', id: 's2', dismissible: true, storageKey: 'promo-banner' },
        ],
      })
    })

    it('sanitizes nested fields referencing $root conditions (#175)', () => {
      const nestedFields: ClientField[] = [
        { name: 'showAdvanced', type: 'checkbox', label: 'Show Advanced', required: false },
        {
          name: 'settings',
          type: 'group',
          label: 'Settings',
          required: false,
          fields: [
            {
              name: 'items',
              type: 'array',
              label: 'Items',
              required: false,
              fields: [
                { name: 'label', type: 'text', label: 'Label', required: true },
                {
                  name: 'advancedConfig',
                  type: 'text',
                  label: 'Advanced Config',
                  required: false,
                  condition: { '$root.showAdvanced': { equals: true } },
                },
              ],
            },
          ],
        },
      ]

      const hidden = sanitizeConditionalFields(nestedFields, {
        showAdvanced: false,
        settings: {
          items: [{ id: 'i1', label: 'Item 1', advancedConfig: 'secret-val' }],
        },
      })
      expect(hidden.settings).toEqual({
        items: [{ id: 'i1', label: 'Item 1' }],
      })

      const visible = sanitizeConditionalFields(nestedFields, {
        showAdvanced: true,
        settings: {
          items: [{ id: 'i1', label: 'Item 1', advancedConfig: 'secret-val' }],
        },
      })
      expect(visible.settings).toEqual({
        items: [{ id: 'i1', label: 'Item 1', advancedConfig: 'secret-val' }],
      })
    })
  })
})
