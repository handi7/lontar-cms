import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type {
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientNumberField,
  ClientRelationshipField,
  ClientRichTextField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
  ClientUploadField,
} from '@lontar/core/client'
import { FieldRenderer, slugify } from './FieldRenderer'

describe('slugify', () => {
  it('converts titles to URL-safe slugs', () => {
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('  My First Post!  ')).toBe('my-first-post')
    expect(slugify('TypeScript 5.0 is Great & Fast')).toBe('typescript-50-is-great-fast')
    expect(slugify('multiple---hyphens___and spaces')).toBe('multiple-hyphens-and-spaces')
    expect(slugify('')).toBe('')
  })
})

function FormWrapper({
  children,
  defaultValues = {},
}: {
  children: (methods: ReturnType<typeof useForm<Record<string, unknown>>>) => React.ReactNode
  defaultValues?: Record<string, unknown>
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const methods = useForm<Record<string, unknown>>({ defaultValues })
  return (
    <QueryClientProvider client={queryClient}>
      <form>{children(methods)}</form>
    </QueryClientProvider>
  )
}

describe('FieldRenderer', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders textarea with custom rows, minLength, and maxLength', () => {
    const field: ClientTextareaField = {
      name: 'content',
      type: 'textarea',
      label: 'Content',
      required: true,
      rows: 8,
      minLength: 10,
      maxLength: 500,
    }

    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea.getAttribute('rows')).toBe('8')
    expect(textarea.getAttribute('minlength')).toBe('10')
    expect(textarea.getAttribute('maxlength')).toBe('500')
    expect(screen.getByText('Content')).toBeTruthy()
    expect(screen.getByText('*')).toBeTruthy()
  })

  it('renders email input with type="email"', () => {
    const field: ClientEmailField = {
      name: 'email',
      type: 'email',
      label: 'Email Address',
      required: false,
      maxLength: 255,
    }

    const { container } = render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const input = container.querySelector('input#email') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('email')
    expect(input.getAttribute('maxlength')).toBe('255')
    expect(screen.getByText('Email Address')).toBeTruthy()
  })

  it('renders slug input with sync button and auto-syncs in create mode', async () => {
    const titleField: ClientTextField = {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true,
    }

    const slugField: ClientSlugField = {
      name: 'slug',
      type: 'slug',
      label: 'Slug',
      required: true,
      from: 'title',
    }

    const { container } = render(
      <FormWrapper defaultValues={{ title: '', slug: '' }}>
        {({ control, register, setValue, watch }) => (
          <>
            <FieldRenderer field={titleField} control={control} register={register} />
            <FieldRenderer
              field={slugField}
              control={control}
              register={register}
              setValue={setValue}
              watch={watch}
              mode="create"
            />
          </>
        )}
      </FormWrapper>,
    )

    const titleInput = container.querySelector('input#title') as HTMLInputElement
    const slugInput = container.querySelector('input#slug') as HTMLInputElement
    const syncBtn = screen.getByRole('button', { name: /sync/i })

    expect(titleInput).toBeTruthy()
    expect(slugInput).toBeTruthy()
    expect(syncBtn).toBeTruthy()

    fireEvent.change(titleInput, { target: { value: 'My Awesome Post' } })

    await waitFor(() => {
      expect(slugInput.value).toBe('my-awesome-post')
    })

    // Manual typing stops auto-sync
    fireEvent.change(slugInput, { target: { value: 'custom-slug' } })
    fireEvent.change(titleInput, { target: { value: 'Another Title' } })

    expect(slugInput.value).toBe('custom-slug')

    // Clicking sync re-syncs
    fireEvent.click(syncBtn)
    await waitFor(() => {
      expect(slugInput.value).toBe('another-title')
    })
  })

  it('does not auto-sync in edit mode', async () => {
    const titleField: ClientTextField = {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true,
    }

    const slugField: ClientSlugField = {
      name: 'slug',
      type: 'slug',
      label: 'Slug',
      required: true,
      from: 'title',
    }

    const { container } = render(
      <FormWrapper defaultValues={{ title: 'Existing Title', slug: 'existing-title' }}>
        {({ control, register, setValue, watch }) => (
          <>
            <FieldRenderer field={titleField} control={control} register={register} />
            <FieldRenderer
              field={slugField}
              control={control}
              register={register}
              setValue={setValue}
              watch={watch}
              mode="edit"
            />
          </>
        )}
      </FormWrapper>,
    )

    const titleInput = container.querySelector('input#title') as HTMLInputElement
    const slugInput = container.querySelector('input#slug') as HTMLInputElement

    fireEvent.change(titleInput, { target: { value: 'Completely Changed Title' } })

    // Slug should not have changed automatically in edit mode
    expect(slugInput.value).toBe('existing-title')

    // But clicking Sync button should sync it
    const syncBtn = screen.getByRole('button', { name: /sync/i })
    fireEvent.click(syncBtn)

    await waitFor(() => {
      expect(slugInput.value).toBe('completely-changed-title')
    })
  })

  it('displays validation error message when error is provided', () => {
    const field: ClientTextField = {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true,
    }

    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer
            field={field}
            control={control}
            register={register}
            error={{ message: 'Title is required' }}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('Title is required')).toBeTruthy()
  })

  it('renders checkbox input with label and handles toggle', () => {
    const field: ClientCheckboxField = {
      name: 'isPublished',
      type: 'checkbox',
      label: 'Published',
      required: false,
    }

    const { container } = render(
      <FormWrapper defaultValues={{ isPublished: false }}>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const checkbox = container.querySelector('input#isPublished') as HTMLInputElement
    expect(checkbox).toBeTruthy()
    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.checked).toBe(false)
    expect(screen.getByText('Published')).toBeTruthy()

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
  })

  it('renders select dropdown with options and handles selection', () => {
    const field: ClientSelectField = {
      name: 'status',
      type: 'select',
      label: 'Status',
      required: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    }

    const { container } = render(
      <FormWrapper defaultValues={{ status: 'draft' }}>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const select = container.querySelector('select#status') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.value).toBe('draft')
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Published')).toBeTruthy()

    fireEvent.change(select, { target: { value: 'published' } })
    expect(select.value).toBe('published')
  })

  it('renders date input with type="datetime-local"', () => {
    const field: ClientDateField = {
      name: 'publishedAt',
      type: 'date',
      label: 'Publish Date',
      required: true,
    }

    const { container } = render(
      <FormWrapper defaultValues={{ publishedAt: '2026-11-01T10:00' }}>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const dateInput = container.querySelector('input#publishedAt') as HTMLInputElement
    expect(dateInput).toBeTruthy()
    expect(dateInput.type).toBe('datetime-local')
    expect(dateInput.value).toBe('2026-11-01T10:00')
    expect(screen.getByText('Publish Date')).toBeTruthy()
  })

  it('renders richText editor with toolbar buttons and content area', () => {
    const field: ClientRichTextField = {
      name: 'body',
      type: 'richText',
      label: 'Article Body',
      required: true,
    }

    render(
      <FormWrapper
        defaultValues={{
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello Tiptap' }] }],
          },
        }}
      >
        {({ control, register, setValue, watch }) => (
          <FieldRenderer
            field={field}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('Article Body')).toBeTruthy()
    expect(screen.getByTestId('richtext-body')).toBeTruthy()
    expect(screen.getByTestId('richtext-bold')).toBeTruthy()
    expect(screen.getByTestId('richtext-italic')).toBeTruthy()
    expect(screen.getByTestId('richtext-h1')).toBeTruthy()
    expect(screen.getByTestId('richtext-bulletList')).toBeTruthy()
    expect(screen.getByTestId('richtext-link')).toBeTruthy()
  })

  it('renders single relationship picker', () => {
    const field: ClientRelationshipField = {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      label: 'Author',
      required: true,
    }

    render(
      <FormWrapper defaultValues={{ author: 42 }}>
        {({ control, register, setValue, watch }) => (
          <FieldRenderer
            field={field}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('Author')).toBeTruthy()
    expect(screen.getByTestId('relationship-single-selected')).toBeTruthy()
  })

  it('renders hasMany relationship picker', () => {
    const field: ClientRelationshipField = {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      label: 'Categories',
      required: false,
    }

    render(
      <FormWrapper defaultValues={{ categories: [1, 2, 3] }}>
        {({ control, register, setValue, watch }) => (
          <FieldRenderer
            field={field}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('Categories')).toBeTruthy()
    expect(screen.getByTestId('relationship-many-list')).toBeTruthy()
    expect(screen.getByTestId('relationship-item-1')).toBeTruthy()
    expect(screen.getByTestId('relationship-item-2')).toBeTruthy()
    expect(screen.getByTestId('relationship-item-3')).toBeTruthy()
  })

  it('renders upload picker', () => {
    const field: ClientUploadField = {
      name: 'cover',
      type: 'upload',
      relationTo: 'media',
      label: 'Cover Image',
      required: true,
    }

    render(
      <FormWrapper>
        {({ control, register, setValue, watch }) => (
          <FieldRenderer
            field={field}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('Cover Image')).toBeTruthy()
    expect(screen.getByTestId('upload-picker-browse-btn')).toBeTruthy()
  })
})

describe('FieldRenderer accessibility and binding', () => {
  afterEach(() => {
    cleanup()
  })

  const titleField: ClientTextField = {
    name: 'title',
    type: 'text',
    label: 'Title',
    required: true,
  }

  it('associates the error message with its control', () => {
    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer
            field={titleField}
            control={control}
            register={register}
            error={{ message: 'Title is required' }}
          />
        )}
      </FormWrapper>,
    )

    const input = screen.getByRole('textbox')
    const error = screen.getByRole('alert')

    expect(error.textContent).toBe('Title is required')
    expect(error.id).toBe('title-error')
    expect(input.getAttribute('aria-describedby')).toBe('title-error')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-required')).toBe('true')
  })

  it('leaves a control without an error unmarked', () => {
    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={titleField} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const input = screen.getByRole('textbox')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the id and name the test and e2e suites select by', () => {
    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={titleField} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const input = screen.getByRole('textbox')
    expect(input.getAttribute('name')).toBe('title')
    expect(input.id).toBe('title')
  })

  it('submits a cleared number field as null rather than an empty string', async () => {
    const viewsField: ClientNumberField = {
      name: 'views',
      type: 'number',
      label: 'Views',
      required: false,
    }
    let submitted: Record<string, unknown> | undefined

    render(
      <FormWrapper>
        {({ control, register, handleSubmit }) => (
          <>
            <FieldRenderer field={viewsField} control={control} register={register} />
            <button
              type="button"
              onClick={() => {
                void handleSubmit((values) => {
                  submitted = values
                })()
              }}
            >
              submit
            </button>
          </>
        )}
      </FormWrapper>,
    )

    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => {
      expect(submitted?.views).toBe(42)
    })

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => {
      expect(submitted?.views).toBeNull()
    })
  })

  it('does not warn about an input switching from uncontrolled to controlled', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={titleField} control={control} register={register} />
        )}
      </FormWrapper>,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })

    const logged = consoleError.mock.calls.flat().join(' ')
    expect(logged).not.toContain('uncontrolled')
    consoleError.mockRestore()
  })
})
