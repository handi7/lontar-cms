import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  useForm,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
  type UseFormGetValues,
  type UseFormReset,
  type UseFormSetError,
  type UseFormHandleSubmit,
  type FieldErrors,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { clientFieldsToZod, type ClientCollection } from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import {
  fetchDoc,
  createDoc,
  updateDoc,
  deleteDoc,
  unpublishDoc,
  ApiClientError,
  queryKeys,
} from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import { FileUploadZone, formatFilesize } from '../fields/FileUploadZone'
import { computeDefaultValues, formatDocForForm, formatDocForSubmit } from '../utils/form-utils'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { NotFoundView } from './NotFoundView'
import { Alert } from '../components/ui/alert'
import { Card } from '../components/ui/card'
import { EmptyCard } from './EmptyCard'
import { ViewHeader } from './ViewHeader'
import { CollectionBreadcrumbs } from './FormBreadcrumbs'
import { DocumentSidebar } from './DocumentSidebar'
import { VersionHistorySheet } from './VersionHistorySheet'
import { PreviewPane } from './preview/PreviewPane'
import { EditorSplitLayout, useEditorView } from './preview/EditorSplitLayout'
import { useAutosave } from '../hooks/useAutosave'
import { cn } from '../lib/utils'

function getFormTitle(mode: 'create' | 'edit', singular: string, id?: string): string {
  if (mode === 'create') return `Create ${singular}`
  const suffix = id ? ` #${id}` : ''
  return `Edit ${singular}${suffix}`
}

function getBreadcrumbTitle(
  doc: Record<string, unknown> | null | undefined,
  singular: string,
  id?: string,
): string {
  if (doc) {
    if (typeof doc.title === 'string' && doc.title.trim()) return doc.title
    if (typeof doc.name === 'string' && doc.name.trim()) return doc.name
    if (typeof doc.filename === 'string' && doc.filename.trim()) return doc.filename
  }
  return id ? `#${id}` : `Edit ${singular}`
}

function getSubmitLabel(isPending: boolean, mode: 'create' | 'edit', singular: string): string {
  if (isPending) return 'Saving...'
  return mode === 'create' ? `Create ${singular}` : 'Save Changes'
}

function validateUpload(
  selectedFile: File | null,
  uploadConfig: unknown,
  isCreate: boolean,
): string | null {
  if (isCreate && !selectedFile) {
    return 'Please select a file to upload'
  }
  const cfg =
    typeof uploadConfig === 'object' && uploadConfig !== null
      ? (uploadConfig as { maxFileSize?: number })
      : undefined
  if (selectedFile && cfg?.maxFileSize && selectedFile.size > cfg.maxFileSize) {
    return `File size exceeds maximum allowed size of ${formatFilesize(cfg.maxFileSize)}`
  }
  return null
}

export interface FormFieldsProps {
  collection: ClientCollection
  mode: 'create' | 'edit'
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  selectedFile: File | null
  onFileChange: (file: File | null) => void
  fileError: string | null
  doc?: Record<string, unknown> | null
}

function FormFields({
  collection,
  mode,
  control,
  register,
  setValue,
  watch,
  errors,
  selectedFile,
  onFileChange,
  fileError,
  doc,
}: FormFieldsProps) {
  const uploadConfig = typeof collection.upload === 'object' ? collection.upload : undefined
  const accept = uploadConfig?.mimeTypes?.join(',')

  return (
    <div
      data-testid="field-column"
      className="lt:w-full lt:min-w-0 lt:@3xl:max-w-[760px] lt:flex-1"
    >
      <Card className="lt:block lt:p-8 lt:shadow-none">
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
      </Card>
    </div>
  )
}

export interface UseDocMutationsOptions {
  apiBase: string
  slug: string
  id?: string
  mode: 'create' | 'edit'
  collection: ClientCollection
  reset: (values?: Record<string, unknown>) => void
  setError?: UseFormSetError<Record<string, unknown>>
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
  onSaveSuccess?: () => void
}

export interface SaveDocArgs {
  data: Record<string, unknown> | FormData
  draft?: boolean
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
}: UseDocMutationsOptions) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const saveMutation = useMutation({
    mutationFn: async ({ data, draft }: SaveDocArgs) => {
      setApiError(null)
      setSuccessMsg(null)
      if (mode === 'create') return createDoc(apiBase, slug, data, { draft })
      if (!id) throw new Error('Missing document id')
      return updateDoc(apiBase, slug, id, data, { draft })
    },
    onSuccess: (savedDoc, variables) => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(slug, id, Boolean(collection.versions?.drafts)),
          savedDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPrefix(slug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, slug, id),
        })
      }
      onSaveSuccess?.()
      if (mode === 'create') {
        void navigate({ to: '/$collection', params: { collection: slug } })
      } else {
        if (collection.versions?.drafts) {
          setSuccessMsg(variables.draft ? 'Draft saved!' : 'Published successfully!')
        } else {
          setSuccessMsg('Saved successfully!')
        }
        reset(formatDocForForm(collection.fields, savedDoc))
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

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      setApiError(null)
      setSuccessMsg(null)
      if (!id) throw new Error('Missing collection or id')
      return unpublishDoc(apiBase, slug, id)
    },
    onSuccess: (unpublishedDoc) => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(slug, id, Boolean(collection.versions?.drafts)),
          unpublishedDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPrefix(slug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, slug, id),
        })
      }
      setSuccessMsg('Unpublished successfully!')
      reset(formatDocForForm(collection.fields, unpublishedDoc))
    },
    onError: (err: Error) => {
      setApiError(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error('Missing collection or id')
      return deleteDoc(apiBase, slug, id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      if (id) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPrefix(slug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, slug, id),
        })
      }
      void navigate({ to: '/$collection', params: { collection: slug } })
    },
    onError: (err: Error) => {
      setApiError(err.message)
    },
  })

  return { saveMutation, deleteMutation, unpublishMutation }
}

function useDocumentQuery(
  mode: 'create' | 'edit',
  apiBase: string,
  slug?: string,
  id?: string,
  hasDrafts?: boolean,
) {
  const isEdit = mode === 'edit' && Boolean(slug) && Boolean(id)
  return useQuery({
    queryKey: slug && id ? queryKeys.document(slug, id, Boolean(hasDrafts)) : ['document'],
    queryFn: () => (slug && id ? fetchDoc(apiBase, slug, id, { draft: hasDrafts }) : null),
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

export interface CollectionQueryStateProps {
  isLoading: boolean
  error: Error | null
}

function CollectionQueryState({ isLoading, error }: CollectionQueryStateProps) {
  if (isLoading) return <EmptyCard>Loading document...</EmptyCard>
  if (error) return <Alert variant="destructive">{error.message}</Alert>
  return null
}

export interface CollectionStatusAlertsProps {
  apiError: string | null
  successMsg: string | null
}

function CollectionStatusAlerts({ apiError, successMsg }: CollectionStatusAlertsProps) {
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

function shouldShowQueryState(
  mode: 'create' | 'edit',
  isLoading: boolean,
  error: unknown,
): boolean {
  return mode === 'edit' && (isLoading || Boolean(error))
}

function resolveBreadcrumbTitle(
  mode: 'create' | 'edit',
  doc: Record<string, unknown> | null | undefined,
  singular: string,
  id?: string,
): string {
  if (mode === 'create') return `New ${singular}`
  return getBreadcrumbTitle(doc ?? undefined, singular, id)
}

interface UseCollectionFormSubmitOptions {
  collection: ClientCollection
  mode: 'create' | 'edit'
  hasDrafts: boolean
  selectedFile: File | null
  setFileError: (err: string | null) => void
  saveMutation: {
    mutate: (args: { data: Record<string, unknown> | FormData; draft?: boolean }) => void
    isPending: boolean
    variables: { data: Record<string, unknown> | FormData; draft?: boolean } | undefined
  }
  handleSubmit: UseFormHandleSubmit<Record<string, unknown>>
  onBeforeSubmit?: () => Promise<void> | void
}

function useCollectionFormSubmit({
  collection,
  mode,
  hasDrafts,
  selectedFile,
  setFileError,
  saveMutation,
  handleSubmit,
  onBeforeSubmit,
}: UseCollectionFormSubmitOptions) {
  const submitWithDraft = (draft: boolean) => {
    void handleSubmit(async (v) => {
      await onBeforeSubmit?.()
      const payload = formatDocForSubmit(collection.fields, v)
      if (!collection.upload) {
        saveMutation.mutate({ data: payload, draft: hasDrafts ? draft : undefined })
        return
      }
      const uploadErr = validateUpload(selectedFile, collection.upload, mode === 'create')
      if (uploadErr) {
        setFileError(uploadErr)
        return
      }
      saveMutation.mutate({
        data: buildUploadFormData(payload, selectedFile),
        draft: hasDrafts ? draft : undefined,
      })
    })()
  }

  const isPublishing = saveMutation.isPending && !saveMutation.variables?.draft
  const isSavingDraft = saveMutation.isPending && Boolean(saveMutation.variables?.draft)

  return {
    onPublish: () => submitWithDraft(false),
    onSaveDraft: () => submitWithDraft(true),
    isPublishing,
    isSavingDraft,
  }
}

interface UseCollectionAutosaveOptions {
  collection: ClientCollection
  mode: 'create' | 'edit'
  id?: string
  apiBase: string
  isDirty: boolean
  errors: FieldErrors<Record<string, unknown>>
  getValues: UseFormGetValues<Record<string, unknown>>
  formValues: Record<string, unknown>
  schema: z.ZodTypeAny
  selectedFile: File | null
  reset: UseFormReset<Record<string, unknown>>
}

function isCollectionAutosaveEnabled(
  mode: 'create' | 'edit',
  versions?: ClientCollection['versions'],
  id?: string,
): boolean {
  if (mode !== 'edit' || !id) return false
  return Boolean(versions?.drafts && versions?.autosave)
}

function buildSidebarAutosaveState(enabled: boolean, autosave: ReturnType<typeof useAutosave>) {
  if (!enabled) return undefined
  return {
    status: autosave.status,
    lastSavedAt: autosave.lastSavedAt,
    consecutiveErrors: autosave.consecutiveErrors,
  }
}

function useCollectionAutosave({
  collection,
  mode,
  id,
  apiBase,
  isDirty,
  errors,
  getValues,
  formValues,
  schema,
  selectedFile,
  reset,
}: UseCollectionAutosaveOptions) {
  const queryClient = useQueryClient()
  const autosaveEnabled = isCollectionAutosaveEnabled(mode, collection.versions, id)
  const autosaveInterval = collection.versions?.autosave?.interval ?? 2000

  const isValid = useMemo(() => {
    if (Object.keys(errors).length > 0) return false
    const values = formValues && Object.keys(formValues).length > 0 ? formValues : getValues()
    const payload = formatDocForSubmit(collection.fields, values)
    return schema.safeParse(payload).success
  }, [errors, formValues, getValues, collection.fields, schema])

  const onSave = useCallback(async () => {
    if (!id) throw new Error('Missing document id')
    const values = getValues()
    const payload = formatDocForSubmit(collection.fields, values)
    const data =
      collection.upload && selectedFile ? buildUploadFormData(payload, selectedFile) : payload
    return updateDoc(apiBase, collection.slug, id, data, { autosave: true })
  }, [apiBase, collection.fields, collection.slug, collection.upload, id, getValues, selectedFile])

  const onSuccess = useCallback(
    (savedDoc: Record<string, unknown>) => {
      reset(formatDocForForm(collection.fields, savedDoc), { keepValues: true })
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(collection.slug, id, Boolean(collection.versions?.drafts)),
          savedDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, collection.slug, id),
        })
      }
    },
    [
      apiBase,
      collection.fields,
      collection.slug,
      collection.versions?.drafts,
      id,
      queryClient,
      reset,
    ],
  )

  const autosave = useAutosave({
    enabled: autosaveEnabled,
    interval: autosaveInterval,
    isDirty,
    isValid,
    values: formValues,
    onSave,
    onSuccess,
  })

  const sidebarAutosave = buildSidebarAutosaveState(autosaveEnabled, autosave)

  return {
    ...autosave,
    sidebarAutosave,
  }
}

interface VersionHistorySheetWrapperProps {
  hasVersions: boolean
  id?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  apiBase: string
  collection: ClientCollection
  currentDoc?: Record<string, unknown> | null
  onRestoreSuccess: (doc: Record<string, unknown>) => void
}

function VersionHistorySheetWrapper(props: VersionHistorySheetWrapperProps) {
  if (!props.hasVersions || !props.id) return null
  return (
    <VersionHistorySheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      apiBase={props.apiBase}
      collection={props.collection}
      id={props.id}
      currentDoc={props.currentDoc}
      onRestoreSuccess={props.onRestoreSuccess}
    />
  )
}

function usePreviewState(collectionSlug: string, hasPreview: boolean) {
  const [isOpen, setIsOpen] = useState(() => {
    if (!hasPreview) return false
    try {
      return localStorage.getItem(`lontar:preview:open:${collectionSlug}`) === 'true'
    } catch {
      return false
    }
  })

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(`lontar:preview:open:${collectionSlug}`, String(next))
      } catch {
        // Ignore localStorage error
      }
      return next
    })
  }, [collectionSlug])

  const close = useCallback(() => {
    setIsOpen(false)
    try {
      localStorage.setItem(`lontar:preview:open:${collectionSlug}`, 'false')
    } catch {
      // Ignore localStorage error
    }
  }, [collectionSlug])

  return { isOpen, toggle, close }
}

interface PreviewPaneWrapperProps {
  collection: ClientCollection
  isOpen: boolean
  urlTemplate?: string
  values: Record<string, unknown>
  savedValues?: Record<string, unknown> | null
  onClose: () => void
  activeView?: 'edit' | 'preview'
}

function PreviewPaneWrapper(props: PreviewPaneWrapperProps) {
  if (!props.isOpen || !props.urlTemplate) return null

  return (
    <div
      className={cn(
        'lt:w-full lt:xl:w-1/2 lt:xl:sticky lt:xl:top-8 lt:xl:h-[calc(100vh-5rem)] lt:h-[600px] lt:shrink-0',
        props.activeView === 'edit' && 'lt:hidden lt:xl:block',
      )}
    >
      <PreviewPane
        collectionSlug={props.collection.slug}
        urlTemplate={props.urlTemplate}
        values={props.values}
        savedValues={props.savedValues}
        onClose={props.onClose}
      />
    </div>
  )
}

export interface CollectionEditorProps {
  collection: ClientCollection
  mode: 'create' | 'edit'
  id?: string
}

function CollectionEditor({ collection, mode, id }: CollectionEditorProps) {
  const { apiBase } = useAdmin()
  const queryClient = useQueryClient()
  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const hasDrafts = Boolean(collection.versions?.drafts)
  const hasVersions = Boolean(collection.versions)
  const previewUrlTemplate = collection.admin?.preview?.url
  const hasPreview = Boolean(previewUrlTemplate)
  const preview = usePreviewState(collection.slug, hasPreview)
  const editorView = useEditorView(preview)

  const docQuery = useDocumentQuery(mode, apiBase, collection.slug, id, hasDrafts)
  const schema = useMemo(() => clientFieldsToZod(collection.fields), [collection])
  const defaultValues = useMemo(() => computeDefaultValues(collection.fields), [collection])

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const formValues = watch()

  const autosave = useCollectionAutosave({
    collection,
    mode,
    id,
    apiBase,
    isDirty,
    errors,
    getValues,
    formValues,
    schema,
    selectedFile,
    reset,
  })

  useEffect(() => {
    if (docQuery.data && !isDirty) {
      reset(formatDocForForm(collection.fields, docQuery.data))
      setSelectedFile(null)
      setFileError(null)
    }
  }, [docQuery.data, collection, reset, isDirty])

  const { saveMutation, deleteMutation, unpublishMutation } = useDocMutations({
    apiBase,
    slug: collection.slug,
    id,
    mode,
    collection,
    reset,
    setError,
    setApiError,
    setSuccessMsg,
    onSaveSuccess: () => {
      void autosave.cancelAutosave()
      setSelectedFile(null)
      setFileError(null)
    },
  })

  const { onPublish, onSaveDraft, isPublishing, isSavingDraft } = useCollectionFormSubmit({
    collection,
    mode,
    hasDrafts,
    selectedFile,
    setFileError,
    saveMutation,
    handleSubmit,
    onBeforeSubmit: autosave.cancelAutosave,
  })

  if (shouldShowQueryState(mode, docQuery.isLoading, docQuery.error)) {
    return <CollectionQueryState isLoading={docQuery.isLoading} error={docQuery.error} />
  }

  const title = getFormTitle(mode, collection.labels.singular, id)
  const breadcrumbTitle = resolveBreadcrumbTitle(
    mode,
    docQuery.data,
    collection.labels.singular,
    id,
  )
  const submitLabel = getSubmitLabel(
    isSubmitting || saveMutation.isPending,
    mode,
    collection.labels.singular,
  )

  return (
    <div>
      <ViewHeader
        title={title}
        breadcrumbs={
          <CollectionBreadcrumbs
            collectionLabel={collection.labels.plural}
            collectionSlug={collection.slug}
            currentTitle={breadcrumbTitle}
          />
        }
      />

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          setConfirmOpen(false)
          deleteMutation.mutate()
        }}
      />

      <CollectionStatusAlerts apiError={apiError} successMsg={successMsg} />

      <EditorSplitLayout
        hasPreview={hasPreview}
        isPreviewOpen={preview.isOpen}
        activeView={editorView.activeView}
        onViewChange={editorView.setActiveView}
        preview={
          <PreviewPaneWrapper
            collection={collection}
            isOpen={preview.isOpen}
            urlTemplate={previewUrlTemplate}
            values={formatDocForSubmit(collection.fields, formValues)}
            savedValues={docQuery.data}
            onClose={editorView.close}
            activeView={editorView.activeView}
          />
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onPublish()
          }}
          className="lt:flex lt:flex-col lt:@3xl:flex-row lt:gap-8 lt:items-start"
        >
          <FormFields
            collection={collection}
            mode={mode}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
            errors={errors}
            selectedFile={selectedFile}
            onFileChange={(file) => {
              setSelectedFile(file)
              setFileError(null)
            }}
            fileError={fileError}
            doc={docQuery.data}
          />

          <DocumentSidebar
            mode={mode}
            submitLabel={submitLabel}
            isPending={isSubmitting || saveMutation.isPending || unpublishMutation.isPending}
            isDeleting={deleteMutation.isPending}
            onDelete={() => setConfirmOpen(true)}
            showDelete={mode === 'edit'}
            doc={docQuery.data}
            hasDrafts={hasDrafts}
            hasVersions={hasVersions}
            hasPreview={hasPreview}
            isPreviewOpen={preview.isOpen}
            onTogglePreview={editorView.toggle}
            onOpenHistory={() => setHistoryOpen(true)}
            autosave={autosave.sidebarAutosave}
            onPublish={onPublish}
            onSaveDraft={onSaveDraft}
            onUnpublish={() => {
              void (async () => {
                await autosave.cancelAutosave()
                unpublishMutation.mutate()
              })()
            }}
            isPublishing={isPublishing}
            isSavingDraft={isSavingDraft}
            isUnpublishing={unpublishMutation.isPending}
          />
        </form>
      </EditorSplitLayout>

      <VersionHistorySheetWrapper
        hasVersions={hasVersions}
        id={id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        apiBase={apiBase}
        collection={collection}
        currentDoc={docQuery.data}
        onRestoreSuccess={(restoredDoc) => {
          if (id) {
            queryClient.setQueryData(
              queryKeys.document(collection.slug, id, Boolean(hasDrafts)),
              restoredDoc,
            )
          }
          reset(formatDocForForm(collection.fields, restoredDoc))
          setSuccessMsg('Version restored successfully!')
        }}
      />
    </div>
  )
}

export interface CollectionFormViewProps {
  mode: 'create' | 'edit'
}

export function CollectionFormView({ mode }: CollectionFormViewProps) {
  const { collection: slug, id } = useParams({ strict: false })
  const collection = useCollection(slug)

  if (!collection) return <NotFoundView />

  return <CollectionEditor collection={collection} mode={mode} id={id} />
}
