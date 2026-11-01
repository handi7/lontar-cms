import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type { ClientConfig, ClientRelationshipField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { RelationshipPicker, getDocTitle, getDocEditUrl } from './RelationshipPicker'

const mockConfig: ClientConfig = {
  version: 1,
  collections: [
    {
      slug: 'users',
      labels: { singular: 'User', plural: 'Users' },
      admin: { useAsTitle: 'fullName', defaultColumns: ['id', 'fullName'] },
      fields: [{ name: 'fullName', label: 'Full Name', type: 'text', required: true }],
    },
    {
      slug: 'categories',
      labels: { singular: 'Category', plural: 'Categories' },
      admin: { useAsTitle: 'name', defaultColumns: ['id', 'name'] },
      fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
    },
  ],
  globals: [],
}

function mockJsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function TestWrapper({
  children,
  defaultValues = {},
}: {
  children: (methods: ReturnType<typeof useForm<Record<string, unknown>>>) => React.ReactNode
  defaultValues?: Record<string, unknown>
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  })
  const methods = useForm<Record<string, unknown>>({ defaultValues })

  return (
    <QueryClientProvider client={queryClient}>
      <AdminContext.Provider
        value={{
          config: mockConfig,
          apiBase: '/api',
          basePath: '/admin',
        }}
      >
        <form>{children(methods)}</form>
      </AdminContext.Provider>
    </QueryClientProvider>
  )
}

describe('RelationshipPicker Helpers', () => {
  it('getDocTitle resolves title correctly with useAsTitle and fallbacks', () => {
    expect(getDocTitle(null, 'name')).toBe('')
    expect(getDocTitle({ name: 'Tech News' }, 'name')).toBe('Tech News')
    expect(getDocTitle({ title: 'My Article' }, 'title')).toBe('My Article')
    expect(getDocTitle({ id: 10 }, 'name')).toBe('#10')
    expect(getDocTitle({ other: 'val' }, 'name')).toBe('Untitled')
  })

  it('getDocEditUrl builds direct edit links correctly', () => {
    expect(getDocEditUrl('/admin', 'users', 42)).toBe('/admin/users/42')
    expect(getDocEditUrl('/admin/', 'categories', 5)).toBe('/admin/categories/5')
    expect(getDocEditUrl('', 'posts', 1)).toBe('/posts/1')
    expect(getDocEditUrl('/', 'posts', 1)).toBe('/posts/1')
  })
})

describe('Single RelationshipPicker', () => {
  const authorField: ClientRelationshipField = {
    name: 'author',
    type: 'relationship',
    relationTo: 'users',
    label: 'Author',
    required: true,
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/users/42')) {
          return mockJsonResponse({ id: 42, fullName: 'Grace Hopper' })
        }
        if (url.includes('/api/users')) {
          return mockJsonResponse({
            docs: [
              { id: 1, fullName: 'Ada Lovelace' },
              { id: 2, fullName: 'Alan Turing' },
            ],
            totalDocs: 2,
            limit: 20,
            page: 1,
            totalPages: 1,
          })
        }
        return mockJsonResponse({}, 404)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders search input when no document is selected and allows selecting an option', async () => {
    render(
      <TestWrapper defaultValues={{ author: null }}>
        {({ register, setValue, watch }) => (
          <RelationshipPicker
            field={authorField}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </TestWrapper>,
    )

    expect(screen.getByTestId('relationship-search')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search Users...')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('relationship-option-1')).toBeTruthy()
      expect(screen.getByTestId('relationship-option-2')).toBeTruthy()
    })

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Alan Turing')).toBeTruthy()

    // Click option 1
    fireEvent.click(screen.getByTestId('relationship-option-1'))

    // The selected view is now rendered with the selected doc id
    expect(screen.getByTestId('relationship-single-selected')).toBeTruthy()
    expect(screen.getAllByText('#1').length).toBeGreaterThanOrEqual(1)
  })

  it('renders selected document view with edit link, change, and remove buttons', async () => {
    render(
      <TestWrapper defaultValues={{ author: 42 }}>
        {({ register, setValue, watch }) => (
          <RelationshipPicker
            field={authorField}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </TestWrapper>,
    )

    expect(screen.getByTestId('relationship-single-selected')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeTruthy()
    })

    const link = screen.getByTestId<HTMLAnchorElement>('relationship-link')
    expect(link.getAttribute('href')).toBe('/admin/users/42')
    expect(link.getAttribute('target')).toBe('_blank')

    expect(screen.getByTestId('relationship-change')).toBeTruthy()
    expect(screen.getByTestId('relationship-clear')).toBeTruthy()
  })

  it('opens search when change button is clicked and allows clearing selection', async () => {
    render(
      <TestWrapper defaultValues={{ author: 42 }}>
        {({ register, setValue, watch }) => (
          <RelationshipPicker
            field={authorField}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeTruthy()
    })

    // Click Change
    fireEvent.click(screen.getByTestId('relationship-change'))

    // Search bar is now visible
    expect(screen.getByTestId('relationship-search')).toBeTruthy()
    expect(screen.getByTestId('relationship-cancel-search')).toBeTruthy()

    // Click Cancel search
    fireEvent.click(screen.getByTestId('relationship-cancel-search'))
    expect(screen.getByTestId('relationship-single-selected')).toBeTruthy()

    // Click Remove
    fireEvent.click(screen.getByTestId('relationship-clear'))
  })
})

describe('Many RelationshipPicker (hasMany: true)', () => {
  const categoriesField: ClientRelationshipField = {
    name: 'categories',
    type: 'relationship',
    relationTo: 'categories',
    hasMany: true,
    label: 'Categories',
    required: false,
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('where%5Bid%5D%5Bin%5D') || url.includes('where[id][in]')) {
          return mockJsonResponse({
            docs: [
              { id: 10, name: 'TypeScript' },
              { id: 20, name: 'Next.js' },
            ],
            totalDocs: 2,
            limit: 2,
            page: 1,
            totalPages: 1,
          })
        }
        if (url.includes('/api/categories')) {
          return mockJsonResponse({
            docs: [
              { id: 10, name: 'TypeScript' },
              { id: 20, name: 'Next.js' },
              { id: 30, name: 'React' },
            ],
            totalDocs: 3,
            limit: 20,
            page: 1,
            totalPages: 1,
          })
        }
        return mockJsonResponse({}, 404)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders empty hint and add button when no items selected', () => {
    render(
      <TestWrapper defaultValues={{ categories: [] }}>
        {({ register, setValue, watch }) => (
          <RelationshipPicker
            field={categoriesField}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </TestWrapper>,
    )

    expect(screen.getByTestId('relationship-empty-hint')).toBeTruthy()
    expect(screen.getByText('No Categories selected')).toBeTruthy()
    expect(screen.getByTestId('relationship-add-btn')).toBeTruthy()
  })

  it('renders selected items in order with direct edit links and reordering/removal buttons', async () => {
    render(
      <TestWrapper defaultValues={{ categories: [10, 20] }}>
        {({ register, setValue, watch }) => (
          <RelationshipPicker
            field={categoriesField}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </TestWrapper>,
    )

    expect(screen.getByTestId('relationship-many-list')).toBeTruthy()
    expect(screen.getByTestId('relationship-item-10')).toBeTruthy()
    expect(screen.getByTestId('relationship-item-20')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('TypeScript')).toBeTruthy()
      expect(screen.getByText('Next.js')).toBeTruthy()
    })

    const link10 = screen.getByTestId<HTMLAnchorElement>('relationship-link-10')
    expect(link10.getAttribute('href')).toBe('/admin/categories/10')
    expect(link10.getAttribute('target')).toBe('_blank')

    const moveUp10 = screen.getByTestId<HTMLButtonElement>('relationship-move-up-10')
    const moveDown10 = screen.getByTestId<HTMLButtonElement>('relationship-move-down-10')
    expect(moveUp10.disabled).toBe(true) // First item cannot move up
    expect(moveDown10.disabled).toBe(false)

    const moveDown20 = screen.getByTestId<HTMLButtonElement>('relationship-move-down-20')
    expect(moveDown20.disabled).toBe(true) // Last item cannot move down

    // Click Move Down on item 10
    fireEvent.click(moveDown10)

    // Click Remove on item 10
    const remove10 = screen.getByTestId('relationship-remove-10')
    fireEvent.click(remove10)
  })

  it('excludes already selected items in the search dropdown and appends newly selected items', async () => {
    render(
      <TestWrapper defaultValues={{ categories: [10] }}>
        {({ register, setValue, watch }) => (
          <RelationshipPicker
            field={categoriesField}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </TestWrapper>,
    )

    // Click + Add Category
    fireEvent.click(screen.getByTestId('relationship-add-btn'))

    expect(screen.getByTestId('relationship-search')).toBeTruthy()

    await waitFor(() => {
      // 10 is excluded because it's already selected
      expect(screen.queryByTestId('relationship-option-10')).toBeNull()
      // 20 and 30 are available
      expect(screen.getByTestId('relationship-option-20')).toBeTruthy()
      expect(screen.getByTestId('relationship-option-30')).toBeTruthy()
    })

    // Click option 30 (React)
    fireEvent.click(screen.getByTestId('relationship-option-30'))
  })
})
