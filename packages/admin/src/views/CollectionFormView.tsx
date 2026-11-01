import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  useForm,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
  type FieldErrors,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { clientFieldsToZod, type ClientCollection, type ClientField } from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import { fetchDoc, createDoc, updateDoc, deleteDoc } from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import { NotFoundView } from './NotFoundView'

function DocumentMeta({ doc }: { doc?: Record<string, unknown> | null }) {
  if (!doc) return null
  return (
    <div className="lontar-doc-meta">
      <span>
        <strong>ID:</strong> {String(doc.id)}
      </span>
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

function FormHeader({
  title,
  mode,
  collection,
  doc,
  isDeleting,
  onDelete,
}: {
  title: string
  mode: 'create' | 'edit'
  collection: ClientCollection
  doc?: Record<string, unknown> | null
  isDeleting: boolean
  onDelete: () => void
}) {
  return (
    <header className="lontar-view-header">
      <div>
        <h1>{title}</h1>
        {mode === 'edit' && <DocumentMeta doc={doc} />}
      </div>
      <div className="lontar-header-actions">
        {mode === 'edit' && (
          <button
            type="button"
            className="lontar-btn lontar-btn-danger"
            disabled={isDeleting}
            onClick={onDelete}
          >
            Delete
          </button>
        )}
        <Link
          to="/$collection"
          params={{ collection: collection.slug }}
          className="lontar-btn lontar-btn-secondary"
        >
          Cancel
        </Link>
      </div>
    </header>
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

function computeDefaultValues(collection?: ClientCollection): Record<string, unknown> {
  if (!collection) return {}
  const defaults: Record<string, unknown> = {}
  for (const f of collection.fields) {
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
  collection: ClientCollection,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formatted = { ...data }
  for (const f of collection.fields) {
    if (f.name in formatted) {
      formatted[f.name] = formatFieldForForm(f, formatted[f.name])
    }
  }
  return formatted
}

function getFormTitle(mode: 'create' | 'edit', singular: string, id?: string): string {
  if (mode === 'create') return `Create ${singular}`
  const suffix = id ? ` #${id}` : ''
  return `Edit ${singular}${suffix}`
}

function FormBody({
  collection,
  mode,
  register,
  setValue,
  watch,
  errors,
  isPending,
  onSubmit,
}: {
  collection: ClientCollection
  mode: 'create' | 'edit'
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  isPending: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  const submitLabel = isPending
    ? 'Saving...'
    : mode === 'create'
      ? `Create ${collection.labels.singular}`
      : 'Save Changes'

  return (
    <form onSubmit={onSubmit} className="lontar-form">
      <div className="lontar-form-fields">
        {collection.fields.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            register={register}
            setValue={setValue}
            watch={watch}
            mode={mode}
            error={errors[field.name]}
          />
        ))}
      </div>

      <div className="lontar-form-footer">
        <button type="submit" className="lontar-btn lontar-btn-primary" disabled={isPending}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function useDocMutations({
  apiBase,
  slug,
  id,
  mode,
  collection,
  reset,
  setApiError,
  setSuccessMsg,
}: {
  apiBase: string
  slug?: string
  id?: string
  mode: 'create' | 'edit'
  collection?: ClientCollection
  reset: (values?: Record<string, unknown>) => void
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      setApiError(null)
      setSuccessMsg(null)
      if (!slug) throw new Error('Missing collection slug')
      if (mode === 'create') return createDoc(apiBase, slug, values)
      if (!id) throw new Error('Missing document id')
      return updateDoc(apiBase, slug, id, values)
    },
    onSuccess: (savedDoc) => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      if (mode === 'create') {
        void navigate({ to: '/$collection', params: { collection: slug ?? '' } })
      } else {
        setSuccessMsg('Saved successfully!')
        reset(collection ? formatDocForForm(collection, savedDoc) : savedDoc)
      }
    },
    onError: (err: Error) => {
      setApiError(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!slug || !id) throw new Error('Missing collection or id')
      return deleteDoc(apiBase, slug, id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      void navigate({ to: '/$collection', params: { collection: slug ?? '' } })
    },
    onError: (err: Error) => {
      setApiError(err.message)
    },
  })

  return { saveMutation, deleteMutation }
}

function checkConfirmed(): boolean {
  return (
    typeof window === 'undefined' ||
    window.confirm('Are you sure you want to delete this document?')
  )
}

function useDocumentQuery(mode: 'create' | 'edit', apiBase: string, slug?: string, id?: string) {
  const isEdit = mode === 'edit' && Boolean(slug) && Boolean(id)
  return useQuery({
    queryKey: [slug, id],
    queryFn: () => (slug && id ? fetchDoc(apiBase, slug, id) : null),
    enabled: isEdit,
  })
}

export function CollectionFormView({ mode }: { mode: 'create' | 'edit' }) {
  const { apiBase } = useAdmin()
  const { collection: slug, id } = useParams({ strict: false })
  const collection = useCollection(slug)

  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const docQuery = useDocumentQuery(mode, apiBase, slug, id)

  const schema = useMemo(() => {
    return collection ? clientFieldsToZod(collection.fields) : undefined
  }, [collection])

  const defaultValues = useMemo(() => computeDefaultValues(collection), [collection])

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
    if (docQuery.data) {
      reset(collection ? formatDocForForm(collection, docQuery.data) : docQuery.data)
    }
  }, [docQuery.data, collection, reset])

  const { saveMutation, deleteMutation } = useDocMutations({
    apiBase,
    slug,
    id,
    mode,
    collection,
    reset,
    setApiError,
    setSuccessMsg,
  })

  const handleDelete = () => {
    if (checkConfirmed()) deleteMutation.mutate()
  }

  if (!collection) return <NotFoundView />
  if (mode === 'edit' && docQuery.isLoading)
    return <div className="lontar-loading">Loading document...</div>
  if (mode === 'edit' && docQuery.error)
    return <div className="lontar-alert lontar-alert-error">{docQuery.error.message}</div>

  const title = getFormTitle(mode, collection.labels.singular, id)

  return (
    <div className="lontar-collection-form">
      <FormHeader
        title={title}
        mode={mode}
        collection={collection}
        doc={docQuery.data}
        isDeleting={deleteMutation.isPending}
        onDelete={handleDelete}
      />

      {apiError && <div className="lontar-alert lontar-alert-error">{apiError}</div>}
      {successMsg && <div className="lontar-alert lontar-alert-success">{successMsg}</div>}

      <FormBody
        collection={collection}
        mode={mode}
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
