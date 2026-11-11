import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ClientField, DocumentDiff } from '@lontar/core/client'
import { VersionDiffViewer } from './VersionDiffViewer'

afterEach(cleanup)

describe('VersionDiffViewer', () => {
  const fields: ClientField[] = [
    { name: 'title', label: 'Post Title', type: 'text', required: true },
    { name: 'summary', label: 'Summary', type: 'textarea', required: false },
    { name: 'content', label: 'Article Content', type: 'richText', required: false },
    {
      name: 'featuredImage',
      label: 'Featured Image',
      type: 'upload',
      required: false,
      relationTo: 'media',
    },
    {
      name: 'seo',
      label: 'SEO Metadata',
      type: 'group',
      required: false,
      fields: [
        { name: 'metaTitle', label: 'Meta Title', type: 'text', required: false },
        { name: 'metaDescription', label: 'Meta Description', type: 'textarea', required: false },
      ],
    },
    {
      name: 'authors',
      label: 'Authors',
      type: 'array',
      required: false,
      fields: [{ name: 'name', label: 'Author Name', type: 'text', required: true }],
    },
  ]

  it('renders a friendly message when there are no changes', () => {
    const diff: DocumentDiff = { fields: {}, hasChanges: false }
    render(<VersionDiffViewer diff={diff} fields={fields} />)

    expect(screen.getByText('No changes detected between these snapshots.')).toBeTruthy()
  })

  it('renders primitive diffs with old and new values', () => {
    const diff: DocumentDiff = {
      hasChanges: true,
      fields: {
        title: {
          type: 'primitive',
          change: 'modified',
          oldValue: 'Original Title',
          value: 'Updated Title',
        },
        summary: {
          type: 'primitive',
          change: 'added',
          value: 'New summary here',
        },
      },
    }

    render(
      <VersionDiffViewer
        diff={diff}
        fields={fields}
        oldLabel="Snapshot v1"
        newLabel="Snapshot v2"
      />,
    )

    expect(screen.getByText('Post Title')).toBeTruthy()
    expect(screen.getByText('Original Title')).toBeTruthy()
    expect(screen.getByText('Updated Title')).toBeTruthy()
    expect(screen.getByText('New summary here')).toBeTruthy()
    expect(screen.getAllByText('Snapshot v1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Snapshot v2').length).toBeGreaterThan(0)
  })

  it('renders rich text as readable text instead of a JSON dump', () => {
    const oldRichText = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph intro' }],
        },
      ],
    }
    const newRichText = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Updated introductory text' }],
        },
      ],
    }

    const diff: DocumentDiff = {
      hasChanges: true,
      fields: {
        content: {
          type: 'primitive',
          change: 'modified',
          oldValue: oldRichText,
          value: newRichText,
        },
      },
    }

    render(<VersionDiffViewer diff={diff} fields={fields} />)

    expect(screen.getByText('Article Content')).toBeTruthy()
    expect(screen.getByText('First paragraph intro')).toBeTruthy()
    expect(screen.getByText('Updated introductory text')).toBeTruthy()
    // Does not dump raw JSON
    expect(screen.queryByText(/"type":\s*"doc"/)).toBeNull()
  })

  it('renders upload fields with readable file info', () => {
    const oldMedia = { filename: 'hero-old.png', filesize: 204800 }
    const newMedia = { filename: 'hero-new.jpg', filesize: 409600 }

    const diff: DocumentDiff = {
      hasChanges: true,
      fields: {
        featuredImage: {
          type: 'primitive',
          change: 'modified',
          oldValue: oldMedia,
          value: newMedia,
        },
      },
    }

    render(<VersionDiffViewer diff={diff} fields={fields} />)

    expect(screen.getByText('Featured Image')).toBeTruthy()
    expect(screen.getByText('hero-old.png • 200 KB')).toBeTruthy()
    expect(screen.getByText('hero-new.jpg • 400 KB')).toBeTruthy()
  })

  it('renders nested group and array diffs', () => {
    const diff: DocumentDiff = {
      hasChanges: true,
      fields: {
        seo: {
          type: 'group',
          hasChanges: true,
          fields: {
            metaTitle: {
              type: 'primitive',
              change: 'modified',
              oldValue: 'Old SEO',
              value: 'New SEO',
            },
          },
        },
        authors: {
          type: 'array',
          hasChanges: true,
          items: [
            {
              id: 'row-1',
              change: 'modified',
              diffs: {
                name: {
                  type: 'primitive',
                  change: 'modified',
                  oldValue: 'Alice',
                  value: 'Alice Walker',
                },
              },
            },
            {
              id: 'row-2',
              change: 'added',
              newIndex: 1,
            },
          ],
        },
      },
    }

    render(<VersionDiffViewer diff={diff} fields={fields} />)

    expect(screen.getByText('SEO Metadata')).toBeTruthy()
    expect(screen.getByText('Old SEO')).toBeTruthy()
    expect(screen.getByText('New SEO')).toBeTruthy()

    expect(screen.getByText('Authors')).toBeTruthy()
    expect(screen.getByText('Row #row-1')).toBeTruthy()
    expect(screen.getByText('Row #row-2')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Alice Walker')).toBeTruthy()
  })

  it('provides accessible toggle attributes (aria-label and aria-expanded) on group and row toggles (#248)', () => {
    const diff: DocumentDiff = {
      hasChanges: true,
      fields: {
        seo: {
          type: 'group',
          hasChanges: true,
          fields: {
            metaTitle: {
              type: 'primitive',
              change: 'modified',
              oldValue: 'Old SEO',
              value: 'New SEO',
            },
          },
        },
        authors: {
          type: 'array',
          hasChanges: true,
          items: [
            {
              id: 'row-1',
              change: 'modified',
              newIndex: 0,
              diffs: {
                name: {
                  type: 'primitive',
                  change: 'modified',
                  oldValue: 'Alice',
                  value: 'Alice Walker',
                },
              },
            },
          ],
        },
      },
    }

    render(<VersionDiffViewer diff={diff} fields={fields} />)

    // Group toggle accessibility
    const groupToggle = screen.getByRole('button', { name: 'Hide nested group fields' })
    expect(groupToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Old SEO')).toBeTruthy()

    fireEvent.click(groupToggle)
    expect(groupToggle.getAttribute('aria-expanded')).toBe('false')
    expect(groupToggle.getAttribute('aria-label')).toBe('Show nested group fields')
    expect(screen.queryByText('Old SEO')).toBeNull()

    // Row toggle accessibility
    const rowToggle = screen.getByRole('button', { name: 'Hide changes in row 1' })
    expect(rowToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Alice Walker')).toBeTruthy()

    fireEvent.click(rowToggle)
    expect(rowToggle.getAttribute('aria-expanded')).toBe('false')
    expect(rowToggle.getAttribute('aria-label')).toBe('Show changes in row 1')
    expect(screen.queryByText('Alice Walker')).toBeNull()
  })

  it('renders full subfield content for added and removed array and block rows with toggles (#248)', () => {
    const blockFields: ClientField[] = [
      {
        name: 'layout',
        label: 'Layout',
        type: 'blocks',
        required: false,
        blocks: [
          {
            slug: 'hero',
            labels: { singular: 'Hero', plural: 'Heroes' },
            fields: [{ name: 'headline', label: 'Headline', type: 'text', required: true }],
          },
        ],
      },
      ...fields,
    ]

    const diff: DocumentDiff = {
      hasChanges: true,
      fields: {
        authors: {
          type: 'array',
          hasChanges: true,
          items: [
            {
              id: 'row-add',
              change: 'added',
              newIndex: 0,
              diffs: {
                name: {
                  type: 'primitive',
                  change: 'added',
                  value: 'New Author Bob',
                },
              },
            },
            {
              id: 'row-del',
              change: 'removed',
              oldIndex: 1,
              diffs: {
                name: {
                  type: 'primitive',
                  change: 'removed',
                  oldValue: 'Departed Author Dana',
                },
              },
            },
          ],
        },
        layout: {
          type: 'blocks',
          hasChanges: true,
          items: [
            {
              id: 'block-hero-1',
              blockType: 'hero',
              change: 'added',
              newIndex: 0,
              diffs: {
                headline: {
                  type: 'primitive',
                  change: 'added',
                  value: 'Welcome to Lontar',
                },
              },
            },
          ],
        },
      },
    }

    render(<VersionDiffViewer diff={diff} fields={blockFields} />)

    // Array items: both added and removed rows show their full content and toggles
    expect(screen.getByText('New Author Bob')).toBeTruthy()
    expect(screen.getByText('Departed Author Dana')).toBeTruthy()

    const addRowToggle = screen.getByRole('button', { name: 'Hide changes in row 1' })
    expect(addRowToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(addRowToggle)
    expect(addRowToggle.getAttribute('aria-expanded')).toBe('false')
    expect(addRowToggle.getAttribute('aria-label')).toBe('Show changes in row 1')
    expect(screen.queryByText('New Author Bob')).toBeNull()

    const delRowToggle = screen.getByRole('button', { name: 'Hide changes in row 2' })
    expect(delRowToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(delRowToggle)
    expect(delRowToggle.getAttribute('aria-expanded')).toBe('false')
    expect(delRowToggle.getAttribute('aria-label')).toBe('Show changes in row 2')
    expect(screen.queryByText('Departed Author Dana')).toBeNull()

    // Block item: displays content and toggle with block-specific aria-label
    expect(screen.getByText('Welcome to Lontar')).toBeTruthy()
    const blockToggle = screen.getByRole('button', { name: 'Hide changes in block hero' })
    expect(blockToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(blockToggle)
    expect(blockToggle.getAttribute('aria-expanded')).toBe('false')
    expect(blockToggle.getAttribute('aria-label')).toBe('Show changes in block hero')
    expect(screen.queryByText('Welcome to Lontar')).toBeNull()
  })
})
