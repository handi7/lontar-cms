import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import type {
  ClientCheckboxField,
  ClientDateField,
  ClientEmailField,
  ClientRichTextField,
  ClientSelectField,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
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
  const methods = useForm<Record<string, unknown>>({ defaultValues })
  return <form>{children(methods)}</form>
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
        {({ register }) => <FieldRenderer field={field} register={register} />}
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
    }

    const { container } = render(
      <FormWrapper>
        {({ register }) => <FieldRenderer field={field} register={register} />}
      </FormWrapper>,
    )

    const input = container.querySelector('input#email') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('email')
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
        {({ register, setValue, watch }) => (
          <>
            <FieldRenderer field={titleField} register={register} />
            <FieldRenderer
              field={slugField}
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
        {({ register, setValue, watch }) => (
          <>
            <FieldRenderer field={titleField} register={register} />
            <FieldRenderer
              field={slugField}
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
        {({ register }) => (
          <FieldRenderer
            field={field}
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
        {({ register }) => <FieldRenderer field={field} register={register} />}
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
        {({ register }) => <FieldRenderer field={field} register={register} />}
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
        {({ register }) => <FieldRenderer field={field} register={register} />}
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
        {({ register, setValue, watch }) => (
          <FieldRenderer field={field} register={register} setValue={setValue} watch={watch} />
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
})
