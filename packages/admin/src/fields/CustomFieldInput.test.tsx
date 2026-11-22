import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  clientFieldsToZod,
  type ClientArrayField,
  type ClientBlocksField,
  type ClientCheckboxField,
  type ClientConfig,
  type ClientField,
  type ClientGroupField,
  type ClientNumberField,
} from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { ComponentRegistryProvider, type AdminComponents } from '../context/ComponentRegistry'
import { DocumentFormProvider, useDocumentForm } from '../context/DocumentFormContext'
import { PortalContainerProvider } from '../context/PortalContainer'
import { useAdminConfig, useLontarFetch } from '../hooks/useHostApi'
import { FieldRenderer } from './FieldRenderer'
import type { CustomFieldProps } from './custom-field-props'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface HarnessProps {
  components?: AdminComponents
  defaultValues?: Record<string, unknown>
  fields: ClientField[]
  render: (methods: ReturnType<typeof useForm<Record<string, unknown>>>) => ReactNode
  onSubmit?: (values: Record<string, unknown>) => void
}

function Harness({
  components,
  defaultValues = {},
  fields,
  render: renderBody,
  onSubmit,
}: HarnessProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const methods = useForm<Record<string, unknown>>({
    defaultValues,
    resolver: zodResolver(clientFieldsToZod(fields)),
  })
  return (
    <QueryClientProvider client={queryClient}>
      <ComponentRegistryProvider components={components}>
        <PortalContainerProvider>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void methods.handleSubmit((values) => onSubmit?.(values))()
            }}
          >
            {renderBody(methods)}
            <button type="submit">Save</button>
          </form>
        </PortalContainerProvider>
      </ComponentRegistryProvider>
    </QueryClientProvider>
  )
}

const rating: ClientNumberField = {
  name: 'rating',
  type: 'number',
  label: 'Rating',
  required: false,
  integer: true,
  min: 1,
  max: 5,
  component: 'rating-stars',
}

/** A host component that records the props it was given and exposes a button to set a value. */
function recorder() {
  const seen: CustomFieldProps[] = []
  function RatingStars(props: CustomFieldProps) {
    seen.push(props)
    return (
      <div data-testid="rating-stars">
        <button type="button" onClick={() => props.onChange(4)}>
          four
        </button>
        <button type="button" onClick={() => props.onChange(9)}>
          nine
        </button>
        <button type="button" onClick={props.onBlur}>
          blur
        </button>
      </div>
    )
  }
  return { RatingStars, last: () => seen[seen.length - 1] as CustomFieldProps, seen }
}

describe('custom field inputs (#465)', () => {
  it('renders the registered component in place of the input and keeps the label', () => {
    const { RatingStars } = recorder()
    render(
      <Harness
        fields={[rating]}
        components={{ 'rating-stars': RatingStars }}
        render={({ control, register }) => (
          <FieldRenderer field={rating} control={control} register={register} />
        )}
      />,
    )

    expect(screen.getByTestId('rating-stars')).toBeTruthy()
    expect(screen.getByText('Rating')).toBeTruthy()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('passes value, path, field, locale, readOnly and error', async () => {
    const { RatingStars, last } = recorder()
    render(
      <Harness
        fields={[rating]}
        defaultValues={{ rating: 3 }}
        components={{ 'rating-stars': RatingStars }}
        render={({ control, register, formState }) => (
          <FieldRenderer
            field={rating}
            control={control}
            register={register}
            error={formState.errors.rating}
          />
        )}
      />,
    )

    expect(last()).toMatchObject({
      value: 3,
      path: 'rating',
      readOnly: false,
      field: { name: 'rating', type: 'number', component: 'rating-stars' },
    })
    expect(last().error).toBeUndefined()

    fireEvent.click(screen.getByText('nine'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(last().error).toBeTruthy())
    expect(screen.getByText(last().error as string)).toBeTruthy()
  })

  it('writes through onChange and submits the value the schema accepts', async () => {
    const { RatingStars } = recorder()
    const onSubmit = vi.fn()
    render(
      <Harness
        fields={[rating]}
        components={{ 'rating-stars': RatingStars }}
        onSubmit={onSubmit}
        render={({ control, register }) => (
          <FieldRenderer field={rating} control={control} register={register} />
        )}
      />,
    )

    fireEvent.click(screen.getByText('four'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ rating: 4 })
  })

  it('still rejects a value the field type does not allow', async () => {
    const { RatingStars } = recorder()
    const onSubmit = vi.fn()
    render(
      <Harness
        fields={[rating]}
        components={{ 'rating-stars': RatingStars }}
        onSubmit={onSubmit}
        render={({ control, register, formState }) => (
          <FieldRenderer
            field={rating}
            control={control}
            register={register}
            error={formState.errors.rating}
          />
        )}
      />,
    )

    fireEvent.click(screen.getByText('nine'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('reports readOnly under a field access lock and for a read-only document', () => {
    const { RatingStars, last } = recorder()
    const { rerender } = render(
      <Harness
        fields={[rating]}
        components={{ 'rating-stars': RatingStars }}
        render={({ control, register }) => (
          <FieldRenderer
            field={rating}
            control={control}
            register={register}
            mode="edit"
            permissions={{ read: true, create: true, update: false }}
          />
        )}
      />,
    )
    expect(last().readOnly).toBe(true)
    expect(screen.getByTestId('locked-icon-rating')).toBeTruthy()

    rerender(
      <Harness
        fields={[rating]}
        components={{ 'rating-stars': RatingStars }}
        render={({ control, register }) => (
          <FieldRenderer field={rating} control={control} register={register} readOnlyDoc />
        )}
      />,
    )
    expect(last().readOnly).toBe(true)
  })

  it('keeps Lontar in charge of hiding the field: no read permission renders nothing', () => {
    const { RatingStars } = recorder()
    render(
      <Harness
        fields={[rating]}
        components={{ 'rating-stars': RatingStars }}
        render={({ control, register }) => (
          <FieldRenderer
            field={rating}
            control={control}
            register={register}
            permissions={{ read: false, create: false, update: false }}
          />
        )}
      />,
    )
    expect(screen.queryByTestId('rating-stars')).toBeNull()
  })

  it('gives a custom checkbox a label, since the standard one draws its own inside the input', () => {
    const { RatingStars } = recorder()
    const flag: ClientCheckboxField = {
      name: 'featured',
      type: 'checkbox',
      label: 'Featured',
      required: false,
      component: 'rating-stars',
    }
    render(
      <Harness
        fields={[flag]}
        components={{ 'rating-stars': RatingStars }}
        render={({ control, register }) => (
          <FieldRenderer field={flag} control={control} register={register} />
        )}
      />,
    )
    expect(screen.getByText('Featured')).toBeTruthy()
    expect(screen.getAllByText('Featured')).toHaveLength(1)
  })

  describe('unknown keys', () => {
    it('renders a placeholder naming the key, warns once, and keeps the rest of the form', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const title: ClientField = { name: 'title', type: 'text', label: 'Title', required: false }
      render(
        <Harness
          fields={[rating, title]}
          components={{}}
          render={({ control, register }) => (
            <>
              <FieldRenderer field={rating} control={control} register={register} />
              <FieldRenderer field={title} control={control} register={register} />
            </>
          )}
        />,
      )

      expect(screen.getByTestId('custom-component-missing-rating-stars').textContent).toContain(
        'rating-stars',
      )
      expect(screen.getByRole('textbox')).toBeTruthy()
      // Other libraries warn too (the router, outside a RouterProvider); count only ours.
      const ours = warn.mock.calls.filter((call) => String(call[0]).startsWith('[lontar]'))
      expect(ours).toHaveLength(1)
      expect(String(ours[0]?.[0])).toContain('rating-stars')
    })

    it('does not treat Object.prototype members as registered components', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const odd: ClientNumberField = { ...rating, component: 'constructor' }
      render(
        <Harness
          fields={[odd]}
          components={{}}
          render={({ control, register }) => (
            <FieldRenderer field={odd} control={control} register={register} />
          )}
        />,
      )
      expect(screen.getByTestId('custom-component-missing-constructor')).toBeTruthy()
    })
  })

  it('contains a component that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never {
      throw new Error('boom')
    }
    const title: ClientField = { name: 'title', type: 'text', label: 'Title', required: false }
    render(
      <Harness
        fields={[rating, title]}
        components={{ 'rating-stars': Broken }}
        render={({ control, register }) => (
          <>
            <FieldRenderer field={rating} control={control} register={register} />
            <FieldRenderer field={title} control={control} register={register} />
          </>
        )}
      />,
    )

    expect(screen.getByTestId('custom-component-error-rating-stars')).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  describe('inside container fields', () => {
    it('gets the full path inside a group', () => {
      const { RatingStars, last } = recorder()
      const group: ClientGroupField = {
        name: 'seo',
        type: 'group',
        label: 'SEO',
        required: false,
        fields: [{ ...rating, name: 'score' }],
      }
      render(
        <Harness
          fields={[group]}
          defaultValues={{ seo: { score: 2 } }}
          components={{ 'rating-stars': RatingStars }}
          render={({ control, register, watch, setValue }) => (
            <FieldRenderer
              field={group}
              control={control}
              register={register}
              watch={watch}
              setValue={setValue}
            />
          )}
        />,
      )
      expect(last()).toMatchObject({ path: 'seo.score', value: 2, field: { name: 'score' } })
    })

    it('gets a path per row inside an array', () => {
      const { RatingStars, seen } = recorder()
      const array: ClientArrayField = {
        name: 'reviews',
        type: 'array',
        label: 'Reviews',
        required: false,
        fields: [{ ...rating, name: 'stars' }],
      }
      render(
        <Harness
          fields={[array]}
          defaultValues={{ reviews: [{ stars: 1 }, { stars: 5 }] }}
          components={{ 'rating-stars': RatingStars }}
          render={({ control, register, watch, setValue }) => (
            <FieldRenderer
              field={array}
              control={control}
              register={register}
              watch={watch}
              setValue={setValue}
            />
          )}
        />,
      )
      const paths = new Set(seen.map((p) => p.path))
      expect(paths).toEqual(new Set(['reviews.0.stars', 'reviews.1.stars']))
    })

    it('gets the path of its block row', () => {
      const { RatingStars, seen } = recorder()
      const blocks: ClientBlocksField = {
        name: 'layout',
        type: 'blocks',
        label: 'Layout',
        required: false,
        blocks: [
          {
            slug: 'review',
            labels: { singular: 'Review', plural: 'Reviews' },
            fields: [{ ...rating, name: 'stars' }],
          },
        ],
      }
      render(
        <Harness
          fields={[blocks]}
          defaultValues={{ layout: [{ blockType: 'review', stars: 3 }] }}
          components={{ 'rating-stars': RatingStars }}
          render={({ control, register, watch, setValue }) => (
            <FieldRenderer
              field={blocks}
              control={control}
              register={register}
              watch={watch}
              setValue={setValue}
            />
          )}
        />,
      )
      expect(seen.map((p) => p.path)).toContain('layout.0.stars')
    })
  })
})

describe('useDocumentForm (#465)', () => {
  it('reads sibling values by path and follows changes', () => {
    const wrapper = ({ values }: { values: Record<string, unknown> }) => values
    const { result, rerender } = renderHook(() => useDocumentForm(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DocumentFormProvider values={wrapper({ values: { seo: { title: 'A' } } })}>
          {children}
        </DocumentFormProvider>
      ),
    })
    expect(result.current.getValue('seo.title')).toBe('A')
    expect(result.current.values).toEqual({ seo: { title: 'A' } })
    rerender()
  })

  it('follows the form as it changes', () => {
    function Probe() {
      const { getValue } = useDocumentForm()
      return <span data-testid="probe">{String(getValue('title'))}</span>
    }
    const { rerender } = render(
      <DocumentFormProvider values={{ title: 'one' }}>
        <Probe />
      </DocumentFormProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('one')
    rerender(
      <DocumentFormProvider values={{ title: 'two' }}>
        <Probe />
      </DocumentFormProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('two')
  })

  it('has no setter, so a component cannot write its siblings', () => {
    const { result } = renderHook(() => useDocumentForm())
    expect(Object.keys(result.current).sort()).toEqual(['getValue', 'values'])
    expect(result.current.values).toEqual({})
  })
})

describe('host hooks (#465)', () => {
  const config = { version: 1, collections: [], globals: [] } as unknown as ClientConfig

  function wrapperFor(apiBase: string) {
    return ({ children }: { children: ReactNode }) => (
      <AdminContext.Provider value={{ config, apiBase, basePath: '/admin' }}>
        {children}
      </AdminContext.Provider>
    )
  }

  it('useAdminConfig returns the client config', () => {
    const { result } = renderHook(() => useAdminConfig(), { wrapper: wrapperFor('/api') })
    expect(result.current).toBe(config)
  })

  it('useLontarFetch resolves paths against apiBase and sends the session cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const { result } = renderHook(() => useLontarFetch(), { wrapper: wrapperFor('/cms/api/') })

    await result.current('/stats/pending')
    await result.current('posts/1/approve', { method: 'POST' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/cms/api/stats/pending', {
      credentials: 'include',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/cms/api/posts/1/approve', {
      credentials: 'include',
      method: 'POST',
    })
  })
})
