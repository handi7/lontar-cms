import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useBlocker } from '@tanstack/react-router'
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
import {
  clientFieldsToZod,
  type ClientCollection,
  type ClientField,
  type ClientLocale,
  type CollectionPermission,
  type FieldPermission,
} from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import { usePermissions, useDocumentPermissions } from '../context/PermissionsContext'
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
import {
  buildFormValidationFields,
  computeDefaultValues,
  formatDocForForm,
  formatDocForSubmit,
  isSameDoc,
} from '../utils/form-utils'
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
import { useLocale } from '../hooks/useLocale'
import { LocaleSwitcher } from './LocaleSwitcher'
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
  permissions?: Record<string, FieldPermission>
  readOnlyDoc?: boolean
  fallbackDoc?: Record<string, unknown> | null
  hasLocalization?: boolean
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
  permissions,
  readOnlyDoc,
  fallbackDoc,
  hasLocalization,
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
          {collection.fields.map((field) => {
            const fieldPerm = permissions?.[field.name]
            if (fieldPerm?.read === false) return null
            const fallbackValue = fallbackDoc ? fallbackDoc[field.name] : undefined
            return (
              <FieldRenderer
                key={field.name}
                field={field}
                control={control}
                register={register}
                setValue={setValue}
                watch={watch}
                mode={mode}
                error={errors[field.name]}
                permissions={fieldPerm}
                readOnlyDoc={readOnlyDoc}
                fallbackValue={fallbackValue}
                hasLocalization={hasLocalization}
              />
            )
          })}
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
  onDocApplied?: (doc: Record<string, unknown>) => void
  locale?: string
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
  onDocApplied,
  locale,
}: UseDocMutationsOptions) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const saveMutation = useMutation({
    mutationFn: async ({ data, draft }: SaveDocArgs) => {
      setApiError(null)
      setSuccessMsg(null)
      if (mode === 'create') return createDoc(apiBase, slug, data, { draft, locale })
      if (!id) throw new Error('Missing document id')
      return updateDoc(apiBase, slug, id, data, { draft, locale })
    },
    onSuccess: (savedDoc, variables) => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(slug, id, Boolean(collection.versions?.drafts), locale),
          savedDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, slug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPermissionsPrefix(apiBase, slug, id),
        })
      }
      onSaveSuccess?.()
      onDocApplied?.(savedDoc)
      if (mode === 'create') {
        reset()
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
      return unpublishDoc(apiBase, slug, id, { locale })
    },
    onSuccess: (unpublishedDoc) => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(slug, id, Boolean(collection.versions?.drafts), locale),
          unpublishedDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, slug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPermissionsPrefix(apiBase, slug, id),
        })
      }
      setSuccessMsg('Unpublished successfully!')
      onDocApplied?.(unpublishedDoc)
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
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPermissionsPrefix(apiBase, slug, id),
        })
      }
      onSaveSuccess?.()
      reset()
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
  locale?: string,
  fallbackLocale?: string,
) {
  const isEdit = mode === 'edit' && Boolean(slug) && Boolean(id)
  return useQuery({
    queryKey: slug && id ? queryKeys.document(slug, id, Boolean(hasDrafts), locale) : ['document'],
    queryFn: () =>
      slug && id ? fetchDoc(apiBase, slug, id, { draft: hasDrafts, locale, fallbackLocale }) : null,
    enabled: isEdit,
    refetchOnWindowFocus: false,
  })
}

function useFallbackDocumentQuery(
  apiBase: string,
  slug?: string,
  id?: string,
  hasDrafts?: boolean,
  hasLocalization?: boolean,
  activeLocale?: string,
  fallbackLocale?: string,
) {
  const isEnabled =
    Boolean(slug && id) &&
    Boolean(hasLocalization) &&
    Boolean(fallbackLocale) &&
    activeLocale !== fallbackLocale

  return useQuery({
    queryKey:
      slug && id
        ? queryKeys.document(slug, id, Boolean(hasDrafts), fallbackLocale)
        : ['fallbackDocument'],
    queryFn: () =>
      slug && id && fallbackLocale
        ? fetchDoc(apiBase, slug, id, {
            draft: hasDrafts,
            locale: fallbackLocale,
            fallbackLocale: 'none',
          })
        : null,
    enabled: isEnabled,
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
  permissions?: Record<string, FieldPermission>
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
  permissions,
}: UseCollectionFormSubmitOptions) {
  const submitWithDraft = (draft: boolean) => {
    void handleSubmit(async (v) => {
      await onBeforeSubmit?.()
      const payload = formatDocForSubmit(collection.fields, v, true, permissions, mode)
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
  onDocApplied?: (doc: Record<string, unknown>) => void
  permissions?: Record<string, FieldPermission>
  readOnlyDoc?: boolean
  locale?: string
}

function isCollectionAutosaveEnabled(
  mode: 'create' | 'edit',
  versions?: ClientCollection['versions'],
  id?: string,
  readOnlyDoc?: boolean,
): boolean {
  if (readOnlyDoc) return false
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
  onDocApplied,
  permissions,
  readOnlyDoc,
  locale,
}: UseCollectionAutosaveOptions) {
  const queryClient = useQueryClient()
  const autosaveEnabled = isCollectionAutosaveEnabled(mode, collection.versions, id, readOnlyDoc)
  const autosaveInterval = collection.versions?.autosave?.interval ?? 2000

  const isValid = useMemo(() => {
    if (Object.keys(errors).length > 0) return false
    const values = formValues && Object.keys(formValues).length > 0 ? formValues : getValues()
    const payload = formatDocForSubmit(collection.fields, values, true, undefined, mode)
    return schema.safeParse(payload).success
  }, [errors, formValues, getValues, collection.fields, mode, schema])

  const onSave = useCallback(async () => {
    if (!id) throw new Error('Missing document id')
    const values = getValues()
    const payload = formatDocForSubmit(collection.fields, values, true, permissions, mode)
    const data =
      collection.upload && selectedFile ? buildUploadFormData(payload, selectedFile) : payload
    return updateDoc(apiBase, collection.slug, id, data, { autosave: true, locale })
  }, [
    apiBase,
    collection.fields,
    collection.slug,
    collection.upload,
    id,
    getValues,
    selectedFile,
    permissions,
    mode,
    locale,
  ])

  const onSuccess = useCallback(
    (savedDoc: Record<string, unknown>) => {
      onDocApplied?.(savedDoc)
      reset(formatDocForForm(collection.fields, savedDoc), { keepValues: true })
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(collection.slug, id, Boolean(collection.versions?.drafts), locale),
          savedDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.docVersions(apiBase, collection.slug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPermissionsPrefix(apiBase, collection.slug, id),
        })
      }
    },
    [
      apiBase,
      collection.fields,
      collection.slug,
      collection.versions?.drafts,
      id,
      locale,
      onDocApplied,
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
  canRestore?: boolean
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
      canRestore={props.canRestore}
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
  locale?: string
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
        locale={props.locale}
        onClose={props.onClose}
      />
    </div>
  )
}

export interface UseResetFormOnDocLoadedOptions {
  doc: Record<string, unknown> | null | undefined
  id?: string
  collectionSlug: string
  locale?: string
  fields: ClientField[]
  isDirty: boolean
  reset: (values?: Record<string, unknown>) => void
  onDocReset?: () => void
  lastAppliedDocRef: React.MutableRefObject<Record<string, unknown> | null>
}

function useResetFormOnDocLoaded({
  doc,
  id,
  collectionSlug,
  locale,
  fields,
  isDirty,
  reset,
  onDocReset,
  lastAppliedDocRef,
}: UseResetFormOnDocLoadedOptions) {
  const lastLoadedKeyRef = useRef<string | null>(null)
  const currentKey = `${collectionSlug}:${id ?? ''}:${locale ?? ''}`

  useEffect(() => {
    if (!doc) return
    if (currentKey !== lastLoadedKeyRef.current) {
      lastLoadedKeyRef.current = currentKey
      lastAppliedDocRef.current = null
    }

    if (isSameDoc(doc, lastAppliedDocRef.current)) return
    if (lastAppliedDocRef.current !== null && isDirty) return

    lastAppliedDocRef.current = doc
    reset(formatDocForForm(fields, doc))
    onDocReset?.()
  }, [currentKey, doc, fields, isDirty, lastAppliedDocRef, onDocReset, reset])
}

function resolveEditDocPermissions(
  docPermissions: CollectionPermission | undefined,
  canDelete: boolean,
  baseFields?: Record<string, FieldPermission>,
) {
  return {
    readOnlyDoc: docPermissions?.update === false,
    canDeleteDoc: docPermissions?.delete !== false && canDelete,
    canReadVersions: docPermissions?.readVersions !== false,
    fieldPermissions: docPermissions?.fields ?? baseFields,
    isUnreadable: docPermissions?.read === false,
  }
}

function useCollectionEditorPermissions(
  slug: string,
  mode: 'create' | 'edit',
  docPermissions?: CollectionPermission,
) {
  const { permissions, canDeleteInCollection } = usePermissions()
  const baseFields = permissions?.collections?.[slug]?.fields

  if (mode !== 'edit') {
    return {
      readOnlyDoc: false,
      canDeleteDoc: false,
      canReadVersions: true,
      fieldPermissions: baseFields,
      isUnreadable: false,
    }
  }

  return resolveEditDocPermissions(docPermissions, canDeleteInCollection(slug), baseFields)
}

function resolveSubmitLabel(
  isSubmitting: boolean,
  savePending: boolean,
  mode: 'create' | 'edit',
  singular: string,
): string {
  return getSubmitLabel(isSubmitting || savePending, mode, singular)
}

interface CollectionEditorSplitLayoutProps {
  collection: ClientCollection
  mode: 'create' | 'edit'
  hasPreview: boolean
  preview: ReturnType<typeof usePreviewState>
  editorView: ReturnType<typeof useEditorView>
  previewUrlTemplate?: string
  fieldPermissions?: Record<string, FieldPermission>
  formValues: Record<string, unknown>
  doc?: Record<string, unknown> | null
  onPublish: () => void
  control: Control<Record<string, unknown>>
  register: UseFormRegister<Record<string, unknown>>
  setValue: UseFormSetValue<Record<string, unknown>>
  watch: UseFormWatch<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  selectedFile: File | null
  onFileChange: (file: File | null) => void
  fileError: string | null
  readOnlyDoc: boolean
  fallbackDoc?: Record<string, unknown> | null
  hasLocalization?: boolean
  currentLocale?: string
  submitLabel: string
  isSubmitting: boolean
  savePending: boolean
  unpublishPending: boolean
  deletePending: boolean
  onDeleteClick: () => void
  canDeleteDoc: boolean
  hasDrafts: boolean
  hasVersions: boolean
  canReadVersions: boolean
  onOpenHistory: () => void
  autosaveSidebar?: ReturnType<typeof useCollectionAutosave>['sidebarAutosave']
  onSaveDraft: () => void
  onUnpublish: () => void
  isPublishing: boolean
  isSavingDraft: boolean
}

function CollectionEditorSplitLayout(props: CollectionEditorSplitLayoutProps) {
  return (
    <EditorSplitLayout
      hasPreview={props.hasPreview}
      isPreviewOpen={props.preview.isOpen}
      activeView={props.editorView.activeView}
      onViewChange={props.editorView.setActiveView}
      preview={
        <PreviewPaneWrapper
          collection={props.collection}
          isOpen={props.preview.isOpen}
          urlTemplate={props.previewUrlTemplate}
          values={formatDocForSubmit(
            props.collection.fields,
            props.formValues,
            true,
            props.fieldPermissions,
            props.mode,
          )}
          savedValues={props.doc}
          locale={props.currentLocale}
          onClose={props.editorView.close}
          activeView={props.editorView.activeView}
        />
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          props.onPublish()
        }}
        className="lt:flex lt:flex-col lt:@3xl:flex-row lt:gap-8 lt:items-start"
      >
        <FormFields
          collection={props.collection}
          mode={props.mode}
          control={props.control}
          register={props.register}
          setValue={props.setValue}
          watch={props.watch}
          errors={props.errors}
          selectedFile={props.selectedFile}
          onFileChange={props.onFileChange}
          fileError={props.fileError}
          doc={props.doc}
          permissions={props.fieldPermissions}
          readOnlyDoc={props.readOnlyDoc}
          fallbackDoc={props.fallbackDoc}
          hasLocalization={props.hasLocalization}
        />

        <DocumentSidebar
          mode={props.mode}
          submitLabel={props.submitLabel}
          isPending={props.isSubmitting || props.savePending || props.unpublishPending}
          isDeleting={props.deletePending}
          onDelete={props.onDeleteClick}
          showDelete={props.canDeleteDoc}
          canDelete={props.canDeleteDoc}
          doc={props.doc}
          hasDrafts={props.hasDrafts}
          hasVersions={props.hasVersions && props.canReadVersions}
          hasPreview={props.hasPreview}
          isPreviewOpen={props.preview.isOpen}
          onTogglePreview={props.editorView.toggle}
          onOpenHistory={props.onOpenHistory}
          autosave={props.autosaveSidebar}
          onPublish={props.onPublish}
          onSaveDraft={props.onSaveDraft}
          onUnpublish={props.onUnpublish}
          isPublishing={props.isPublishing}
          isSavingDraft={props.isSavingDraft}
          isUnpublishing={props.unpublishPending}
          readOnly={props.readOnlyDoc}
        />
      </form>
    </EditorSplitLayout>
  )
}

function confirmAction(message: string): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return true
  }
  return window.confirm(message)
}

interface UseLocaleNavigationOptions {
  activeLocale?: string
  isDirty: boolean
  isNavigatingAllowedRef?: React.RefObject<boolean>
}

/**
 * A save lets the navigation that follows it (create redirects to edit) skip the unsaved-changes
 * prompt. The editor stays mounted on edit pages, so the exemption must end once the form turns
 * dirty again; otherwise later edits could be discarded without a prompt.
 */
export function useRearmGuardOnEdit(isDirty: boolean, exemptionRef: React.RefObject<boolean>) {
  const wasDirtyRef = useRef(isDirty)
  useEffect(() => {
    if (isDirty && !wasDirtyRef.current) exemptionRef.current = false
    wasDirtyRef.current = isDirty
  }, [isDirty, exemptionRef])
}

function useLocaleNavigation({
  activeLocale,
  isDirty,
  isNavigatingAllowedRef,
}: UseLocaleNavigationOptions) {
  const navigate = useNavigate()
  const isSwitchingLocaleRef = useRef(false)

  useBlocker({
    shouldBlockFn: () => {
      if (!isDirty) return false
      if (isNavigatingAllowedRef?.current) return false
      if (isSwitchingLocaleRef.current) return false
      const confirmed = confirmAction('You have unsaved changes. Are you sure you want to leave?')
      return !confirmed
    },
  })

  const navigateToLocale = useCallback(
    (newLocale: string) => {
      isSwitchingLocaleRef.current = true
      void Promise.resolve(
        navigate({
          search: ((prev: Record<string, unknown>) => ({ ...prev, locale: newLocale })) as never,
        }),
      ).finally(() => {
        isSwitchingLocaleRef.current = false
      })
    },
    [navigate],
  )

  const handleLocaleChange = useCallback(
    (newLocale: string) => {
      if (newLocale === activeLocale) return
      if (isDirty) {
        setTimeout(() => {
          const confirmed = confirmAction(
            'You have unsaved changes. Are you sure you want to switch locales?',
          )
          if (confirmed) {
            navigateToLocale(newLocale)
          }
        }, 0)
        return
      }
      navigateToLocale(newLocale)
    },
    [activeLocale, isDirty, navigateToLocale],
  )

  return { handleLocaleChange }
}

interface UseCollectionQueriesOptions {
  mode: 'create' | 'edit'
  apiBase: string
  slug: string
  id?: string
  hasDrafts: boolean
  hasLocalization: boolean
  activeLocale?: string
  fallbackLocale?: string
}

function useCollectionQueries({
  mode,
  apiBase,
  slug,
  id,
  hasDrafts,
  hasLocalization,
  activeLocale,
  fallbackLocale,
}: UseCollectionQueriesOptions) {
  const currentLocale = hasLocalization ? activeLocale : undefined
  const docQuery = useDocumentQuery(
    mode,
    apiBase,
    slug,
    id,
    hasDrafts,
    currentLocale,
    hasLocalization ? 'none' : undefined,
  )
  const fallbackQuery = useFallbackDocumentQuery(
    apiBase,
    slug,
    id,
    hasDrafts,
    hasLocalization,
    activeLocale,
    fallbackLocale,
  )
  const fallbackDoc =
    hasLocalization && activeLocale !== fallbackLocale ? fallbackQuery.data : undefined

  return { docQuery, fallbackDoc, currentLocale }
}

function useCollectionForm(
  collection: ClientCollection,
  mode: 'create' | 'edit',
  fieldPermissions?: Record<string, FieldPermission>,
  readOnlyDoc?: boolean,
) {
  const schema = useMemo(
    () =>
      clientFieldsToZod(
        buildFormValidationFields(collection.fields, fieldPermissions, mode, readOnlyDoc),
      ),
    [collection.fields, fieldPermissions, mode, readOnlyDoc],
  )
  const defaultValues = useMemo(() => computeDefaultValues(collection.fields), [collection])

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const formValues = form.watch()
  return { ...form, formValues, schema }
}

interface UseVersionRestoreOptions {
  apiBase: string
  collectionSlug: string
  id?: string
  hasDrafts: boolean
  locale?: string
  fields: ClientField[]
  reset: (values?: Record<string, unknown>) => void
  onDocApplied: (doc: Record<string, unknown>) => void
  setSuccessMsg: (msg: string | null) => void
}

function useVersionRestore({
  apiBase,
  collectionSlug,
  id,
  hasDrafts,
  locale,
  fields,
  reset,
  onDocApplied,
  setSuccessMsg,
}: UseVersionRestoreOptions) {
  const queryClient = useQueryClient()

  return useCallback(
    (restoredDoc: Record<string, unknown>) => {
      onDocApplied(restoredDoc)
      if (id) {
        queryClient.setQueryData(
          queryKeys.document(collectionSlug, id, Boolean(hasDrafts), locale),
          restoredDoc,
        )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPrefix(collectionSlug, id),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentPermissionsPrefix(apiBase, collectionSlug, id),
        })
      }
      reset(formatDocForForm(fields, restoredDoc))
      setSuccessMsg('Version restored successfully!')
    },
    [
      apiBase,
      collectionSlug,
      fields,
      hasDrafts,
      id,
      locale,
      onDocApplied,
      queryClient,
      reset,
      setSuccessMsg,
    ],
  )
}

function renderLocaleSwitcher(
  hasLocalization: boolean,
  locales: ClientLocale[],
  activeLocale: string | undefined,
  onLocaleChange: (locale: string) => void,
) {
  if (!hasLocalization || !activeLocale) return undefined
  return (
    <LocaleSwitcher locales={locales} activeLocale={activeLocale} onLocaleChange={onLocaleChange} />
  )
}

export interface CollectionEditorProps {
  collection: ClientCollection
  mode: 'create' | 'edit'
  id?: string
}

function CollectionEditor({ collection, mode, id }: CollectionEditorProps) {
  const { apiBase } = useAdmin()
  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const isNavigatingAfterSaveRef = useRef(false)

  const { hasLocalization, activeLocale, fallbackLocale, locales } = useLocale()
  const hasDrafts = Boolean(collection.versions?.drafts)
  const hasVersions = Boolean(collection.versions)
  const previewUrlTemplate = collection.admin?.preview?.url
  const hasPreview = Boolean(previewUrlTemplate)
  const preview = usePreviewState(collection.slug, hasPreview)
  const editorView = useEditorView(preview)

  const { docQuery, fallbackDoc, currentLocale } = useCollectionQueries({
    mode,
    apiBase,
    slug: collection.slug,
    id,
    hasDrafts,
    hasLocalization,
    activeLocale,
    fallbackLocale,
  })

  const { data: docPermissions, isLoading: isDocPermsLoading } = useDocumentPermissions(
    apiBase,
    collection.slug,
    id,
    hasDrafts,
  )

  const isPermsLoading = mode === 'edit' && isDocPermsLoading
  const { readOnlyDoc, canDeleteDoc, canReadVersions, fieldPermissions, isUnreadable } =
    useCollectionEditorPermissions(collection.slug, mode, docPermissions)

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    setError,
    formValues,
    schema,
    formState: { errors, isSubmitting, isDirty },
  } = useCollectionForm(collection, mode, fieldPermissions, readOnlyDoc)

  useRearmGuardOnEdit(isDirty, isNavigatingAfterSaveRef)

  const { handleLocaleChange } = useLocaleNavigation({
    activeLocale,
    isDirty,
    isNavigatingAllowedRef: isNavigatingAfterSaveRef,
  })

  const lastAppliedDocRef = useRef<Record<string, unknown> | null>(null)
  const onDocApplied = useCallback((doc: Record<string, unknown>) => {
    lastAppliedDocRef.current = doc
  }, [])

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
    onDocApplied,
    permissions: fieldPermissions,
    readOnlyDoc,
    locale: currentLocale,
  })

  useResetFormOnDocLoaded({
    doc: docQuery.data,
    id,
    collectionSlug: collection.slug,
    locale: currentLocale,
    fields: collection.fields,
    isDirty,
    reset,
    onDocReset: () => {
      setSelectedFile(null)
      setFileError(null)
    },
    lastAppliedDocRef,
  })

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
    onDocApplied,
    locale: currentLocale,
    onSaveSuccess: () => {
      isNavigatingAfterSaveRef.current = true
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
    permissions: fieldPermissions,
  })

  const onRestoreSuccess = useVersionRestore({
    apiBase,
    collectionSlug: collection.slug,
    id,
    hasDrafts,
    locale: currentLocale,
    fields: collection.fields,
    reset,
    onDocApplied,
    setSuccessMsg,
  })

  if (shouldShowQueryState(mode, docQuery.isLoading || isPermsLoading, docQuery.error)) {
    return (
      <CollectionQueryState
        isLoading={docQuery.isLoading || isPermsLoading}
        error={docQuery.error}
      />
    )
  }

  if (isUnreadable) {
    return <NotFoundView />
  }

  const title = getFormTitle(mode, collection.labels.singular, id)
  const breadcrumbTitle = resolveBreadcrumbTitle(
    mode,
    docQuery.data,
    collection.labels.singular,
    id,
  )
  const submitLabel = resolveSubmitLabel(
    isSubmitting,
    saveMutation.isPending,
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
        actions={renderLocaleSwitcher(hasLocalization, locales, activeLocale, handleLocaleChange)}
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

      <CollectionEditorSplitLayout
        collection={collection}
        mode={mode}
        hasPreview={hasPreview}
        preview={preview}
        editorView={editorView}
        previewUrlTemplate={previewUrlTemplate}
        fieldPermissions={fieldPermissions}
        formValues={formValues}
        doc={docQuery.data}
        fallbackDoc={fallbackDoc}
        hasLocalization={hasLocalization}
        currentLocale={currentLocale}
        onPublish={onPublish}
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
        readOnlyDoc={readOnlyDoc}
        submitLabel={submitLabel}
        isSubmitting={isSubmitting}
        savePending={saveMutation.isPending}
        unpublishPending={unpublishMutation.isPending}
        deletePending={deleteMutation.isPending}
        onDeleteClick={() => setConfirmOpen(true)}
        canDeleteDoc={canDeleteDoc}
        hasDrafts={hasDrafts}
        hasVersions={hasVersions}
        canReadVersions={canReadVersions}
        onOpenHistory={() => setHistoryOpen(true)}
        autosaveSidebar={autosave.sidebarAutosave}
        onSaveDraft={onSaveDraft}
        onUnpublish={() => {
          void (async () => {
            await autosave.cancelAutosave()
            unpublishMutation.mutate()
          })()
        }}
        isPublishing={isPublishing}
        isSavingDraft={isSavingDraft}
      />

      <VersionHistorySheetWrapper
        hasVersions={hasVersions && canReadVersions}
        id={id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        apiBase={apiBase}
        collection={collection}
        currentDoc={docQuery.data}
        onRestoreSuccess={onRestoreSuccess}
        canRestore={!readOnlyDoc}
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
  const { canCreateInCollection, canReadCollection } = usePermissions()

  if (!collection || !slug) return <NotFoundView />
  if (mode === 'create' && !canCreateInCollection(slug)) return <NotFoundView />
  if (mode === 'edit' && !canReadCollection(slug)) return <NotFoundView />

  return <CollectionEditor collection={collection} mode={mode} id={id} />
}
