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
    expect(queryKeys.document('articles', 1, true, 'id')).toEqual([
      'document',
      'articles',
      '1',
      'draft',
      'id',
    ])
    expect(queryKeys.document('articles', 1, false, 'en')).toEqual([
      'document',
      'articles',
      '1',
      'published',
      'en',
    ])
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
    expect(queryKeys.global('settings', 'id')).toEqual(['globals', 'settings', 'id'])
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

  it('builds permissions, documentPermissions and globalPermissions query keys', () => {
    expect(queryKeys.permissions('/api', 'user-123')).toEqual([
      '_lontar_permissions',
      '/api',
      'user-123',
    ])
    expect(queryKeys.permissions('/api')).toEqual(['_lontar_permissions', '/api', 'anonymous'])
    expect(queryKeys.documentPermissions('/api', 'articles', 1, true)).toEqual([
      '_lontar_document_permissions',
      '/api',
      'articles',
      '1',
      'draft',
      'anonymous',
    ])
    expect(queryKeys.documentPermissions('/api', 'articles', 1, true, 'user-123')).toEqual([
      '_lontar_document_permissions',
      '/api',
      'articles',
      '1',
      'draft',
      'user-123',
    ])
    expect(queryKeys.documentPermissionsPrefix('/api', 'articles', 1)).toEqual([
      '_lontar_document_permissions',
      '/api',
      'articles',
      '1',
    ])
    expect(queryKeys.globalPermissions('/api', 'settings')).toEqual([
      '_lontar_global_permissions',
      '/api',
      'settings',
      'anonymous',
    ])
    expect(queryKeys.globalPermissions('/api', 'settings', 'user-123')).toEqual([
      '_lontar_global_permissions',
      '/api',
      'settings',
      'user-123',
    ])
    expect(queryKeys.globalPermissionsPrefix('/api', 'settings')).toEqual([
      '_lontar_global_permissions',
      '/api',
      'settings',
    ])
    expect(queryKeys.apiKeys('/api', 'user-123')).toEqual(['_lontar_api_keys', '/api', 'user-123'])
    expect(queryKeys.apiKeys('/api')).toEqual(['_lontar_api_keys', '/api', 'anonymous'])
  })
})
