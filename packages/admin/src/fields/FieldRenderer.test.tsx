import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import type {
  ClientEmailField,
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
})
