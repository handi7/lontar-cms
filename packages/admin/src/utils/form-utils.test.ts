import { describe, expect, it } from 'vitest'
import type { ClientField } from '@lontar/core/client'
import {
  computeDefaultValues,
  formatDateForInput,
  formatDateForSubmit,
  formatDocForForm,
  formatDocForSubmit,
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
  })
})
