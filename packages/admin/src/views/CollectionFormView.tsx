import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
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
import { clientFieldsToZod, type ClientCollection } from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import { fetchDoc, createDoc, updateDoc, deleteDoc, ApiClientError } from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import { FileUploadZone, formatFilesize } from '../fields/FileUploadZone'
import { computeDefaultValues, formatDocForForm, formatDocForSubmit } from '../utils/form-utils'
import { NotFoundView } from './NotFoundView'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyCard } from './EmptyCard'
import { ViewHeader } from './ViewHeader'

function DocumentMeta({ doc }: { doc?: Record<string, unknown> | null }) {
  if (!doc) return null
  return (
    <div className="lt:mt-1.5 lt:flex lt:gap-4 lt:text-[0.8125rem] lt:text-muted-foreground">
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
    <ViewHeader
      title={title}
      actions={
        <>
          {mode === 'edit' && (
            <Button
              type="button"
              variant="outline"
              className="lt:text-destructive lt:hover:border-destructive lt:hover:bg-error-bg lt:hover:text-destructive"
              disabled={isDeleting}
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
          <Button asChild variant="outline">
            <Link to="/$collection" params={{ collection: collection.slug }}>
              Cancel
            </Link>
          </Button>
        </>
      }
    >
      {mode === 'edit' && <DocumentMeta doc={doc} />}
    </ViewHeader>
  )
}

function getFormTitle(mode: 'create' | 'edit', singular: string, id?: string): string {
  if (mode === 'create') return `Create ${singular}`
  const suffix = id ? ` #${id}` : ''
  return `Edit ${singular}${suffix}`
}

function FormBody({
  collection,
  mode,
  control,
  register,
  setValue,
  watch,
  errors,
  isPending,
  selectedFile,
  onFileChange,
  fileError,
  doc,
  onSubmit,
}: {
  collection: ClientCollection
  mode: 'create' | 'edit'
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  isPending: boolean
  selectedFile: File | null
  onFileChange: (file: File | null) => void
  fileError: string | null
  doc?: Record<string, unknown> | null
  onSubmit: (e: React.FormEvent) => void
}) {
  const submitLabel = isPending
    ? 'Saving...'
    : mode === 'create'
      ? `Create ${collection.labels.singular}`
      : 'Save Changes'

  const uploadConfig = typeof collection.upload === 'object' ? collection.upload : undefined
  const accept = uploadConfig?.mimeTypes?.join(',')

  return (
    <Card className="lt:block lt:p-8 lt:shadow-none">
      <form onSubmit={onSubmit}>
        {Boolean(collection.upload) && (
          <FileUploadZone
            value={selectedFile}
            onChange={onFileChange}
            currentFile={
              doc
                ? {
                    filename: doc.filename as string | undefined,
                    url: doc.url as string | undefined,
                    mimeType: doc.mimeType as string | undefined,
                    filesize: doc.filesize as number | undefined,
                    width: doc.width as number | undefined,
                    height: doc.height as number | undefined,
                  }
                : null
            }
            accept={accept}
            maxFileSize={uploadConfig?.maxFileSize}
            required={mode === 'create'}
            error={fileError ?? undefined}
          />
        )}

        <div className="lt:flex lt:flex-col lt:gap-6">
          {collection.fields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              control={control}
              register={register}
              setValue={setValue}
              watch={watch}
              mode={mode}
              error={errors[field.name]}
            />
          ))}
        </div>

        <div className="lt:mt-8 lt:flex lt:gap-3 lt:border-t lt:pt-6">
          <Button type="submit" disabled={isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function useDocMutations({
  apiBase,
  slug,
  id,
  mode,
  collection,
  reset,
  setError,
  setApiError,
  setSuccessMsg,
  onSaveSuccess,
}: {
  apiBase: string
  slug?: string
  id?: string
  mode: 'create' | 'edit'
  collection?: ClientCollection
  reset: (values?: Record<string, unknown>) => void
  setError?: UseFormSetError<Record<string, unknown>>
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
  onSaveSuccess?: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown> | FormData) => {
      setApiError(null)
      setSuccessMsg(null)
      if (!slug) throw new Error('Missing collection slug')
      if (mode === 'create') return createDoc(apiBase, slug, values)
      if (!id) throw new Error('Missing document id')
      return updateDoc(apiBase, slug, id, values)
    },
    onSuccess: (savedDoc) => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      onSaveSuccess?.()
      if (mode === 'create') {
        void navigate({ to: '/$collection', params: { collection: slug ?? '' } })
      } else {
        setSuccessMsg('Saved successfully!')
        reset(collection ? formatDocForForm(collection.fields, savedDoc) : savedDoc)
      }
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
    refetchOnWindowFocus: false,
  })
}

function appendFieldValue(formData: FormData, key: string, val: unknown): void {
  if (val === undefined) return
  if (val === null) {
    formData.append(key, '')
    return
  }
  if (typeof val === 'object') {
    formData.append(key, JSON.stringify(val))
  } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    formData.append(key, String(val))
  }
}

function buildUploadFormData(values: Record<string, unknown>, file: File | null): FormData {
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }
  for (const [key, val] of Object.entries(values)) {
    appendFieldValue(formData, key, val)
  }
  return formData
}

export function CollectionFormView({ mode }: { mode: 'create' | 'edit' }) {
  const { apiBase } = useAdmin()
  const { collection: slug, id } = useParams({ strict: false })
  const collection = useCollection(slug)

  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const docQuery = useDocumentQuery(mode, apiBase, slug, id)

  const schema = useMemo(() => {
    return collection ? clientFieldsToZod(collection.fields) : undefined
  }, [collection])

  const defaultValues = useMemo(() => computeDefaultValues(collection?.fields ?? []), [collection])

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
    if (docQuery.data && !isDirty) {
      reset(collection ? formatDocForForm(collection.fields, docQuery.data) : docQuery.data)
      setSelectedFile(null)
      setFileError(null)
    }
  }, [docQuery.data, collection, reset, isDirty])

  const { saveMutation, deleteMutation } = useDocMutations({
    apiBase,
    slug,
    id,
    mode,
    collection,
    reset,
    setError,
    setApiError,
    setSuccessMsg,
    onSaveSuccess: () => {
      setSelectedFile(null)
      setFileError(null)
    },
  })

  const handleDelete = () => {
    if (checkConfirmed()) deleteMutation.mutate()
  }

  if (!collection) return <NotFoundView />
  if (mode === 'edit' && docQuery.isLoading) return <EmptyCard>Loading document...</EmptyCard>
  if (mode === 'edit' && docQuery.error)
    return <Alert variant="destructive">{docQuery.error.message}</Alert>

  const title = getFormTitle(mode, collection.labels.singular, id)

  const handleFormSubmit = (v: Record<string, unknown>) => {
    const payload = collection ? formatDocForSubmit(collection.fields, v) : v
    if (!collection.upload) {
      saveMutation.mutate(payload)
      return
    }
    if (mode === 'create' && !selectedFile) {
      setFileError('Please select a file to upload')
      return
    }
    const uploadCfg = typeof collection.upload === 'object' ? collection.upload : undefined
    if (selectedFile && uploadCfg?.maxFileSize && selectedFile.size > uploadCfg.maxFileSize) {
      setFileError(
        `File size exceeds maximum allowed size of ${formatFilesize(uploadCfg.maxFileSize)}`,
      )
      return
    }
    saveMutation.mutate(buildUploadFormData(payload, selectedFile))
  }

  return (
    <div>
      <FormHeader
        title={title}
        mode={mode}
        collection={collection}
        doc={docQuery.data}
        isDeleting={deleteMutation.isPending}
        onDelete={handleDelete}
      />

      {apiError && (
        <Alert variant="destructive" className="lt:mb-5">
          {apiError}
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" role="status" className="lt:mb-5">
          {successMsg}
        </Alert>
      )}

      <FormBody
        collection={collection}
        mode={mode}
        control={control}
        register={register}
        setValue={setValue}
        watch={watch}
        errors={errors}
        isPending={isSubmitting || saveMutation.isPending}
        selectedFile={selectedFile}
        onFileChange={(file) => {
          setSelectedFile(file)
          setFileError(null)
        }}
        fileError={fileError}
        doc={docQuery.data}
        onSubmit={(e) => {
          void handleSubmit(handleFormSubmit)(e)
        }}
      />
    </div>
  )
}
