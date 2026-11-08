import { describe, expect, it } from 'vitest'
import type { CollectionConfig } from '../config/types'
import { validateWhere } from './validator'

const testCollection: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: {
    title: { type: 'text', required: true },
    views: { type: 'number' },
    status: { type: 'select', options: ['draft', 'published'] },
    categories: { type: 'relationship', relationTo: 'categories', hasMany: true },
  },
}

const uploadCollection: CollectionConfig = {
  slug: 'media',
  upload: true,
  fields: {
    alt: { type: 'text' },
  },
}

describe('validateWhere', () => {
  it('returns empty array when where is undefined or empty', () => {
    expect(validateWhere(undefined, testCollection)).toEqual([])
    expect(validateWhere({}, testCollection)).toEqual([])
  })

  it('validates configured fields with valid operators', () => {
    const issues = validateWhere(
      {
        title: { equals: 'Hello' },
        views: { greater_than: 10, less_than: 100 },
        status: 'published',
        categories: { equals: 1 },
      },
      testCollection,
    )
    expect(issues).toEqual([])
  })

  it('validates system fields (id, createdAt, updatedAt)', () => {
    const issues = validateWhere(
      {
        id: { equals: 5 },
        createdAt: { greater_than: '2026-01-01T00:00:00.000Z' },
        updatedAt: { less_than: '2026-12-31T23:59:59.000Z' },
      },
      testCollection,
    )
    expect(issues).toEqual([])
  })

  it('validates upload system fields when upload is enabled', () => {
    const issues = validateWhere(
      {
        filename: { equals: 'photo.jpg' },
        mimeType: { equals: 'image/jpeg' },
        filesize: { less_than: 1000000 },
        width: { greater_than: 500 },
        alt: { contains: 'landscape' },
      },
      uploadCollection,
    )
    expect(issues).toEqual([])
  })

  it('reports error for unknown fields', () => {
    const issues = validateWhere(
      {
        titel: { equals: 'Hello' },
      },
      testCollection,
    )
    expect(issues).toEqual([
      {
        path: 'titel',
        message: 'Unknown field "titel"',
      },
    ])
  })

  it('reports error for unknown operators', () => {
    const issues = validateWhere(
      {
        title: { eqauls: 'Hello' } as unknown as { equals: string },
      },
      testCollection,
    )
    expect(issues).toEqual([
      {
        path: 'title.eqauls',
        message: 'Unknown operator "eqauls"',
      },
    ])
  })

  it('validates nested and/or logical groups', () => {
    const issues = validateWhere(
      {
        or: [
          { title: { contains: 'news' } },
          {
            and: [{ status: { equals: 'published' } }, { views: { greater_than_equal: 100 } }],
          },
        ],
      },
      testCollection,
    )
    expect(issues).toEqual([])
  })

  it('reports errors inside nested logical groups', () => {
    const issues = validateWhere(
      {
        or: [
          { titel: { equals: 'bad' } },
          {
            and: [{ views: { unknown_op: 5 } }],
          },
        ],
      },
      testCollection,
    )
    expect(issues).toEqual([
      {
        path: 'or[0].titel',
        message: 'Unknown field "titel"',
      },
      {
        path: 'or[1].and[0].views.unknown_op',
        message: 'Unknown operator "unknown_op"',
      },
    ])
  })

  it('reports error if and/or is not an array', () => {
    const issues = validateWhere(
      {
        or: 'not-an-array' as unknown as [],
      },
      testCollection,
    )
    expect(issues).toEqual([
      {
        path: 'or',
        message: 'Expected array for "or" condition',
      },
    ])
  })
})
