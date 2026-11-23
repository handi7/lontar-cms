import { describe, expect, it } from 'vitest'
import type { Endpoint } from './types'
import { validateActions } from './validate-actions'

const endpoints: Endpoint[] = [
  {
    name: 'approve',
    method: 'post',
    path: '/:id/approve',
    handler: () => new Response('ok'),
  },
  {
    name: 'reindex',
    method: 'post',
    path: '/reindex',
    handler: () => new Response('ok'),
  },
]

describe('validateActions', () => {
  it('passes on valid actions', () => {
    const issues = validateActions(
      'Collection "posts"',
      [
        { key: 'approve', label: 'Approve', endpoint: 'approve', scope: ['row', 'document'] },
        {
          key: 'archive',
          label: 'Archive',
          endpoint: 'approve',
          scope: 'row',
          confirm: 'Are you sure?',
          variant: 'destructive',
        },
        { key: 'custom', label: 'Custom Dialog', component: 'my-dialog', scope: 'document' },
      ],
      endpoints,
      false,
    )
    expect(issues).toEqual([])
  })

  it('validates global actions scope to document only', () => {
    const valid = validateActions(
      'Global "settings"',
      [{ key: 'reindex', label: 'Reindex', endpoint: 'reindex', scope: 'document' }],
      endpoints,
      true,
    )
    expect(valid).toEqual([])

    const invalid = validateActions(
      'Global "settings"',
      [{ key: 'reindex', label: 'Reindex', endpoint: 'reindex', scope: 'row' }],
      endpoints,
      true,
    )
    expect(invalid).toEqual([
      'Global "settings": admin.actions[0]: global actions only support "document" scope.',
    ])
  })

  it('rejects missing or duplicate key', () => {
    const issues = validateActions(
      'Collection "posts"',
      [
        { key: '', label: 'Approve', endpoint: 'approve', scope: 'row' },
        { key: 'dup', label: 'Dup 1', endpoint: 'approve', scope: 'row' },
        { key: 'dup', label: 'Dup 2', endpoint: 'approve', scope: 'row' },
      ],
      endpoints,
    )
    expect(issues).toEqual([
      'Collection "posts": admin.actions[0]: key must be a non-empty string of letters, digits, hyphens or underscores.',
      'Collection "posts": admin.actions[2]: duplicate action key "dup".',
    ])
  })

  it('rejects unknown endpoint', () => {
    const issues = validateActions(
      'Collection "posts"',
      [{ key: 'publish', label: 'Publish', endpoint: 'nonexistent', scope: 'row' }],
      endpoints,
    )
    expect(issues).toEqual([
      'Collection "posts": action "publish" refers to unknown endpoint "nonexistent".',
    ])
  })

  it('rejects specifying both or neither endpoint and component', () => {
    const neither = validateActions(
      'Collection "posts"',
      [{ key: 'test', label: 'Test', scope: 'row' } as never],
      endpoints,
    )
    expect(neither).toEqual([
      'Collection "posts": admin.actions[0]: must specify either "endpoint" or "component".',
    ])

    const both = validateActions(
      'Collection "posts"',
      [{ key: 'test', label: 'Test', endpoint: 'approve', component: 'comp', scope: 'row' }],
      endpoints,
    )
    expect(both).toEqual([
      'Collection "posts": admin.actions[0]: specify either "endpoint" or "component", not both.',
    ])
  })

  it('rejects invalid variant or confirm', () => {
    const issues = validateActions(
      'Collection "posts"',
      [
        {
          key: 'test',
          label: 'Test',
          endpoint: 'approve',
          scope: 'row',
          variant: 'invalid' as never,
          confirm: '',
        },
      ],
      endpoints,
    )
    expect(issues).toEqual([
      'Collection "posts": admin.actions[0]: confirm must be a non-empty string.',
      'Collection "posts": admin.actions[0]: variant "invalid" is invalid.',
    ])
  })

  it('rejects bulk action whose endpoint contains :id in path', () => {
    const issues = validateActions(
      'Collection "posts"',
      [{ key: 'bulkArchive', label: 'Archive', endpoint: 'approve', scope: 'bulk' }],
      endpoints,
    )
    expect(issues).toEqual([
      'Collection "posts": bulk action "bulkArchive" refers to endpoint "approve" whose path contains ":id". Bulk endpoints must not take an ":id" parameter.',
    ])
  })
})
