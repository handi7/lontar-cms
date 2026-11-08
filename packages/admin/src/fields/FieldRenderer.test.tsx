import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type {
  ClientArrayField,
  ClientBlocksField,
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
import { PortalContainerProvider } from '../context/PortalContainer'
import { chooseSelectOption } from '../test/radix'
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
      <PortalContainerProvider>
        <form>{children(methods)}</form>
      </PortalContainerProvider>
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

    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Email Address' })
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

    render(
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

    const titleInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^title/i })
    const slugInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^slug/i })
    const syncBtn = screen.getByRole('button', { name: /sync/i })

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

    render(
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

    const titleInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^title/i })
    const slugInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^slug/i })

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

    render(
      <FormWrapper defaultValues={{ isPublished: false }}>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Published' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Published')).toBeTruthy()

    fireEvent.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    // The label toggles it too, as it did for the native checkbox.
    fireEvent.click(screen.getByText('Published'))
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
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

    render(
      <FormWrapper defaultValues={{ status: 'draft' }}>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const trigger = screen.getByRole('combobox', { name: /^status/i })
    expect(trigger.textContent).toBe('Draft')
    expect(trigger.getAttribute('aria-required')).toBe('true')

    chooseSelectOption(trigger, 'Published')
    expect(trigger.textContent).toBe('Published')
  })

  it('lists every option, and an empty choice only when the select is optional', () => {
    const options = [
      { label: 'Draft', value: 'draft' },
      { label: 'Published', value: 'published' },
    ]

    const { unmount } = render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer
            field={{ name: 'status', type: 'select', label: 'Status', required: true, options }}
            control={control}
            register={register}
          />
        )}
      </FormWrapper>,
    )
    fireEvent.keyDown(screen.getByRole('combobox', { name: /^status/i }), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Draft', 'Published'])
    unmount()

    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer
            field={{ name: 'status', type: 'select', label: 'Status', required: false, options }}
            control={control}
            register={register}
          />
        )}
      </FormWrapper>,
    )
    fireEvent.keyDown(screen.getByRole('combobox', { name: /^status/i }), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '-- Select --',
      'Draft',
      'Published',
    ])
  })

  it('renders the date as a labelled picker showing the stored local time', () => {
    const field: ClientDateField = {
      name: 'publishedAt',
      type: 'date',
      label: 'Publish Date',
      required: true,
    }

    render(
      <FormWrapper defaultValues={{ publishedAt: '2026-11-01T10:00' }}>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const trigger = screen.getByLabelText(/^publish date/i)
    expect(trigger.getAttribute('aria-required')).toBe('true')
    expect(trigger.textContent).toBe(
      new Date(2026, 10, 1, 10, 0).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    )

    fireEvent.click(trigger)
    expect(
      screen.getByRole('button', { name: /November 1(st)?, 2026/ }).closest('[data-selected]'),
    ).not.toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Time').value).toBe('10:00')
    // Required, so there is nothing to clear to.
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('offers Clear on an optional date, and shows a placeholder when empty', () => {
    const field: ClientDateField = {
      name: 'publishedAt',
      type: 'date',
      label: 'Publish Date',
      required: false,
    }

    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer field={field} control={control} register={register} />
        )}
      </FormWrapper>,
    )

    const trigger = screen.getByLabelText(/^publish date/i)
    expect(trigger.textContent).toBe('Pick a date')

    fireEvent.click(trigger)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear' }).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Time').disabled).toBe(true)
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

// What a select field submits, pinned independently of how it is rendered. The
// field started as a native <select> bound with `register`, where
// react-hook-form reads the DOM's current value as the initial one: an untouched
// required select submits its first option and an untouched optional one
// submits ''. A Radix Select has no DOM value to read, so a naive swap would
// submit undefined for both. These ran green against the native select before
// it was replaced, and must stay green after.
describe('select field payload', () => {
  afterEach(() => {
    cleanup()
  })

  const options = [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ]

  function renderSelect(field: ClientSelectField, defaultValues: Record<string, unknown> = {}) {
    const result: { submitted?: Record<string, unknown> } = {}
    render(
      <FormWrapper defaultValues={defaultValues}>
        {({ control, register, handleSubmit }) => (
          <>
            <FieldRenderer field={field} control={control} register={register} />
            <button
              type="button"
              onClick={() => {
                void handleSubmit((values) => {
                  result.submitted = values
                })()
              }}
            >
              submit
            </button>
          </>
        )}
      </FormWrapper>,
    )
    return result
  }

  // Works against either rendering: a native <select> takes a change event, a
  // Radix trigger takes the pointer sequence in chooseSelectOption.
  function pick(label: string) {
    const control = screen.getByRole('combobox', { name: /^status/i })
    if (control instanceof HTMLSelectElement) {
      const option = Array.from(control.options).find((o) => o.text === label)
      fireEvent.change(control, { target: { value: option?.value } })
    } else {
      chooseSelectOption(control, label)
    }
  }

  async function submit(result: { submitted?: Record<string, unknown> }) {
    result.submitted = undefined
    fireEvent.click(screen.getByText('submit'))
    return waitFor(() => {
      const { submitted } = result
      if (!submitted) throw new Error('form has not submitted yet')
      return submitted
    })
  }

  it('submits the first option for an untouched required select with no default', async () => {
    const result = renderSelect({
      name: 'status',
      type: 'select',
      label: 'Status',
      required: true,
      options,
    })
    expect((await submit(result)).status).toBe('draft')
  })

  // The one case that could not be run against the native <select> first.
  // happy-dom leaves HTMLSelectElement.size and option.defaultSelected
  // undefined (a browser has 0 and false), so react-hook-form's isSelectEdited
  // concludes the select was edited and reads the DOM's first option instead of
  // the default. In a browser the default wins, which is what this asserts.
  it('submits the default for an untouched select that has one', async () => {
    const result = renderSelect(
      { name: 'status', type: 'select', label: 'Status', required: true, options },
      { status: 'published' },
    )
    expect((await submit(result)).status).toBe('published')
  })

  it('submits an empty string for an untouched optional select', async () => {
    const result = renderSelect({
      name: 'status',
      type: 'select',
      label: 'Status',
      required: false,
      options,
    })
    expect((await submit(result)).status).toBe('')
  })

  it('submits the chosen option, and an empty string once cleared', async () => {
    const result = renderSelect({
      name: 'status',
      type: 'select',
      label: 'Status',
      required: false,
      options,
    })

    pick('Published')
    expect((await submit(result)).status).toBe('published')

    pick('-- Select --')
    expect((await submit(result)).status).toBe('')
  })
})

describe('group field rendering and binding', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a fieldset with legend and child fields', () => {
    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer
            field={{
              name: 'seo',
              type: 'group',
              label: 'SEO Settings',
              required: true,
              fields: [
                { name: 'metaTitle', type: 'text', label: 'Meta Title', required: true },
                {
                  name: 'metaDescription',
                  type: 'textarea',
                  label: 'Meta Description',
                  required: false,
                },
              ],
            }}
            control={control}
            register={register}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('SEO Settings')).toBeTruthy()
    expect(screen.getByLabelText(/Meta Title/)).toBeTruthy()
    expect(screen.getByLabelText(/Meta Description/)).toBeTruthy()
  })

  it('submits nested object with dot-notated registered inputs', async () => {
    let submittedData: Record<string, unknown> | undefined

    render(
      <FormWrapper
        defaultValues={{ seo: { metaTitle: 'Initial Title', metaDescription: 'Initial Desc' } }}
      >
        {({ control, register, handleSubmit }) => (
          <>
            <FieldRenderer
              field={{
                name: 'seo',
                type: 'group',
                label: 'SEO',
                required: false,
                fields: [
                  { name: 'metaTitle', type: 'text', label: 'Meta Title', required: true },
                  {
                    name: 'metaDescription',
                    type: 'textarea',
                    label: 'Meta Description',
                    required: false,
                  },
                ],
              }}
              control={control}
              register={register}
            />
            <button
              type="button"
              onClick={() => {
                void handleSubmit((data) => {
                  submittedData = data
                })()
              }}
            >
              Save
            </button>
          </>
        )}
      </FormWrapper>,
    )

    const titleInput = screen.getByLabelText(/Meta Title/)
    fireEvent.change(titleInput, { target: { value: 'Updated Title' } })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(submittedData).toEqual({
        seo: {
          metaTitle: 'Updated Title',
          metaDescription: 'Initial Desc',
        },
      })
    })
  })

  it('displays nested validation error on subfield', () => {
    render(
      <FormWrapper>
        {({ control, register }) => (
          <FieldRenderer
            field={{
              name: 'seo',
              type: 'group',
              label: 'SEO',
              required: false,
              fields: [{ name: 'metaTitle', type: 'text', label: 'Meta Title', required: true }],
            }}
            control={control}
            register={register}
            error={{
              metaTitle: { message: 'Meta title is required' },
            }}
          />
        )}
      </FormWrapper>,
    )

    expect(screen.getByText('Meta title is required')).toBeTruthy()
  })

  describe('array field', () => {
    const arrayField: ClientArrayField = {
      name: 'gallery',
      type: 'array',
      label: 'Photo Gallery',
      required: false,
      labels: { singular: 'Photo', plural: 'Photos' },
      admin: { description: 'Upload photos with captions', rowLabel: 'caption' },
      fields: [
        { name: 'caption', type: 'text', label: 'Caption', required: true },
        { name: 'author', type: 'text', label: 'Author', required: false },
      ],
    }

    it('renders empty array with Add button and appends a row when clicked', async () => {
      render(
        <FormWrapper defaultValues={{ gallery: [] }}>
          {({ control, register, watch }) => (
            <FieldRenderer field={arrayField} control={control} register={register} watch={watch} />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Photo Gallery')).toBeTruthy()
      expect(screen.getByText('Upload photos with captions')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Add Photo' })).toBeTruthy()

      // Click Add Photo
      fireEvent.click(screen.getByRole('button', { name: 'Add Photo' }))

      // A new row is added with label Caption
      await waitFor(() => {
        expect(screen.getByLabelText(/Caption/)).toBeTruthy()
      })
    })

    it('supports add, move up/down, duplicate, and remove operations', async () => {
      let submittedData: unknown = null

      render(
        <FormWrapper
          defaultValues={{
            gallery: [
              { id: '1', caption: 'Pic A', author: 'Alice' },
              { id: '2', caption: 'Pic B', author: 'Bob' },
            ],
          }}
        >
          {({ control, register, watch, handleSubmit }) => (
            <>
              <FieldRenderer
                field={arrayField}
                control={control}
                register={register}
                watch={watch}
              />
              <button
                type="button"
                onClick={() => {
                  void handleSubmit((data) => {
                    submittedData = data
                  })()
                }}
              >
                Save
              </button>
            </>
          )}
        </FormWrapper>,
      )

      // Both rows should show their captions in the row headers
      expect(screen.getByText('Pic A')).toBeTruthy()
      expect(screen.getByText('Pic B')).toBeTruthy()

      // Reorder: Move second row up
      const moveUpButtons = screen.getAllByRole('button', { name: 'Move row up' })
      expect((moveUpButtons[0] as HTMLButtonElement).disabled).toBe(true)
      expect((moveUpButtons[1] as HTMLButtonElement).disabled).toBe(false)

      fireEvent.click(moveUpButtons[1]!)

      // Save and verify order swapped
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => {
        expect(submittedData).toMatchObject({
          gallery: [
            { caption: 'Pic B', author: 'Bob' },
            { caption: 'Pic A', author: 'Alice' },
          ],
        })
      })

      // Duplicate the first row (now Pic B)
      const duplicateButtons = screen.getAllByRole('button', { name: 'Duplicate row' })
      fireEvent.click(duplicateButtons[0]!)

      // There should now be 3 rows
      await waitFor(() => {
        const removeButtons = screen.getAllByRole('button', { name: 'Remove row' })
        expect(removeButtons).toHaveLength(3)
      })

      // Remove the last row
      const removeButtons = screen.getAllByRole('button', { name: 'Remove row' })
      fireEvent.click(removeButtons[2]!)

      await waitFor(() => {
        const currentRemoveButtons = screen.getAllByRole('button', { name: 'Remove row' })
        expect(currentRemoveButtons).toHaveLength(2)
      })
    })

    it('toggles collapse on row header click', () => {
      render(
        <FormWrapper
          defaultValues={{
            gallery: [{ id: '1', caption: 'Sample Photo', author: 'Charlie' }],
          }}
        >
          {({ control, register, watch }) => (
            <FieldRenderer field={arrayField} control={control} register={register} watch={watch} />
          )}
        </FormWrapper>,
      )

      // Initially open: input is present
      expect(screen.getByLabelText(/Caption/)).toBeTruthy()

      // Click row header button to collapse
      const collapseToggle = screen.getByRole('button', { name: 'Collapse Sample Photo' })
      fireEvent.click(collapseToggle)

      // Now collapsed: input is removed
      expect(screen.queryByLabelText(/Caption/)).toBeNull()

      // Click to expand again
      const expandToggle = screen.getByRole('button', { name: 'Expand Sample Photo' })
      fireEvent.click(expandToggle)
      expect(screen.getByLabelText(/Caption/)).toBeTruthy()
    })

    it('renders root-level array error and row-level subfield error', () => {
      render(
        <FormWrapper
          defaultValues={{
            gallery: [{ id: '1', caption: '', author: '' }],
          }}
        >
          {({ control, register, watch }) => (
            <FieldRenderer
              field={arrayField}
              control={control}
              register={register}
              watch={watch}
              error={{
                message: 'Must have at least 2 items',
                0: { caption: { message: 'Caption is required' } },
              }}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Must have at least 2 items')).toBeTruthy()
      expect(screen.getByText('Caption is required')).toBeTruthy()
    })
  })

  describe('BlocksFieldRenderer', () => {
    const blocksField: ClientBlocksField = {
      name: 'layout',
      type: 'blocks',
      label: 'Page Layout',
      required: false,
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: [
            { name: 'heading', type: 'text', label: 'Heading', required: true },
            { name: 'subheading', type: 'text', label: 'Subheading', required: false },
          ],
        },
        {
          slug: 'cta',
          labels: { singular: 'Call to Action', plural: 'Calls to Action' },
          fields: [
            { name: 'buttonText', type: 'text', label: 'Button Text', required: true },
            { name: 'buttonUrl', type: 'text', label: 'Button URL', required: true },
          ],
        },
      ],
    }

    it('renders empty blocks list with Add Block button', () => {
      render(
        <FormWrapper defaultValues={{ layout: [] }}>
          {({ control, register, watch }) => (
            <FieldRenderer
              field={blocksField}
              control={control}
              register={register}
              watch={watch}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Page Layout')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy()
    })

    it('adds blocks from the popover picker and updates form state', async () => {
      let submittedData: Record<string, unknown> | null = null

      render(
        <FormWrapper defaultValues={{ layout: [] }}>
          {({ control, register, watch, handleSubmit }) => (
            <div>
              <FieldRenderer
                field={blocksField}
                control={control}
                register={register}
                watch={watch}
              />
              <button
                type="button"
                onClick={() => {
                  void handleSubmit((data) => {
                    submittedData = data
                  })()
                }}
              >
                Save
              </button>
            </div>
          )}
        </FormWrapper>,
      )

      // Open popover by clicking Add block
      const addBtn = screen.getByRole('button', { name: 'Add block' })
      fireEvent.click(addBtn)

      // Both block options should be in the popover
      const heroChoice = screen.getByText('Hero')
      expect(heroChoice).toBeTruthy()
      expect(screen.getByText('Call to Action')).toBeTruthy()

      // Choose Hero block
      fireEvent.click(heroChoice)

      // Heading input should appear
      await waitFor(() => {
        expect(screen.getByLabelText(/Heading/)).toBeTruthy()
      })

      fireEvent.change(screen.getByLabelText(/Heading/), {
        target: { value: 'Welcome to our site' },
      })

      // Add a CTA block
      fireEvent.click(screen.getByRole('button', { name: 'Add block' }))
      const ctaChoice = screen.getByText('Call to Action')
      fireEvent.click(ctaChoice)

      await waitFor(() => {
        expect(screen.getByLabelText(/Button Text/)).toBeTruthy()
      })

      fireEvent.change(screen.getByLabelText(/Button Text/), {
        target: { value: 'Click Here' },
      })
      fireEvent.change(screen.getByLabelText(/Button URL/), {
        target: { value: 'https://example.com' },
      })

      // Submit and verify blockType and field values
      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(submittedData).toMatchObject({
          layout: [
            {
              blockType: 'hero',
              heading: 'Welcome to our site',
            },
            {
              blockType: 'cta',
              buttonText: 'Click Here',
              buttonUrl: 'https://example.com',
            },
          ],
        })
      })
    })

    it('supports reordering, duplicating, and removing blocks', async () => {
      let submittedData: Record<string, unknown> | null = null

      render(
        <FormWrapper
          defaultValues={{
            layout: [
              { id: '1', blockType: 'hero', heading: 'First Hero' },
              { id: '2', blockType: 'cta', buttonText: 'First CTA', buttonUrl: '/cta' },
            ],
          }}
        >
          {({ control, register, watch, handleSubmit }) => (
            <div>
              <FieldRenderer
                field={blocksField}
                control={control}
                register={register}
                watch={watch}
              />
              <button
                type="button"
                onClick={() => {
                  void handleSubmit((data) => {
                    submittedData = data
                  })()
                }}
              >
                Save
              </button>
            </div>
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Hero - First Hero')).toBeTruthy()
      expect(screen.getByText('Call to Action - First CTA')).toBeTruthy()

      // Move CTA up
      const moveUpButtons = screen.getAllByRole('button', { name: 'Move block up' })
      expect((moveUpButtons[0] as HTMLButtonElement).disabled).toBe(true)
      expect((moveUpButtons[1] as HTMLButtonElement).disabled).toBe(false)

      fireEvent.click(moveUpButtons[1]!)

      // Save and verify order swapped
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => {
        expect(submittedData).toMatchObject({
          layout: [
            { blockType: 'cta', buttonText: 'First CTA' },
            { blockType: 'hero', heading: 'First Hero' },
          ],
        })
      })

      // Duplicate the first block
      const duplicateButtons = screen.getAllByRole('button', { name: 'Duplicate block' })
      fireEvent.click(duplicateButtons[0]!)

      await waitFor(() => {
        const removeButtons = screen.getAllByRole('button', { name: 'Remove block' })
        expect(removeButtons).toHaveLength(3)
      })

      // Remove the last block
      const removeButtons = screen.getAllByRole('button', { name: 'Remove block' })
      fireEvent.click(removeButtons[2]!)

      await waitFor(() => {
        const currentRemoveButtons = screen.getAllByRole('button', { name: 'Remove block' })
        expect(currentRemoveButtons).toHaveLength(2)
      })
    })

    it('toggles collapse on block row header click', () => {
      render(
        <FormWrapper
          defaultValues={{
            layout: [{ id: '1', blockType: 'hero', heading: 'Hero Content' }],
          }}
        >
          {({ control, register, watch }) => (
            <FieldRenderer
              field={blocksField}
              control={control}
              register={register}
              watch={watch}
            />
          )}
        </FormWrapper>,
      )

      // Initially open
      expect(screen.getByLabelText(/Heading/)).toBeTruthy()

      // Click to collapse
      const collapseToggle = screen.getByRole('button', { name: 'Collapse Hero - Hero Content' })
      fireEvent.click(collapseToggle)

      // Input hidden
      expect(screen.queryByLabelText(/Heading/)).toBeNull()

      // Click to expand
      const expandToggle = screen.getByRole('button', { name: 'Expand Hero - Hero Content' })
      fireEvent.click(expandToggle)
      expect(screen.getByLabelText(/Heading/)).toBeTruthy()
    })

    it('renders root-level blocks error and block-level subfield error', () => {
      render(
        <FormWrapper
          defaultValues={{
            layout: [{ id: '1', blockType: 'hero', heading: '' }],
          }}
        >
          {({ control, register, watch }) => (
            <FieldRenderer
              field={blocksField}
              control={control}
              register={register}
              watch={watch}
              error={{
                message: 'Must have at least 2 blocks',
                0: { heading: { message: 'Heading is required' } },
              }}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Must have at least 2 blocks')).toBeTruthy()
      expect(screen.getByText('Heading is required')).toBeTruthy()
    })
  })
})
