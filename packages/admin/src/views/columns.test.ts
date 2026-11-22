import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientCollection } from '@lontar/core/client'
import {
  columnsStorageKey,
  defaultColumnKeys,
  readStoredColumns,
  resolveColumnKeys,
  selectableColumnKeys,
  writeStoredColumns,
} from './columns'

const posts = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'views'] },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'views', type: 'number' },
    { name: 'summary', type: 'textarea' },
    { name: 'body', type: 'richText' },
    { name: 'meta', type: 'group', fields: [] },
  ],
} as unknown as ClientCollection

describe('column selection (#461)', () => {
  it('offers defaults first, then other fields, then system columns, without unpickable types', () => {
    expect(selectableColumnKeys(posts)).toEqual([
      'title',
      'views',
      'summary',
      'id',
      'updatedAt',
      'createdAt',
    ])
  })

  it('leaves out fields the user cannot read', () => {
    const keys = selectableColumnKeys(posts, { views: { read: false } as never })
    expect(keys).not.toContain('views')
    expect(defaultColumnKeys(posts, { views: { read: false } as never })).toEqual(['title'])
  })

  it('uses the defaults when nothing is stored', () => {
    expect(resolveColumnKeys(posts, undefined, null)).toEqual(['title', 'views'])
  })

  it('orders a stored choice by the picker order, not by click order', () => {
    expect(resolveColumnKeys(posts, undefined, ['updatedAt', 'title', 'summary'])).toEqual([
      'title',
      'summary',
      'updatedAt',
    ])
  })

  it('ignores stored columns that no longer exist', () => {
    expect(resolveColumnKeys(posts, undefined, ['title', 'gone', 'meta.x'])).toEqual(['title'])
  })

  it('ignores stored columns the user can no longer read', () => {
    expect(
      resolveColumnKeys(posts, { summary: { read: false } as never }, ['title', 'summary']),
    ).toEqual(['title'])
  })

  it('always keeps the title column', () => {
    expect(resolveColumnKeys(posts, undefined, ['views'])).toEqual(['title', 'views'])
  })

  it('falls back to the defaults when nothing valid is left', () => {
    const hideTitle = { title: { read: false } as never }
    expect(resolveColumnKeys(posts, hideTitle, ['gone'])).toEqual(['views'])
  })

  it('scopes the storage key by user and collection', () => {
    expect(columnsStorageKey('u1', 'posts')).not.toBe(columnsStorageKey('u2', 'posts'))
    expect(columnsStorageKey('u1', 'posts')).not.toBe(columnsStorageKey('u1', 'pages'))
  })
})

describe('column storage (#461)', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a choice and removes it on reset', () => {
    writeStoredColumns('k', ['title', 'views'])
    expect(readStoredColumns('k')).toEqual(['title', 'views'])
    writeStoredColumns('k', null)
    expect(readStoredColumns('k')).toBeNull()
  })

  it('treats malformed stored values as no choice', () => {
    for (const bad of ['not json', '{"a":1}', '[1,2]', 'null']) {
      window.localStorage.setItem('k', bad)
      expect(readStoredColumns('k')).toBeNull()
    }
  })

  it('does not throw when localStorage does', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(readStoredColumns('k')).toBeNull()
    expect(() => writeStoredColumns('k', ['title'])).not.toThrow()
  })
})
