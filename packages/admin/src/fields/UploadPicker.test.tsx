import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type { ClientConfig, ClientUploadField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { PortalContainerProvider } from '../context/PortalContainer'
import { UploadPicker } from './UploadPicker'

const mockConfig: ClientConfig = {
  version: 1,
  collections: [
    {
      slug: 'media',
      labels: { singular: 'Media', plural: 'Media' },
      admin: { useAsTitle: 'filename', defaultColumns: ['id', 'filename'] },
      upload: {
        mimeTypes: ['image/png', 'image/jpeg'],
      },
      fields: [{ name: 'alt', label: 'Alt', type: 'text', required: false }],
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
  onSubmit,
}: {
  children: (methods: ReturnType<typeof useForm<Record<string, unknown>>>) => React.ReactNode
  defaultValues?: Record<string, unknown>
  onSubmit?: React.FormEventHandler<HTMLFormElement>
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
      <PortalContainerProvider>
        <AdminContext.Provider
          value={{
            config: mockConfig,
            apiBase: '/api',
            basePath: '/admin',
          }}
        >
          <form onSubmit={onSubmit}>{children(methods)}</form>
        </AdminContext.Provider>
      </PortalContainerProvider>
    </QueryClientProvider>
  )
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('UploadPicker', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders browse and quick upload buttons when empty', () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: true,
    }

    render(
      <TestWrapper>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    expect(screen.getByTestId('upload-picker-browse-btn')).toBeTruthy()
    expect(screen.getByTestId('upload-picker-upload-btn')).toBeTruthy()
  })

  it('loads and selects media from dropdown', async () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: false,
    }

    vi.mocked(fetch).mockImplementation((input) => {
      const url = getRequestUrl(input)
      if (url.includes('/api/media')) {
        return mockJsonResponse({
          docs: [
            {
              id: 10,
              filename: 'hero.png',
              url: '/media/hero.png',
              mimeType: 'image/png',
            },
          ],
          totalDocs: 1,
          limit: 20,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        })
      }
      return mockJsonResponse({})
    })

    render(
      <TestWrapper>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    fireEvent.click(screen.getByTestId('upload-picker-browse-btn'))
    expect(screen.getByTestId('upload-picker-dropdown')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('upload-option-10')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('upload-option-10'))
  })

  it('renders selected media preview and handles remove', async () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: false,
    }

    vi.mocked(fetch).mockImplementation((input) => {
      const url = getRequestUrl(input)
      if (url.includes('/api/media/5')) {
        return mockJsonResponse({
          id: 5,
          filename: 'banner.png',
          url: '/media/banner.png',
          mimeType: 'image/png',
          filesize: 2048,
        })
      }
      return mockJsonResponse({})
    })

    render(
      <TestWrapper defaultValues={{ cover: 5 }}>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('upload-picker-selected')).toBeTruthy()
      expect(screen.getByText('banner.png')).toBeTruthy()
      expect(screen.getByTestId('upload-picker-link').getAttribute('href')).toBe('/admin/media/5')
    })

    fireEvent.click(screen.getByTestId('upload-picker-remove'))
    await waitFor(() => {
      expect(screen.getByTestId('upload-picker-browse-btn')).toBeTruthy()
    })
  })

  it('prevents form submission when Enter key is pressed in search input', () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: false,
    }

    const onSubmit = vi.fn((e: React.FormEvent) => {
      e.preventDefault()
    })

    render(
      <TestWrapper onSubmit={onSubmit}>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    fireEvent.click(screen.getByTestId('upload-picker-browse-btn'))
    const searchInput = screen.getByTestId('upload-picker-search')

    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('resets file input value after file selection in quick upload', () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: false,
    }

    vi.mocked(fetch).mockImplementation(() =>
      mockJsonResponse({
        id: 99,
        filename: 'avatar.png',
        url: '/media/avatar.png',
        mimeType: 'image/png',
      }),
    )

    render(
      <TestWrapper>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    const fileInput = screen.getByTestId<HTMLInputElement>('upload-picker-quick-input')
    const file = new File(['content'], 'avatar.png', { type: 'image/png' })

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: true,
    })

    fireEvent.change(fileInput)

    expect(fileInput.value).toBe('')
  })

  it('passes accept attribute to quick upload input based on collection mimeTypes', () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: false,
    }

    render(
      <TestWrapper>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    const fileInput = screen.getByTestId<HTMLInputElement>('upload-picker-quick-input')
    expect(fileInput.getAttribute('accept')).toBe('image/png,image/jpeg')
  })

  it('displays error message when quick upload mutation fails', async () => {
    const field: ClientUploadField = {
      name: 'cover',
      label: 'Cover Image',
      type: 'upload',
      relationTo: 'media',
      required: false,
    }

    vi.mocked(fetch).mockImplementation(() =>
      mockJsonResponse(
        {
          error: 'Upload rejected',
          issues: [{ message: 'File format not supported' }],
        },
        400,
      ),
    )

    render(
      <TestWrapper>
        {({ register, setValue, watch }) => (
          <UploadPicker field={field} register={register} setValue={setValue} watch={watch} />
        )}
      </TestWrapper>,
    )

    const fileInput = screen.getByTestId<HTMLInputElement>('upload-picker-quick-input')
    const file = new File(['bad'], 'test.exe', { type: 'application/x-msdownload' })

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: true,
    })

    fireEvent.change(fileInput)

    await waitFor(() => {
      const errorEl = screen.getByTestId('upload-picker-error')
      expect(errorEl.textContent).toContain('Upload rejected: File format not supported')
    })

    // Clicking browse clears the error
    fireEvent.click(screen.getByTestId('upload-picker-browse-btn'))
    expect(screen.queryByTestId('upload-picker-error')).toBeNull()
  })
})
