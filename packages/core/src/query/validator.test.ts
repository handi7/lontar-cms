import { describe, expect, it } from 'vitest'
import type { CollectionConfig } from '../config/types'
import { getTopKey, validateSort, validateWhere } from './validator'

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

const complexCollection: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  fields: {
    title: { type: 'text', required: true },
    body: { type: 'richText' },
    seo: {
      type: 'group',
      fields: {
        metaTitle: { type: 'text' },
        metaDescription: { type: 'textarea' },
      },
    },
    gallery: {
      type: 'array',
      fields: {
        caption: { type: 'text' },
        likes: { type: 'number' },
      },
    },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text' },
          },
        },
        {
          slug: 'cta',
          labels: { singular: 'CTA', plural: 'CTAs' },
          fields: {
            buttonText: { type: 'text' },
          },
        },
      ],
    },
  },
}

const jsonCollection: CollectionConfig = {
  slug: 'snippets',
  labels: { singular: 'Snippet', plural: 'Snippets' },
  fields: {
    title: { type: 'text', required: true },
    metadata: { type: 'json' },
  },
}

const pointCollection: CollectionConfig = {
  slug: 'places',
  labels: { singular: 'Place', plural: 'Places' },
  fields: {
    name: { type: 'text', required: true },
    location: { type: 'point' },
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

  it('validates group fields with dot and nested object notation', () => {
    const dotIssues = validateWhere(
      {
        'seo.metaTitle': { equals: 'Hello' },
      },
      complexCollection,
    )
    expect(dotIssues).toEqual([])

    const nestedIssues = validateWhere(
      {
        seo: {
          metaDescription: { contains: 'world' },
        },
      },
      complexCollection,
    )
    expect(nestedIssues).toEqual([])
  })

  it('validates array subfields with dot and nested object notation', () => {
    const dotIssues = validateWhere(
      {
        'gallery.caption': { contains: 'sunset' },
        'gallery.id': { equals: 'abc123' },
      },
      complexCollection,
    )
    expect(dotIssues).toEqual([])

    const nestedIssues = validateWhere(
      {
        gallery: {
          caption: { equals: 'beach' },
        },
      },
      complexCollection,
    )
    expect(nestedIssues).toEqual([])
  })

  it('validates blocks subfields across declared blocks', () => {
    const dotIssues = validateWhere(
      {
        'layout.heading': { contains: 'Welcome' },
        'layout.buttonText': { equals: 'Click me' },
        'layout.blockType': { equals: 'hero' },
        'layout.id': { equals: 'xyz789' },
      },
      complexCollection,
    )
    expect(dotIssues).toEqual([])

    const nestedIssues = validateWhere(
      {
        layout: {
          heading: { equals: 'Hi' },
        },
      },
      complexCollection,
    )
    expect(nestedIssues).toEqual([])
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

  it('reports error for unknown nested paths in group, array, and blocks', () => {
    const issues = validateWhere(
      {
        'seo.unknown': { equals: 'bad' },
        'gallery.unknown': { equals: 'bad' },
        'layout.unknown': { equals: 'bad' },
      },
      complexCollection,
    )
    expect(issues).toEqual([
      {
        path: 'seo.unknown',
        message: 'Unknown field "seo.unknown"',
      },
      {
        path: 'gallery.unknown',
        message: 'Unknown field "gallery.unknown"',
      },
      {
        path: 'layout.unknown',
        message: 'Unknown field "layout.unknown"',
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

  it('validates json fields: only nullability allowed, rejects nested paths and non-null ops', () => {
    expect(validateWhere({ metadata: null }, jsonCollection)).toEqual([])
    expect(validateWhere({ metadata: { equals: null } }, jsonCollection)).toEqual([])
    expect(validateWhere({ metadata: { not_equals: null } }, jsonCollection)).toEqual([])

    expect(validateWhere({ metadata: { equals: 'bad' } }, jsonCollection)).toEqual([
      {
        path: 'metadata.equals',
        message: 'Operator "equals" on json field "metadata" only supports null',
      },
    ])
    expect(validateWhere({ metadata: { contains: 'text' } }, jsonCollection)).toEqual([
      {
        path: 'metadata.contains',
        message: 'Operator "contains" is not supported on json field "metadata"',
      },
    ])
    expect(validateWhere({ 'metadata.nestedKey': { equals: 123 } }, jsonCollection)).toEqual([
      {
        path: 'metadata.nestedKey',
        message: 'Unknown field "metadata.nestedKey"',
      },
    ])
  })

  it('validates point fields: nullability on top-level, dot notation for coordinates, rejects unknown subpaths', () => {
    expect(validateWhere({ location: null }, pointCollection)).toEqual([])
    expect(validateWhere({ location: { equals: null } }, pointCollection)).toEqual([])
    expect(validateWhere({ location: { not_equals: null } }, pointCollection)).toEqual([])
    expect(validateWhere({ 'location.lng': { greater_than: 100 } }, pointCollection)).toEqual([])
    expect(validateWhere({ 'location.lat': { less_than: 0 } }, pointCollection)).toEqual([])
    expect(validateWhere({ 'location.longitude': { equals: 106.8456 } }, pointCollection)).toEqual(
      [],
    )
    expect(validateWhere({ 'location.latitude': { equals: -6.2088 } }, pointCollection)).toEqual([])

    expect(validateWhere({ location: { equals: [100, 20] } }, pointCollection)).toEqual([
      {
        path: 'location.equals',
        message: 'Operator "equals" on point field "location" only supports null',
      },
    ])
    expect(validateWhere({ 'location.unknown': { equals: 123 } }, pointCollection)).toEqual([
      {
        path: 'location.unknown',
        message: 'Unknown field "location.unknown"',
      },
    ])
  })
})

describe('validateSort', () => {
  it('returns empty array when sort is undefined or empty', () => {
    expect(validateSort(undefined, testCollection)).toEqual([])
    expect(validateSort('', testCollection)).toEqual([])
    expect(validateSort([], testCollection)).toEqual([])
  })

  it('validates point field sort paths', () => {
    expect(validateSort('location.lng', pointCollection)).toEqual([])
    expect(validateSort('-location.lat', pointCollection)).toEqual([])
    expect(validateSort('location.longitude', pointCollection)).toEqual([])
  })

  it('validates scalar and system fields', () => {
    expect(validateSort('title', testCollection)).toEqual([])
    expect(validateSort('-title', testCollection)).toEqual([])
    expect(validateSort('+title', testCollection)).toEqual([])
    expect(validateSort('createdAt', testCollection)).toEqual([])
    expect(validateSort('-updatedAt', testCollection)).toEqual([])
    expect(validateSort('id', testCollection)).toEqual([])
  })

  it('validates group subfields', () => {
    expect(validateSort('seo.metaTitle', complexCollection)).toEqual([])
    expect(validateSort('-seo.metaTitle', complexCollection)).toEqual([])
    expect(validateSort('seo__metaTitle', complexCollection)).toEqual([])
  })

  it('rejects sorting on container fields directly', () => {
    expect(validateSort('seo', complexCollection)).toEqual([
      {
        path: 'seo',
        message: 'Cannot sort on container field "seo"',
      },
    ])
    expect(validateSort('gallery', complexCollection)).toEqual([
      {
        path: 'gallery',
        message: 'Sorting on array or blocks field "gallery" is not supported',
      },
    ])
    expect(validateSort('layout', complexCollection)).toEqual([
      {
        path: 'layout',
        message: 'Sorting on array or blocks field "layout" is not supported',
      },
    ])
  })

  it('rejects sorting on array subfields', () => {
    expect(validateSort('gallery.caption', complexCollection)).toEqual([
      {
        path: 'gallery.caption',
        message: 'Sorting on array or blocks field "gallery.caption" is not supported',
      },
    ])
    expect(validateSort('-gallery.likes', complexCollection)).toEqual([
      {
        path: 'gallery.likes',
        message: 'Sorting on array or blocks field "gallery.likes" is not supported',
      },
    ])
  })

  it('rejects sorting on blocks subfields', () => {
    expect(validateSort('layout.heading', complexCollection)).toEqual([
      {
        path: 'layout.heading',
        message: 'Sorting on array or blocks field "layout.heading" is not supported',
      },
    ])
    expect(validateSort('-layout.buttonText', complexCollection)).toEqual([
      {
        path: 'layout.buttonText',
        message: 'Sorting on array or blocks field "layout.buttonText" is not supported',
      },
    ])
  })

  it('rejects sorting on richText fields', () => {
    expect(validateSort('body', complexCollection)).toEqual([
      {
        path: 'body',
        message: 'Cannot sort on field "body" of type "richText"',
      },
    ])
  })

  it('rejects sorting on unknown fields and unknown group subfields', () => {
    expect(validateSort('unknownField', complexCollection)).toEqual([
      {
        path: 'unknownField',
        message: 'Unknown field "unknownField"',
      },
    ])
    expect(validateSort('seo.unknown', complexCollection)).toEqual([
      {
        path: 'seo.unknown',
        message: 'Unknown field "seo.unknown"',
      },
    ])
  })

  it('handles multiple sort items in comma-separated string or array', () => {
    const issues = validateSort(
      '-title, gallery.caption, seo.metaTitle, unknown',
      complexCollection,
    )
    expect(issues).toEqual([
      {
        path: 'gallery.caption',
        message: 'Sorting on array or blocks field "gallery.caption" is not supported',
      },
      {
        path: 'unknown',
        message: 'Unknown field "unknown"',
      },
    ])
  })

  it('allows sorting on underscore-containing groups when sibling array field exists (#178)', () => {
    const colWithUnderscores: CollectionConfig = {
      slug: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      fields: {
        title: { type: 'text' },
        author: {
          type: 'array',
          fields: { name: { type: 'text' } },
        },
        author_info: {
          type: 'group',
          fields: {
            name: { type: 'text' },
            bio_text: { type: 'text' },
          },
        },
      },
    }

    // Sorting by author_info__name or author_info.name should pass and not be confused with author
    expect(validateSort('author_info__name', colWithUnderscores)).toEqual([])
    expect(validateSort('-author_info__name', colWithUnderscores)).toEqual([])
    expect(validateSort('author_info.name', colWithUnderscores)).toEqual([])
    expect(validateSort('author_info__bio_text', colWithUnderscores)).toEqual([])

    // Sorting by the array field author should still be correctly rejected
    expect(validateSort('author.name', colWithUnderscores)).toEqual([
      {
        path: 'author.name',
        message: 'Sorting on array or blocks field "author.name" is not supported',
      },
    ])
    expect(validateSort('author__name', colWithUnderscores)).toEqual([
      {
        path: 'author__name',
        message: 'Sorting on array or blocks field "author__name" is not supported',
      },
    ])
  })

  it('rejects sorting on json fields (ADR 0031)', () => {
    expect(validateSort('metadata', jsonCollection)).toEqual([
      {
        path: 'metadata',
        message: 'Cannot sort on field "metadata" of type "json"',
      },
    ])
    expect(validateSort('-metadata', jsonCollection)).toEqual([
      {
        path: 'metadata',
        message: 'Cannot sort on field "metadata" of type "json"',
      },
    ])
  })

  it('rejects sorting on hasMany scalar fields (ADR 0031)', () => {
    const hasManyCol: CollectionConfig = {
      slug: 'items',
      fields: {
        tags: { type: 'text', hasMany: true },
        scores: { type: 'number', hasMany: true },
      },
    }
    expect(validateSort('tags', hasManyCol)).toEqual([
      {
        path: 'tags',
        message: 'Cannot sort on field "tags" with hasMany: true',
      },
    ])
    expect(validateSort('scores', hasManyCol)).toEqual([
      {
        path: 'scores',
        message: 'Cannot sort on field "scores" with hasMany: true',
      },
    ])
  })
})

describe('getTopKey', () => {
  it('returns field name when no delimiter is present', () => {
    expect(getTopKey('title')).toBe('title')
    expect(getTopKey('author_info')).toBe('author_info')
    expect(getTopKey('')).toBe('')
  })

  it('splits on dot delimiter', () => {
    expect(getTopKey('author_info.name')).toBe('author_info')
    expect(getTopKey('author.name')).toBe('author')
  })

  it('splits on double underscore delimiter without cutting single underscores', () => {
    expect(getTopKey('author_info__name')).toBe('author_info')
    expect(getTopKey('user_profile_data__display_name')).toBe('user_profile_data')
  })

  it('splits on whichever delimiter occurs first', () => {
    expect(getTopKey('author_info.sub__field')).toBe('author_info')
    expect(getTopKey('author_info__sub.field')).toBe('author_info')
  })
})

describe('validateWhere and validateSort with layout fields (tabs, row, collapsible)', () => {
  const layoutCol: CollectionConfig = {
    slug: 'layout-posts',
    fields: {
      content: {
        type: 'tabs',
        tabs: [
          {
            label: 'General',
            fields: {
              titleRow: {
                type: 'row',
                fields: {
                  title: { type: 'text', required: true },
                  rating: { type: 'number' },
                },
              },
            },
          },
          {
            label: 'Meta',
            fields: {
              metaCollapsible: {
                type: 'collapsible',
                label: 'SEO',
                fields: {
                  metaTitle: { type: 'text' },
                },
              },
            },
          },
        ],
      },
    },
  }

  it('allows where queries and sorting on child fields inside layout containers', () => {
    expect(
      validateWhere(
        {
          title: { equals: 'Hello' },
          rating: { greater_than: 5 },
          metaTitle: { contains: 'Search' },
        },
        layoutCol,
      ),
    ).toEqual([])

    expect(validateSort('title', layoutCol)).toEqual([])
    expect(validateSort('-rating', layoutCol)).toEqual([])
    expect(validateSort('metaTitle', layoutCol)).toEqual([])
  })

  it('rejects where queries and sorting on layout container keys', () => {
    expect(validateWhere({ content: { equals: 'anything' } }, layoutCol)).toEqual([
      {
        path: 'content',
        message: 'Unknown field "content"',
      },
    ])
    expect(validateWhere({ titleRow: { equals: 'anything' } }, layoutCol)).toEqual([
      {
        path: 'titleRow',
        message: 'Unknown field "titleRow"',
      },
    ])
    expect(validateWhere({ metaCollapsible: { equals: 'anything' } }, layoutCol)).toEqual([
      {
        path: 'metaCollapsible',
        message: 'Unknown field "metaCollapsible"',
      },
    ])

    expect(validateSort('content', layoutCol)).toEqual([
      {
        path: 'content',
        message: 'Unknown field "content"',
      },
    ])
  })
})
