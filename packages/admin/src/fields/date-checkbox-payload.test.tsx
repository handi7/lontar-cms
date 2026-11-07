// What the date and checkbox fields send to the API, pinned independently of
// how they are rendered (#118). Both started as native inputs bound with
// `register`; these ran against those first, and must stay green after the
// swap to a calendar popover and a Radix Checkbox.
//
// The harness goes through the same steps as CollectionFormView: Zod
// validation from the field definitions, computeDefaultValues for a new
// document, reset(formatDocForForm(doc)) once an existing one has loaded, and
// formatDocForSubmit on the way out. Date behaviour is pinned by ADR 0010.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useEffect, useMemo } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  clientFieldsToZod,
  type ClientCheckboxField,
  type ClientDateField,
  type ClientField,
} from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import {
  computeDefaultValues,
  formatDateForInput,
  formatDocForForm,
  formatDocForSubmit,
} from '../utils/form-utils'
import { FieldRenderer } from './FieldRenderer'

type Outcome = { payload: Record<string, unknown> } | { invalid: string[] }

function DocForm({
  fields,
  doc,
  onOutcome,
}: {
  fields: ClientField[]
  doc?: Record<string, unknown>
  onOutcome: (outcome: Outcome) => void
}) {
  const schema = useMemo(() => clientFieldsToZod(fields), [fields])
  const { control, register, setValue, watch, reset, handleSubmit, formState } = useForm<
    Record<string, unknown>
  >({
    resolver: zodResolver(schema),
    defaultValues: computeDefaultValues(fields),
  })

  useEffect(() => {
    if (doc) reset(formatDocForForm(fields, doc))
  }, [doc, fields, reset])

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(
          (values) => onOutcome({ payload: formatDocForSubmit(fields, values) }),
          (errors) => onOutcome({ invalid: Object.keys(errors) }),
        )(e)
      }}
    >
      {fields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          control={control}
          register={register}
          setValue={setValue}
          watch={watch}
          mode={doc ? 'edit' : 'create'}
          error={formState.errors[field.name]}
        />
      ))}
      <button type="submit">Save</button>
    </form>
  )
}

function renderForm(fields: ClientField[], doc?: Record<string, unknown>) {
  const state: { outcome?: Outcome } = {}
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PortalContainerProvider>
        <DocForm fields={fields} doc={doc} onOutcome={(o) => (state.outcome = o)} />
      </PortalContainerProvider>
    </QueryClientProvider>,
  )
  return state
}

async function save(state: { outcome?: Outcome }): Promise<Outcome> {
  state.outcome = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return waitFor(() => {
    const { outcome } = state
    if (!outcome) throw new Error('form has not submitted yet')
    return outcome
  })
}

async function savedPayload(state: { outcome?: Outcome }): Promise<Record<string, unknown>> {
  const outcome = await save(state)
  if (!('payload' in outcome)) throw new Error(`invalid: ${outcome.invalid.join(', ')}`)
  return outcome.payload
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function dateField(required: boolean): ClientDateField {
  return { name: 'publishedAt', type: 'date', label: 'Published At', required }
}

function dateControl(): HTMLElement {
  return screen.getByLabelText(/^published at/i)
}

/** Opens the calendar popover; a native input has nothing to open. */
function openPicker(control: HTMLElement) {
  if (control instanceof HTMLInputElement) return
  if (control.getAttribute('aria-expanded') !== 'true') fireEvent.click(control)
}

/** Picks a day (YYYY-MM-DD) in the month already on screen, keeping the time. */
function pickDay(isoDay: string) {
  const control = dateControl()
  if (control instanceof HTMLInputElement) {
    const time = control.value.slice(10)
    fireEvent.change(control, { target: { value: `${isoDay}${time}` } })
    return
  }
  openPicker(control)
  const [y, m, d] = isoDay.split('-').map(Number)
  const name = new RegExp(`${MONTHS[(m ?? 1) - 1]} ${d}(st|nd|rd|th)?, ${y}`)
  fireEvent.click(screen.getByRole('button', { name }))
}

/** Sets the time (HH:mm or HH:mm:ss), keeping the day. */
function setTime(time: string) {
  const control = dateControl()
  if (control instanceof HTMLInputElement) {
    fireEvent.change(control, { target: { value: `${control.value.slice(0, 10)}T${time}` } })
    return
  }
  openPicker(control)
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: time } })
}

function clearDate() {
  const control = dateControl()
  if (control instanceof HTMLInputElement) {
    fireEvent.change(control, { target: { value: '' } })
    return
  }
  openPicker(control)
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
}

// UTC; a whole-hour offset east; a zone with DST (2026-03-08 is the day New
// York springs forward); and a quarter-hour offset that also has DST.
const ZONES = ['UTC', 'Asia/Jakarta', 'America/New_York', 'Pacific/Chatham']

// 07:30:15Z on the New York DST day: 03:30:15 EDT, an hour after the jump.
const STORED = '2026-03-08T07:30:15.000Z'

describe.each(ZONES)('date field payload in %s', (zone) => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = zone
  })

  afterEach(() => {
    cleanup()
    process.env.TZ = originalTz
  })

  it('sends a stored instant back unchanged when the field is not touched', async () => {
    const state = renderForm([dateField(true)], { publishedAt: STORED })
    expect((await savedPayload(state)).publishedAt).toBe(STORED)
  })

  it('sends a whole-minute instant back unchanged', async () => {
    const stored = '2026-11-01T03:00:00.000Z'
    const state = renderForm([dateField(true)], { publishedAt: stored })
    expect((await savedPayload(state)).publishedAt).toBe(stored)
  })

  it('keeps the local time of day when a different day is picked', async () => {
    const state = renderForm([dateField(true)], { publishedAt: STORED })
    const local = formatDateForInput(STORED)
    const month = local.slice(0, 8)

    pickDay(`${month}20`)

    const expected = new Date(`${month}20${local.slice(10)}`).toISOString()
    expect((await savedPayload(state)).publishedAt).toBe(expected)
  })

  it('keeps the day when only the time is changed', async () => {
    const state = renderForm([dateField(true)], { publishedAt: STORED })
    const localDay = formatDateForInput(STORED).slice(0, 10)

    setTime('18:45:30')

    const expected = new Date(`${localDay}T18:45:30`).toISOString()
    expect((await savedPayload(state)).publishedAt).toBe(expected)
  })
})

describe('date field payload, empty values', () => {
  afterEach(cleanup)

  it('sends null for an untouched optional date on a new document', async () => {
    const state = renderForm([dateField(false)])
    expect((await savedPayload(state)).publishedAt).toBeNull()
  })

  it('refuses to submit an untouched required date on a new document', async () => {
    const state = renderForm([dateField(true)])
    expect(await save(state)).toEqual({ invalid: ['publishedAt'] })
  })

  it('sends null once an optional date is cleared', async () => {
    const state = renderForm([dateField(false)], { publishedAt: STORED })
    clearDate()
    expect((await savedPayload(state)).publishedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

const checkboxField: ClientCheckboxField = {
  name: 'featured',
  type: 'checkbox',
  label: 'Featured',
  required: false,
}

function checkbox(): HTMLElement {
  return screen.getByRole('checkbox', { name: /^featured/i })
}

describe('checkbox field payload', () => {
  afterEach(cleanup)

  it('sends false for an untouched checkbox on a new document', async () => {
    const state = renderForm([checkboxField])
    expect((await savedPayload(state)).featured).toBe(false)
  })

  it('sends true once checked and false once unchecked again', async () => {
    const state = renderForm([checkboxField])

    fireEvent.click(checkbox())
    expect((await savedPayload(state)).featured).toBe(true)

    fireEvent.click(checkbox())
    expect((await savedPayload(state)).featured).toBe(false)
  })

  it('sends a stored true back unchanged when the field is not touched', async () => {
    const state = renderForm([checkboxField], { featured: true })
    expect((await savedPayload(state)).featured).toBe(true)
  })

  it('sends a stored false back unchanged when the field is not touched', async () => {
    const state = renderForm([checkboxField], { featured: false })
    expect((await savedPayload(state)).featured).toBe(false)
  })

  // A document created through the API without this field stores null. The
  // native checkbox showed it unchecked and sent the null back untouched, and
  // a click made it true. Radix also has an 'indeterminate' state; the field
  // must never submit it, so null may not be rendered as indeterminate.
  it('sends a stored null back unchanged, and true once clicked', async () => {
    const state = renderForm([checkboxField], { featured: null })
    expect(
      checkbox().getAttribute('aria-checked') ?? String((checkbox() as HTMLInputElement).checked),
    ).not.toBe('mixed')
    expect((await savedPayload(state)).featured).toBeNull()

    fireEvent.click(checkbox())
    expect((await savedPayload(state)).featured).toBe(true)
  })
})
