import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import {
  useForm,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
  type UseFormSetError,
  type FieldErrors,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { clientFieldsToZod, type ClientField, type ClientGlobal } from '@lontar/core/client'
import { useAdmin, useGlobal } from '../context/AdminContext'
import { fetchGlobal, saveGlobal, ApiClientError } from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import { computeDefaultValues, formatDocForForm, formatDocForSubmit } from '../utils/form-utils'
import { NotFoundView } from './NotFoundView'
import { Alert } from '../components/ui/alert'
import { Card } from '../components/ui/card'
import { EmptyCard } from './EmptyCard'
import { ViewHeader } from './ViewHeader'
import { GlobalBreadcrumbs } from './FormBreadcrumbs'
import { DocumentSidebar } from './DocumentSidebar'

export interface GlobalFormFieldsProps {
  fields: ClientField[]
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
}

function GlobalFormFields({
  fields,
  control,
  register,
  setValue,
  watch,
  errors,
}: GlobalFormFieldsProps) {
  return (
    <div className="lt:w-full lg:lt:max-w-[760px] lt:min-w-0 lt:flex-1">
      <Card className="lt:block lt:p-8 lt:shadow-none">
        <div className="lt:flex lt:flex-col lt:gap-6">
          {fields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              control={control}
              register={register}
              setValue={setValue}
              watch={watch}
              mode="edit"
              error={errors[field.name]}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

export interface UseGlobalSaveMutationOptions {
  apiBase: string
  slug: string
  fields: ClientField[]
  reset: (values?: Record<string, unknown>) => void
  setError?: UseFormSetError<Record<string, unknown>>
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
}

function useGlobalSaveMutation({
  apiBase,
  slug,
  fields,
  reset,
  setError,
  setApiError,
  setSuccessMsg,
}: UseGlobalSaveMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      setApiError(null)
      setSuccessMsg(null)
      return saveGlobal(apiBase, slug, formatDocForSubmit(fields, values))
    },
    onSuccess: (saved) => {
      reset(formatDocForForm(fields, saved))
      setSuccessMsg('Changes saved successfully.')
      void queryClient.invalidateQueries({ queryKey: ['globals', slug] })
    },
    onError: (err: Error) => {
      if (err instanceof ApiClientError && err.issues && setError) {
        for (const issue of err.issues) {
          const fieldName = issue.path?.[0]
          if (fieldName !== undefined) {
            setError(String(fieldName), { message: issue.message })
          }
        }
      }
      setApiError(err.message || 'Failed to save changes.')
    },
  })
}

export interface GlobalStatusAlertsProps {
  apiError: string | null
  successMsg: string | null
}

function GlobalStatusAlerts({ apiError, successMsg }: GlobalStatusAlertsProps) {
  if (apiError) {
    return (
      <Alert variant="destructive" className="lt:mb-5">
        {apiError}
      </Alert>
    )
  }
  if (successMsg) {
    return (
      <Alert variant="success" role="status" className="lt:mb-5">
        {successMsg}
      </Alert>
    )
  }
  return null
}

export interface GlobalQueryStateProps {
  isLoading: boolean
  error: Error | null
}

function GlobalQueryState({ isLoading, error }: GlobalQueryStateProps) {
  if (isLoading) return <EmptyCard>Loading global...</EmptyCard>
  if (error) return <Alert variant="destructive">{error.message}</Alert>
  return null
}

export interface GlobalEditorProps {
  global: ClientGlobal
  slug: string
  apiBase: string
}

function GlobalEditor({ global, slug, apiBase }: GlobalEditorProps) {
  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const globalQuery = useQuery({
    queryKey: ['globals', slug],
    queryFn: () => fetchGlobal(apiBase, slug),
    refetchOnWindowFocus: false,
  })

  const schema = useMemo(() => clientFieldsToZod(global.fields), [global])
  const defaultValues = useMemo(() => computeDefaultValues(global.fields), [global])

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  useEffect(() => {
    if (globalQuery.data && !isDirty) {
      reset(formatDocForForm(global.fields, globalQuery.data))
    }
  }, [globalQuery.data, global, reset, isDirty])

  const saveMutation = useGlobalSaveMutation({
    apiBase,
    slug,
    fields: global.fields,
    reset,
    setError,
    setApiError,
    setSuccessMsg,
  })

  if (globalQuery.isLoading || globalQuery.error) {
    return <GlobalQueryState isLoading={globalQuery.isLoading} error={globalQuery.error} />
  }

  const isSaving = isSubmitting || saveMutation.isPending
  const submitLabel = isSaving ? 'Saving...' : 'Save Changes'

  return (
    <div>
      <ViewHeader title={global.label} breadcrumbs={<GlobalBreadcrumbs label={global.label} />} />

      <GlobalStatusAlerts apiError={apiError} successMsg={successMsg} />

      <form
        onSubmit={(e) => {
          void handleSubmit((v) => {
            saveMutation.mutate(v)
          })(e)
        }}
        className="lt:flex lt:flex-col lg:lt:flex-row lt:gap-8 lt:items-start"
      >
        <GlobalFormFields
          fields={global.fields}
          control={control}
          register={register}
          setValue={setValue}
          watch={watch}
          errors={errors}
        />

        <DocumentSidebar
          mode="edit"
          submitLabel={submitLabel}
          isPending={isSaving}
          showDelete={false}
          showId={false}
          doc={globalQuery.data}
        />
      </form>
    </div>
  )
}

export function GlobalFormView() {
  const { apiBase } = useAdmin()
  const { slug } = useParams({ strict: false })
  const global = useGlobal(slug)

  if (!global || !slug) return <NotFoundView />

  return <GlobalEditor global={global} slug={slug} apiBase={apiBase} />
}
