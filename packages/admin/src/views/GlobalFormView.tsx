import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import {
  useForm,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
  type FieldErrors,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { clientFieldsToZod, type ClientField } from '@lontar/core/client'
import { useAdmin, useGlobal } from '../context/AdminContext'
import { fetchGlobal, saveGlobal } from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import { NotFoundView } from './NotFoundView'

function GlobalMeta({ doc }: { doc?: Record<string, unknown> | null }) {
  if (!doc || (!doc.createdAt && !doc.updatedAt)) return null
  return (
    <div className="lontar-doc-meta">
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

function getFieldDefault(f: ClientField): unknown {
  if ('defaultValue' in f && f.defaultValue !== undefined) {
    if (f.type === 'date' && typeof f.defaultValue === 'string') {
      const d = new Date(f.defaultValue)
      return !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 16) : f.defaultValue
    }
    return f.defaultValue
  }
  if (f.type === 'checkbox') return false
  if (f.type === 'relationship' && f.hasMany) return []
  return undefined
}

function computeDefaultValues(fields: ClientField[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const f of fields) {
    const val = getFieldDefault(f)
    if (val !== undefined) {
      defaults[f.name] = val
    }
  }
  return defaults
}

function extractIdFromItem(item: unknown): number | null {
  if (typeof item === 'number' && item > 0) return item
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const id = (item as Record<string, unknown>).id
    if (typeof id === 'number' && id > 0) return id
  }
  return null
}

function normalizeRelationshipValue(val: unknown, hasMany?: boolean): unknown {
  if (hasMany) {
    if (!Array.isArray(val)) return []
    return (val as unknown[]).map(extractIdFromItem).filter((id): id is number => id !== null)
  }
  return extractIdFromItem(val) ?? val
}

function formatFieldForForm(f: ClientField, val: unknown): unknown {
  if (f.type === 'date' && typeof val === 'string') {
    const d = new Date(val)
    return !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 16) : val
  }
  if (f.type === 'relationship') {
    return normalizeRelationshipValue(val, f.hasMany)
  }
  return val
}

function formatDocForForm(
  fields: ClientField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formatted = { ...data }
  for (const f of fields) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldForForm(f, formatted[f.name])
    }
  }
  return formatted
}

function GlobalFormBody({
  fields,
  register,
  setValue,
  watch,
  errors,
  isPending,
  onSubmit,
}: {
  fields: ClientField[]
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  isPending: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit} className="lontar-form">
      <div className="lontar-form-fields">
        {fields.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            register={register}
            setValue={setValue}
            watch={watch}
            mode="edit"
            error={errors[field.name]}
          />
        ))}
      </div>

      <div className="lontar-form-footer">
        <button type="submit" className="lontar-btn lontar-btn-primary" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

function useGlobalSaveMutation({
  apiBase,
  slug,
  fields,
  reset,
  setApiError,
  setSuccessMsg,
}: {
  apiBase: string
  slug: string
  fields: ClientField[]
  reset: (values?: Record<string, unknown>) => void
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      setApiError(null)
      setSuccessMsg(null)
      return saveGlobal(apiBase, slug, values)
    },
    onSuccess: (saved) => {
      reset(formatDocForForm(fields, saved))
      setSuccessMsg('Changes saved successfully.')
      void queryClient.invalidateQueries({ queryKey: ['globals', slug] })
    },
    onError: (err: Error) => {
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
  if (apiError) return <div className="lontar-alert lontar-alert-error">{apiError}</div>
  if (successMsg) return <div className="lontar-alert lontar-alert-success">{successMsg}</div>
  return null
}

function GlobalQueryState({ isLoading, error }: { isLoading: boolean; error: Error | null }) {
  if (isLoading) return <div className="lontar-loading">Loading global...</div>
  if (error) return <div className="lontar-alert lontar-alert-error">{error.message}</div>
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
  })

  const schema = useMemo(() => {
    return global ? clientFieldsToZod(global.fields) : undefined
  }, [global])

  const defaultValues = useMemo(() => {
    return global ? computeDefaultValues(global.fields) : {}
  }, [global])

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, unknown>>({
    resolver: schema ? zodResolver(schema) : undefined,
    defaultValues,
  })

  useEffect(() => {
    if (globalQuery.data && global) {
      reset(formatDocForForm(global.fields, globalQuery.data))
    }
  }, [globalQuery.data, global, reset])

  const saveMutation = useGlobalSaveMutation({
    apiBase,
    slug: slug ?? '',
    fields: global?.fields ?? [],
    reset,
    setApiError,
    setSuccessMsg,
  })

  if (!global) return <NotFoundView />
  if (globalQuery.isLoading || globalQuery.error) {
    return <GlobalQueryState isLoading={globalQuery.isLoading} error={globalQuery.error} />
  }

  return (
    <div className="lontar-collection-form">
      <header className="lontar-view-header">
        <div>
          <h1>{global.label}</h1>
          <GlobalMeta doc={globalQuery.data} />
        </div>
      </header>

      <GlobalStatusAlerts apiError={apiError} successMsg={successMsg} />

      <GlobalFormBody
        fields={global.fields}
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
