import { describe, expect, it } from 'vitest'
import { queryKeys } from './query-keys'

describe('queryKeys factory (#233)', () => {
  it('builds canonical document query keys', () => {
    expect(queryKeys.document('articles', 1, true)).toEqual(['document', 'articles', '1', 'draft'])
    expect(queryKeys.document('articles', '1', false)).toEqual([
      'document',
      'articles',
      '1',
      'published',
    ])
    expect(queryKeys.document('articles', 42)).toEqual(['document', 'articles', '42', 'published'])
  })

  it('builds documentPrefix query key for invalidating any draft or published document queries', () => {
    expect(queryKeys.documentPrefix('articles', 1)).toEqual(['document', 'articles', '1'])
  })

  it('builds docVersions query key for lists and pagination', () => {
    expect(queryKeys.docVersions('/api', 'articles', 1)).toEqual([
      'doc-versions',
      '/api',
      'articles',
      '1',
    ])
    expect(queryKeys.docVersions('/api', 'articles', 1, 2)).toEqual([
      'doc-versions',
      '/api',
      'articles',
      '1',
      2,
    ])
  })

  it('builds global and globalVersions query keys', () => {
    expect(queryKeys.global('settings')).toEqual(['globals', 'settings'])
    expect(queryKeys.globalVersions('/api', 'settings')).toEqual([
      'global-versions',
      '/api',
      'settings',
    ])
    expect(queryKeys.globalVersions('/api', 'settings', 3)).toEqual([
      'global-versions',
      '/api',
      'settings',
      3,
    ])
  })
})
