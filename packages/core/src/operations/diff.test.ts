import { describe, expect, it } from 'vitest'
import { block } from '../fields'
import { collection } from '../config/collection'
import { fields as f } from '../fields'
import {
  diffSnapshots,
  type ArrayFieldDiff,
  type BlocksFieldDiff,
  type GroupFieldDiff,
} from './diff'

describe('diffSnapshots', () => {
  it('diffs primitive fields (added, removed, modified, unchanged)', () => {
    const col = collection({
      slug: 'articles',
      fields: {
        title: f.text({ required: true }),
        subtitle: f.text(),
        views: f.number(),
        featured: f.checkbox(),
      },
    })

    const oldSnapshot = {
      id: 1,
      title: 'Old Title',
      subtitle: 'Old Subtitle',
      views: 10,
      featured: true,
    }

    const newSnapshot = {
      id: 1,
      title: 'New Title', // modified
      subtitle: null, // removed
      views: 10, // unchanged
      featured: true, // unchanged
      extra: 'Added Value',
    }

    const diff = diffSnapshots(col, oldSnapshot, newSnapshot)

    expect(diff.hasChanges).toBe(true)
    expect(diff.fields.title).toEqual({
      type: 'primitive',
      change: 'modified',
      oldValue: 'Old Title',
      value: 'New Title',
    })
    expect(diff.fields.subtitle).toEqual({
      type: 'primitive',
      change: 'removed',
      oldValue: 'Old Subtitle',
      value: null,
    })
    expect(diff.fields.views).toEqual({
      type: 'primitive',
      change: 'unchanged',
      oldValue: 10,
      value: 10,
    })
    expect(diff.fields.featured).toEqual({
      type: 'primitive',
      change: 'unchanged',
      oldValue: true,
      value: true,
    })
  })

  it('diffs nested group fields', () => {
    const col = collection({
      slug: 'posts',
      fields: {
        title: f.text({ required: true }),
        seo: f.group({
          fields: {
            metaTitle: f.text(),
            metaDesc: f.text(),
          },
        }),
      },
    })

    const oldSnapshot = {
      id: 1,
      title: 'Hello',
      seo: {
        metaTitle: 'Old Meta',
        metaDesc: 'Same Desc',
      },
    }

    const newSnapshot = {
      id: 1,
      title: 'Hello',
      seo: {
        metaTitle: 'New Meta',
        metaDesc: 'Same Desc',
      },
    }

    const diff = diffSnapshots(col, oldSnapshot, newSnapshot)

    expect(diff.hasChanges).toBe(true)
    expect(diff.fields.title).toEqual({
      type: 'primitive',
      change: 'unchanged',
      oldValue: 'Hello',
      value: 'Hello',
    })

    const seoDiff = diff.fields.seo as GroupFieldDiff
    expect(seoDiff.type).toBe('group')
    expect(seoDiff.hasChanges).toBe(true)
    expect(seoDiff.fields.metaTitle).toEqual({
      type: 'primitive',
      change: 'modified',
      oldValue: 'Old Meta',
      value: 'New Meta',
    })
    expect(seoDiff.fields.metaDesc).toEqual({
      type: 'primitive',
      change: 'unchanged',
      oldValue: 'Same Desc',
      value: 'Same Desc',
    })
  })

  it('diffs array items by stable row ID (add, remove, modify, reorder)', () => {
    const col = collection({
      slug: 'posts',
      fields: {
        authors: f.array({
          fields: {
            name: f.text({ required: true }),
            role: f.text(),
          },
        }),
      },
    })

    const oldSnapshot = {
      id: 1,
      authors: [
        { id: 'row-1', name: 'Alice', role: 'Editor' },
        { id: 'row-2', name: 'Bob', role: 'Writer' },
        { id: 'row-3', name: 'Charlie', role: 'Reviewer' },
      ],
    }

    // Alice is reordered to index 1 and role modified.
    // Bob is reordered to index 0, unchanged fields.
    // Charlie (row-3) is removed.
    // David (row-4) is added at index 2.
    const newSnapshot = {
      id: 1,
      authors: [
        { id: 'row-2', name: 'Bob', role: 'Writer' },
        { id: 'row-1', name: 'Alice', role: 'Lead Editor' },
        { id: 'row-4', name: 'David', role: 'Contributor' },
      ],
    }

    const diff = diffSnapshots(col, oldSnapshot, newSnapshot)

    expect(diff.hasChanges).toBe(true)
    const authorsDiff = diff.fields.authors as ArrayFieldDiff
    expect(authorsDiff.type).toBe('array')
    expect(authorsDiff.hasChanges).toBe(true)
    expect(authorsDiff.items).toHaveLength(4)

    // Bob: unchanged content, reordered from index 1 to 0
    const bob = authorsDiff.items.find((item) => item.id === 'row-2')!
    expect(bob).toBeDefined()
    expect(bob.change).toBe('unchanged')
    expect(bob.orderChanged).toBe(true)
    expect(bob.oldIndex).toBe(1)
    expect(bob.newIndex).toBe(0)

    // Alice: modified content, reordered from index 0 to 1
    const alice = authorsDiff.items.find((item) => item.id === 'row-1')!
    expect(alice).toBeDefined()
    expect(alice.change).toBe('modified')
    expect(alice.orderChanged).toBe(true)
    expect(alice.oldIndex).toBe(0)
    expect(alice.newIndex).toBe(1)
    expect(alice.diffs?.role).toEqual({
      type: 'primitive',
      change: 'modified',
      oldValue: 'Editor',
      value: 'Lead Editor',
    })

    // David: added at index 2
    const david = authorsDiff.items.find((item) => item.id === 'row-4')!
    expect(david).toBeDefined()
    expect(david.change).toBe('added')
    expect(david.newIndex).toBe(2)

    // Charlie: removed (oldIndex 2)
    const charlie = authorsDiff.items.find((item) => item.id === 'row-3')!
    expect(charlie).toBeDefined()
    expect(charlie.change).toBe('removed')
    expect(charlie.oldIndex).toBe(2)
  })

  it('diffs blocks with stable IDs and block types', () => {
    const textBlock = block({
      slug: 'text',
      fields: {
        body: f.text(),
      },
    })
    const calloutBlock = block({
      slug: 'callout',
      fields: {
        tone: f.text(),
        message: f.text(),
      },
    })

    const col = collection({
      slug: 'pages',
      fields: {
        layout: f.blocks({
          blocks: [textBlock, calloutBlock],
        }),
      },
    })

    const oldSnapshot = {
      id: 1,
      layout: [
        { id: 'b-1', blockType: 'text', body: 'Original text' },
        { id: 'b-2', blockType: 'callout', tone: 'info', message: 'Hello note' },
      ],
    }

    const newSnapshot = {
      id: 1,
      layout: [
        { id: 'b-1', blockType: 'text', body: 'Updated text' },
        { id: 'b-3', blockType: 'callout', tone: 'warning', message: 'Warning note' },
      ],
    }

    const diff = diffSnapshots(col, oldSnapshot, newSnapshot)

    expect(diff.hasChanges).toBe(true)
    const layoutDiff = diff.fields.layout as BlocksFieldDiff
    expect(layoutDiff.type).toBe('blocks')
    expect(layoutDiff.hasChanges).toBe(true)

    const b1 = layoutDiff.items.find((b) => b.id === 'b-1')!
    expect(b1.change).toBe('modified')
    expect(b1.diffs?.body).toEqual({
      type: 'primitive',
      change: 'modified',
      oldValue: 'Original text',
      value: 'Updated text',
    })

    const b2 = layoutDiff.items.find((b) => b.id === 'b-2')!
    expect(b2.change).toBe('removed')
    expect(b2.blockType).toBe('callout')

    const b3 = layoutDiff.items.find((b) => b.id === 'b-3')!
    expect(b3.change).toBe('added')
    expect(b3.blockType).toBe('callout')
  })

  it('diffs _status for collections with drafts enabled', () => {
    const col = collection({
      slug: 'posts',
      versions: { drafts: true },
      fields: {
        title: f.text(),
      },
    })

    const draftSnapshot = { id: 1, title: 'Same', _status: 'draft' }
    const publishedSnapshot = { id: 1, title: 'Same', _status: 'published' }

    const diff = diffSnapshots(col, draftSnapshot, publishedSnapshot)
    expect(diff.hasChanges).toBe(true)
    expect(diff.fields._status).toEqual({
      type: 'primitive',
      change: 'modified',
      oldValue: 'draft',
      value: 'published',
    })
  })
})
