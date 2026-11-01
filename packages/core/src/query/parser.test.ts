import { describe, expect, it } from 'vitest'
import { parseSort, parseWhere, parseWhereFromSearchParams } from './parser'

describe('parseSort', () => {
  it('parses single ascending field', () => {
    expect(parseSort('title')).toEqual([{ field: 'title', direction: 'asc' }])
  })

  it('parses single descending field', () => {
    expect(parseSort('-createdAt')).toEqual([{ field: 'createdAt', direction: 'desc' }])
  })

  it('parses explicit positive ascending field', () => {
    expect(parseSort('+title')).toEqual([{ field: 'title', direction: 'asc' }])
  })

  it('parses comma-separated multiple fields', () => {
    expect(parseSort('-publishedAt, title, -views')).toEqual([
      { field: 'publishedAt', direction: 'desc' },
      { field: 'title', direction: 'asc' },
      { field: 'views', direction: 'desc' },
    ])
  })

  it('handles array of sort values', () => {
    expect(parseSort(['-publishedAt', 'title'])).toEqual([
      { field: 'publishedAt', direction: 'desc' },
      { field: 'title', direction: 'asc' },
    ])
  })

  it('returns empty array on empty or undefined input', () => {
    expect(parseSort(undefined)).toEqual([])
    expect(parseSort('')).toEqual([])
    expect(parseSort(' , - , + ')).toEqual([])
  })
})

describe('parseWhere', () => {
  it('parses directly from iterable entries', () => {
    const entries: [string, string][] = [['where[title][contains]', 'hello']]
    expect(parseWhere(entries)).toEqual({
      title: { contains: 'hello' },
    })
  })

  it('parses simple equality operator from URLSearchParams', () => {
    const params = new URLSearchParams('where[status][equals]=published')
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      status: { equals: 'published' },
    })
  })

  it('parses multiple operators on different fields', () => {
    const params = new URLSearchParams(
      'where[status][equals]=published&where[views][greater_than]=10&where[views][less_than]=100',
    )
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      status: { equals: 'published' },
      views: {
        greater_than: '10',
        less_than: '100',
      },
    })
  })

  it('parses in operator with comma-separated string', () => {
    const params = new URLSearchParams('where[category][in]=tech,science')
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      category: { in: ['tech', 'science'] },
    })
  })

  it('parses in operator with array bracket syntax', () => {
    const params = new URLSearchParams('where[category][in][]=tech&where[category][in][]=science')
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      category: { in: ['tech', 'science'] },
    })
  })

  it('parses or clauses with index syntax', () => {
    const params = new URLSearchParams(
      'where[or][0][status][equals]=draft&where[or][1][status][equals]=archived',
    )
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      or: [{ status: { equals: 'draft' } }, { status: { equals: 'archived' } }],
    })
  })

  it('parses and clauses with index syntax', () => {
    const params = new URLSearchParams(
      'where[and][0][views][greater_than]=5&where[and][1][views][less_than]=50',
    )
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      and: [{ views: { greater_than: '5' } }, { views: { less_than: '50' } }],
    })
  })

  it('parses JSON string encoded where parameter', () => {
    const jsonStr = JSON.stringify({
      status: { equals: 'published' },
      views: { greater_than: 10 },
    })
    const params = new URLSearchParams({ where: jsonStr })
    const where = parseWhereFromSearchParams(params)
    expect(where).toEqual({
      status: { equals: 'published' },
      views: { greater_than: 10 },
    })
  })

  it('ignores non-where parameters', () => {
    const params = new URLSearchParams('page=2&limit=10&sort=-createdAt')
    const where = parseWhereFromSearchParams(params)
    expect(where).toBeUndefined()
  })
})
