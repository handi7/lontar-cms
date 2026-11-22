import { describe, expect, it } from 'vitest'
import type { ClientCollection } from '@lontar/core/client'
import { formatSortParam, parseListSearch, resolveListState, toFilterParams } from './listSearch'

const posts: ClientCollection = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  admin: { useAsTitle: 'title', defaultColumns: ['title'] },
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    {
      name: 'meta',
      type: 'group',
      fields: [{ name: 'views', label: 'Views', type: 'number', required: false }],
    },
  ],
} as ClientCollection

const withDrafts = { ...posts, versions: { drafts: true } } as ClientCollection

describe('parseListSearch (#214)', () => {
  it('keeps well-formed values', () => {
    expect(
      parseListSearch({
        locale: 'id',
        page: 3,
        q: 'hello',
        status: 'draft',
        sort: '-title',
        filters: [{ field: 'title', operator: 'equals', value: 'x' }],
      }),
    ).toEqual({
      locale: 'id',
      page: 3,
      q: 'hello',
      status: 'draft',
      sort: '-title',
      filters: [{ field: 'title', operator: 'equals', value: 'x' }],
    })
  })

  it('drops malformed values instead of throwing', () => {
    expect(
      parseListSearch({
        page: 'abc',
        q: { nested: true },
        status: 'archived',
        sort: 42,
        filters: 'nope',
        unknown: 1,
      }),
    ).toEqual({
      locale: undefined,
      page: undefined,
      q: undefined,
      status: undefined,
      sort: '42',
      filters: undefined,
    })
  })

  it('rejects non-positive and fractional pages, accepts numeric strings', () => {
    expect(parseListSearch({ page: 0 }).page).toBeUndefined()
    expect(parseListSearch({ page: -2 }).page).toBeUndefined()
    expect(parseListSearch({ page: 1.5 }).page).toBeUndefined()
    expect(parseListSearch({ page: '4' }).page).toBe(4)
  })

  it('reads a numeric query the router already parsed as a number', () => {
    expect(parseListSearch({ q: 123 }).q).toBe('123')
  })

  it('skips malformed filter entries and keeps the valid ones', () => {
    const { filters } = parseListSearch({
      filters: [
        null,
        { field: 'title' },
        { field: 'title', operator: 'equals', value: 7 },
        { field: 5, operator: 'equals', value: 'x' },
      ],
    })
    expect(filters).toEqual([{ field: 'title', operator: 'equals', value: '7' }])
  })
})

describe('resolveListState (#214)', () => {
  it('returns defaults for an empty URL', () => {
    expect(resolveListState({}, posts)).toEqual({
      page: 1,
      searchTerm: '',
      statusFilter: 'all',
      sorting: [],
      filters: [],
    })
  })

  it('drops filters on unknown fields or operators and empty values', () => {
    const state = resolveListState(
      {
        filters: [
          { field: 'title', operator: 'contains', value: 'a' },
          { field: 'nope', operator: 'contains', value: 'a' },
          { field: 'title', operator: 'drop_table', value: 'a' },
          { field: 'title', operator: 'equals', value: '' },
          { field: 'meta.views', operator: 'greater_than', value: '5' },
        ],
      },
      posts,
    )
    expect(state.filters.map((f) => [f.field, f.operator])).toEqual([
      ['title', 'contains'],
      ['meta.views', 'greater_than'],
    ])
  })

  it('gives filters distinct, stable ids', () => {
    const params = {
      filters: [
        { field: 'title', operator: 'equals', value: 'a' },
        { field: 'title', operator: 'equals', value: 'b' },
      ],
    }
    const ids = resolveListState(params, posts).filters.map((f) => f.id)
    expect(new Set(ids).size).toBe(2)
    expect(resolveListState(params, posts).filters.map((f) => f.id)).toEqual(ids)
  })

  it('ignores a status filter on a collection without drafts', () => {
    expect(resolveListState({ status: 'draft' }, posts).statusFilter).toBe('all')
    expect(resolveListState({ status: 'draft' }, withDrafts).statusFilter).toBe('draft')
  })

  it('keeps known sort columns and drops the rest', () => {
    const state = resolveListState({ sort: '-title,bogus,title,updatedAt' }, posts)
    expect(state.sorting).toEqual([
      { id: 'title', desc: true },
      { id: 'updatedAt', desc: false },
    ])
  })

  it('hides a filter on a field the caller cannot read', () => {
    const state = resolveListState(
      { filters: [{ field: 'title', operator: 'equals', value: 'a' }] },
      posts,
      { title: { read: false } as never },
    )
    expect(state.filters).toEqual([])
  })
})

describe('serialize round-trip (#214)', () => {
  it('survives sort and filters going out and coming back', () => {
    const sort = formatSortParam([
      { id: 'title', desc: true },
      { id: 'id', desc: false },
    ])
    expect(sort).toBe('-title,id')

    const filters = toFilterParams([{ id: 'x', field: 'title', operator: 'in', value: 'a,b' }])
    const state = resolveListState(parseListSearch({ page: 2, q: 'x', sort, filters }), posts)
    expect(state.page).toBe(2)
    expect(state.searchTerm).toBe('x')
    expect(formatSortParam(state.sorting)).toBe(sort)
    expect(toFilterParams(state.filters)).toEqual(filters)
  })

  it('omits empty values', () => {
    expect(formatSortParam([])).toBeUndefined()
    expect(toFilterParams([])).toBeUndefined()
  })
})

describe('mime group in the URL (#462)', () => {
  const media = { ...posts, upload: true } as ClientCollection

  it('keeps a known group and drops anything else', () => {
    expect(parseListSearch({ mime: 'images' }).mime).toBe('images')
    expect(parseListSearch({ mime: 'pictures' }).mime).toBeUndefined()
  })

  it('applies only to an upload collection', () => {
    expect(resolveListState({ mime: 'video' }, media).mimeGroup).toBe('video')
    expect(resolveListState({ mime: 'video' }, posts).mimeGroup).toBeUndefined()
  })
})
