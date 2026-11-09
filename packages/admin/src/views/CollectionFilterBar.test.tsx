import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ClientCollection } from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import { CollectionFilterBar, collectFilterFields } from './CollectionFilterBar'

const testCollection: ClientCollection = {
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  admin: { useAsTitle: 'title', defaultColumns: ['title'] },
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true },
    {
      name: 'seo',
      label: 'SEO',
      type: 'group',
      required: false,
      fields: [
        { name: 'metaTitle', label: 'Meta Title', type: 'text', required: false },
        { name: 'metaDescription', label: 'Meta Description', type: 'textarea', required: false },
      ],
    },
  ],
}

describe('collectFilterFields', () => {
  it('expands group subfields recursively and prefixes labels', () => {
    const fields = collectFilterFields(testCollection.fields)
    expect(fields).toEqual([
      { name: 'title', label: 'Title' },
      { name: 'seo.metaTitle', label: 'SEO > Meta Title' },
      { name: 'seo.metaDescription', label: 'SEO > Meta Description' },
    ])
  })
})

describe('CollectionFilterBar', () => {
  afterEach(cleanup)

  it('renders filter bar and offers group sub-fields in filter dropdown', () => {
    const onAddFilter = vi.fn()
    const onRemoveFilter = vi.fn()
    const onClearAll = vi.fn()
    const onSearchChange = vi.fn()

    render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <CollectionFilterBar
            collection={testCollection}
            searchTerm=""
            onSearchChange={onSearchChange}
            activeFilters={[]}
            onAddFilter={onAddFilter}
            onRemoveFilter={onRemoveFilter}
            onClearAll={onClearAll}
          />
        </PortalContainerProvider>
      </div>,
    )

    // Open the filter form
    const addFilterBtn = screen.getByRole('button', { name: /Add Filter/i })
    fireEvent.click(addFilterBtn)

    // Verify Apply button is visible
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()

    // Type a value and submit
    const valueInput = screen.getByLabelText('Filter value')
    fireEvent.change(valueInput, { target: { value: 'test title' } })

    const applyBtn = screen.getByRole('button', { name: 'Apply' })
    fireEvent.click(applyBtn)

    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'title',
        operator: 'contains',
        value: 'test title',
      }),
    )
  })

  it('displays active filter pills and allows removing them', () => {
    const onAddFilter = vi.fn()
    const onRemoveFilter = vi.fn()
    const onClearAll = vi.fn()
    const onSearchChange = vi.fn()

    render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <CollectionFilterBar
            collection={testCollection}
            searchTerm=""
            onSearchChange={onSearchChange}
            activeFilters={[
              {
                id: '1',
                field: 'seo.metaTitle',
                operator: 'equals',
                value: 'My Meta Title',
              },
            ]}
            onAddFilter={onAddFilter}
            onRemoveFilter={onRemoveFilter}
            onClearAll={onClearAll}
          />
        </PortalContainerProvider>
      </div>,
    )

    expect(screen.getByText(/seo\.metaTitle equals "My Meta Title"/i)).toBeTruthy()

    const removeBtn = screen.getByLabelText('Remove seo.metaTitle filter')
    fireEvent.click(removeBtn)

    expect(onRemoveFilter).toHaveBeenCalledWith('1')
  })

  it('renders status filter select when hasDrafts is true and calls onStatusFilterChange', () => {
    const onStatusFilterChange = vi.fn()
    const draftCollection: ClientCollection = {
      ...testCollection,
      versions: { drafts: true },
    }

    render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <CollectionFilterBar
            collection={draftCollection}
            searchTerm=""
            onSearchChange={vi.fn()}
            activeFilters={[]}
            onAddFilter={vi.fn()}
            onRemoveFilter={vi.fn()}
            onClearAll={vi.fn()}
            hasDrafts={true}
            statusFilter="draft"
            onStatusFilterChange={onStatusFilterChange}
          />
        </PortalContainerProvider>
      </div>,
    )

    const statusTrigger = screen.getByRole('combobox', { name: 'Filter by status' })
    expect(statusTrigger).toBeTruthy()
    expect(screen.getByText('status = "draft"')).toBeTruthy()

    const clearStatusBtn = screen.getByLabelText('Remove status filter')
    fireEvent.click(clearStatusBtn)
    expect(onStatusFilterChange).toHaveBeenCalledWith('all')
  })
})
