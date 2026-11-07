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
import { clientFieldsToZod, type ClientField } from '@lontar/core/client'
import { useAdmin, useGlobal } from '../context/AdminContext'
import { fetchGlobal, saveGlobal, ApiClientError } from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import { computeDefaultValues, formatDocForForm, formatDocForSubmit } from '../utils/form-utils'
import { NotFoundView } from './NotFoundView'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyCard } from './EmptyCard'
import { ViewHeader } from './ViewHeader'

function GlobalMeta({ doc }: { doc?: Record<string, unknown> | null }) {
  if (!doc || (!doc.createdAt && !doc.updatedAt)) return null
  return (
    <div className="lt:mt-1.5 lt:flex lt:gap-4 lt:text-[0.8125rem] lt:text-muted-foreground">
      {typeof doc.createdAt === 'string' && (
        <span>
          <strong>Created:</strong> {new Date(doc.createdAt).toLocaleString()}
        </span>
      )}
      {typeof doc.updatedAt === 'string' && (
        <span>
          <strong>Updated:</strong> {new Date(doc.updatedAt).toLocaleString()}
        </span>
      )}
    </div>
  )
}

function GlobalFormBody({
  fields,
  control,
  register,
  setValue,
  watch,
  errors,
  isPending,
  onSubmit,
}: {
  fields: ClientField[]
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  isPending: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <Card className="lt:block lt:p-8 lt:shadow-none">
      <form onSubmit={onSubmit}>
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

        <div className="lt:mt-8 lt:flex lt:gap-3 lt:border-t lt:pt-6">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function useGlobalSaveMutation({
  apiBase,
  slug,
  fields,
  reset,
  setError,
  setApiError,
  setSuccessMsg,
}: {
  apiBase: string
  slug: string
  fields: ClientField[]
  reset: (values?: Record<string, unknown>) => void
  setError?: UseFormSetError<Record<string, unknown>>
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
}) {
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

function GlobalStatusAlerts({
  apiError,
  successMsg,
}: {
  apiError: string | null
  successMsg: string | null
}) {
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

function GlobalQueryState({ isLoading, error }: { isLoading: boolean; error: Error | null }) {
  if (isLoading) return <EmptyCard>Loading global...</EmptyCard>
  if (error) return <Alert variant="destructive">{error.message}</Alert>
  return null
}

export function GlobalFormView() {
  const { apiBase } = useAdmin()
  const { slug } = useParams({ strict: false })
  const global = useGlobal(slug)

  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const globalQuery = useQuery({
    queryKey: ['globals', slug],
    queryFn: () => (slug ? fetchGlobal(apiBase, slug) : null),
    enabled: Boolean(slug && global),
    refetchOnWindowFocus: false,
  })

  const schema = useMemo(() => {
    return global ? clientFieldsToZod(global.fields) : undefined
  }, [global])

  const defaultValues = useMemo(() => {
    return global ? computeDefaultValues(global.fields) : {}
  }, [global])

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
    resolver: schema ? zodResolver(schema) : undefined,
    defaultValues,
  })

  useEffect(() => {
    if (globalQuery.data && global && !isDirty) {
      reset(formatDocForForm(global.fields, globalQuery.data))
    }
  }, [globalQuery.data, global, reset, isDirty])

  const saveMutation = useGlobalSaveMutation({
    apiBase,
    slug: slug ?? '',
    fields: global?.fields ?? [],
    reset,
    setError,
    setApiError,
    setSuccessMsg,
  })

  if (!global) return <NotFoundView />
  if (globalQuery.isLoading || globalQuery.error) {
    return <GlobalQueryState isLoading={globalQuery.isLoading} error={globalQuery.error} />
  }

  return (
    <div>
      <ViewHeader title={global.label}>
        <GlobalMeta doc={globalQuery.data} />
      </ViewHeader>

      <GlobalStatusAlerts apiError={apiError} successMsg={successMsg} />

      <GlobalFormBody
        fields={global.fields}
        control={control}
        register={register}
        setValue={setValue}
        watch={watch}
        errors={errors}
        isPending={isSubmitting || saveMutation.isPending}
        onSubmit={(e) => {
          void handleSubmit((v) => {
            saveMutation.mutate(v)
          })(e)
        }}
      />
    </div>
  )
}
