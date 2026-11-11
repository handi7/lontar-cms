import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
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
import { clientFieldsToZod, type ClientField, type ClientGlobal } from '@lontar/core/client'
import { useAdmin, useGlobal } from '../context/AdminContext'
import { fetchGlobal, saveGlobal, unpublishGlobal, ApiClientError, queryKeys } from '../api/client'
import { FieldRenderer } from '../fields/FieldRenderer'
import {
  computeDefaultValues,
  formatDocForForm,
  formatDocForSubmit,
  isSameDoc,
} from '../utils/form-utils'
import { NotFoundView } from './NotFoundView'
import { Alert } from '../components/ui/alert'
import { Card } from '../components/ui/card'
import { EmptyCard } from './EmptyCard'
import { ViewHeader } from './ViewHeader'
import { GlobalBreadcrumbs } from './FormBreadcrumbs'
import { DocumentSidebar } from './DocumentSidebar'
import { VersionHistorySheet } from './VersionHistorySheet'
import { PreviewPane } from './preview/PreviewPane'
import { EditorSplitLayout, useEditorView } from './preview/EditorSplitLayout'
import { useAutosave } from '../hooks/useAutosave'
import { cn } from '../lib/utils'

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
    <div
      data-testid="field-column"
      className="lt:w-full lt:min-w-0 lt:@3xl:max-w-[760px] lt:flex-1"
    >
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

function usePreviewState(slug: string, hasPreview: boolean) {
  const [isOpen, setIsOpen] = useState(() => {
    if (!hasPreview) return false
    try {
      return localStorage.getItem(`lontar:preview:open:global:${slug}`) === 'true'
    } catch {
      return false
    }
  })

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(`lontar:preview:open:global:${slug}`, String(next))
      } catch {
        // Ignore localStorage error
      }
      return next
    })
  }, [slug])

  const close = useCallback(() => {
    setIsOpen(false)
    try {
      localStorage.setItem(`lontar:preview:open:global:${slug}`, 'false')
    } catch {
      // Ignore localStorage error
    }
  }, [slug])

  return { isOpen, toggle, close }
}

export interface UseGlobalMutationsOptions {
  apiBase: string
  slug: string
  fields: ClientField[]
  hasDrafts?: boolean
  reset: (values?: Record<string, unknown>) => void
  setError?: UseFormSetError<Record<string, unknown>>
  setApiError: (msg: string | null) => void
  setSuccessMsg: (msg: string | null) => void
  onSaveSuccess?: () => void
  onDocApplied?: (doc: Record<string, unknown>) => void
}

function handleValidationError(
  err: unknown,
  setError?: UseFormSetError<Record<string, unknown>>,
  setApiError?: (msg: string | null) => void,
) {
  if (err instanceof ApiClientError && err.issues && setError) {
    for (const issue of err.issues) {
      const fieldName = issue.path?.[0]
      if (fieldName !== undefined) {
        setError(String(fieldName), { message: issue.message })
      }
    }
  }
  setApiError?.(err instanceof Error ? err.message : 'Operation failed.')
}

function useGlobalMutations({
  apiBase,
  slug,
  fields,
  hasDrafts,
  reset,
  setError,
  setApiError,
  setSuccessMsg,
  onSaveSuccess,
  onDocApplied,
}: UseGlobalMutationsOptions) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async ({ values, draft }: { values: Record<string, unknown>; draft?: boolean }) => {
      setApiError(null)
      setSuccessMsg(null)
      return saveGlobal(apiBase, slug, formatDocForSubmit(fields, values), { draft })
    },
    onSuccess: (saved, vars) => {
      onDocApplied?.(saved)
      reset(formatDocForForm(fields, saved))
      if (hasDrafts) {
        setSuccessMsg(vars.draft ? 'Draft saved successfully.' : 'Published successfully.')
      } else {
        setSuccessMsg('Changes saved successfully.')
      }
      queryClient.setQueryData(queryKeys.global(slug), saved)
      void queryClient.invalidateQueries({ queryKey: queryKeys.global(slug) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.globalVersions(apiBase, slug) })
      onSaveSuccess?.()
    },
    onError: (err: Error) => handleValidationError(err, setError, setApiError),
  })

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      setApiError(null)
      setSuccessMsg(null)
      return unpublishGlobal(apiBase, slug)
    },
    onSuccess: (unpublished) => {
      onDocApplied?.(unpublished)
      reset(formatDocForForm(fields, unpublished))
      setSuccessMsg('Unpublished successfully.')
      queryClient.setQueryData(queryKeys.global(slug), unpublished)
      void queryClient.invalidateQueries({ queryKey: queryKeys.global(slug) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.globalVersions(apiBase, slug) })
      onSaveSuccess?.()
    },
    onError: (err: Error) => setApiError(err.message || 'Failed to unpublish.'),
  })

  return { saveMutation, unpublishMutation }
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

export interface UseGlobalEditorAutosaveProps {
  apiBase: string
  slug: string
  global: ClientGlobal
  isDirty: boolean
  errors: FieldErrors<Record<string, unknown>>
  formValues: Record<string, unknown>
  getValues: UseFormGetValues<Record<string, unknown>>
  schema: z.ZodTypeAny
  reset: UseFormReset<Record<string, unknown>>
  onDocApplied?: (doc: Record<string, unknown>) => void
}

function useGlobalEditorAutosave({
  apiBase,
  slug,
  global,
  isDirty,
  errors,
  formValues,
  getValues,
  schema,
  reset,
  onDocApplied,
}: UseGlobalEditorAutosaveProps) {
  const queryClient = useQueryClient()
  const hasDrafts = Boolean(global.versions?.drafts)
  const autosaveEnabled = hasDrafts && Boolean(global.versions?.autosave)
  const autosaveInterval = global.versions?.autosave?.interval ?? 2000

  const isValid = useMemo(() => {
    if (Object.keys(errors).length > 0) return false
    const values = formValues && Object.keys(formValues).length > 0 ? formValues : getValues()
    const payload = formatDocForSubmit(global.fields, values)
    return schema.safeParse(payload).success
  }, [errors, formValues, getValues, global.fields, schema])

  const onAutosave = useCallback(async () => {
    const values = getValues()
    const payload = formatDocForSubmit(global.fields, values)
    return saveGlobal(apiBase, slug, payload, { draft: true, autosave: true })
  }, [apiBase, global.fields, slug, getValues])

  const onAutosaveSuccess = useCallback(
    (savedDoc: Record<string, unknown>) => {
      onDocApplied?.(savedDoc)
      reset(formatDocForForm(global.fields, savedDoc), { keepValues: true })
      queryClient.setQueryData(queryKeys.global(slug), savedDoc)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.globalVersions(apiBase, slug),
      })
    },
    [apiBase, global.fields, onDocApplied, queryClient, reset, slug],
  )

  const autosave = useAutosave({
    enabled: autosaveEnabled,
    interval: autosaveInterval,
    isDirty,
    isValid,
    values: formValues,
    onSave: onAutosave,
    onSuccess: onAutosaveSuccess,
  })

  return { autosave, autosaveEnabled }
}

export interface UseGlobalEditorActionsProps {
  hasDrafts: boolean
  cancelAutosave: () => Promise<void> | void
  handleSubmit: UseFormHandleSubmit<Record<string, unknown>>
  saveMutation: UseMutationResult<
    Record<string, unknown>,
    Error,
    { values: Record<string, unknown>; draft?: boolean }
  >
  unpublishMutation: UseMutationResult<Record<string, unknown>, Error, void>
}

function useGlobalEditorActions({
  hasDrafts,
  cancelAutosave,
  handleSubmit,
  saveMutation,
  unpublishMutation,
}: UseGlobalEditorActionsProps) {
  const submitWithDraft = (draft: boolean) => {
    void handleSubmit(async (values) => {
      await cancelAutosave()
      saveMutation.mutate({ values, draft: hasDrafts ? draft : undefined })
    })()
  }

  const onPublish = () => submitWithDraft(false)
  const onSaveDraft = () => submitWithDraft(true)
  const onUnpublish = () => {
    void (async () => {
      await cancelAutosave()
      unpublishMutation.mutate()
    })()
  }

  const isPublishing = saveMutation.isPending && !saveMutation.variables?.draft
  const isSavingDraft = saveMutation.isPending && Boolean(saveMutation.variables?.draft)

  return { onPublish, onSaveDraft, onUnpublish, isPublishing, isSavingDraft }
}

export interface GlobalEditorSidebarProps {
  submitLabel: string
  isSaving: boolean
  doc?: Record<string, unknown> | null
  hasDrafts: boolean
  hasVersions: boolean
  hasPreview: boolean
  preview: ReturnType<typeof usePreviewState>
  onOpenHistory: () => void
  autosaveEnabled: boolean
  autosave?: ReturnType<typeof useAutosave>
  onPublish: () => void
  onSaveDraft?: () => void
  onUnpublish?: () => void
  isPublishing: boolean
  isSavingDraft: boolean
  isUnpublishing: boolean
}

function GlobalEditorSidebar(props: GlobalEditorSidebarProps) {
  return (
    <DocumentSidebar
      mode="edit"
      submitLabel={props.submitLabel}
      isPending={props.isSaving || props.isUnpublishing}
      showDelete={false}
      showId={false}
      doc={props.doc}
      hasDrafts={props.hasDrafts}
      hasVersions={props.hasVersions}
      hasPreview={props.hasPreview}
      isPreviewOpen={props.preview.isOpen}
      onTogglePreview={props.preview.toggle}
      onOpenHistory={props.onOpenHistory}
      autosave={props.autosaveEnabled ? props.autosave : undefined}
      onPublish={props.onPublish}
      onSaveDraft={props.hasDrafts ? props.onSaveDraft : undefined}
      onUnpublish={props.hasDrafts ? props.onUnpublish : undefined}
      isPublishing={props.isPublishing}
      isSavingDraft={props.isSavingDraft}
      isUnpublishing={props.isUnpublishing}
    />
  )
}

export interface UseResetGlobalFormOnDocLoadedOptions {
  doc: Record<string, unknown> | null | undefined
  fields: ClientField[]
  slug: string
  isDirty: boolean
  reset: (values?: Record<string, unknown>) => void
  lastAppliedDocRef: React.MutableRefObject<Record<string, unknown> | null>
}

function useResetFormOnDocLoaded({
  doc,
  fields,
  slug,
  isDirty,
  reset,
  lastAppliedDocRef,
}: UseResetGlobalFormOnDocLoadedOptions) {
  const lastLoadedSlugRef = useRef<string | null>(null)

  useEffect(() => {
    if (!doc) return
    if (slug !== lastLoadedSlugRef.current) {
      lastLoadedSlugRef.current = slug
      lastAppliedDocRef.current = null
    }

    if (isSameDoc(doc, lastAppliedDocRef.current)) return
    if (lastAppliedDocRef.current !== null && isDirty) return

    lastAppliedDocRef.current = doc
    reset(formatDocForForm(fields, doc))
  }, [doc, fields, isDirty, lastAppliedDocRef, reset, slug])
}

export interface GlobalPreviewSectionProps {
  hasPreview: boolean
  isOpen: boolean
  urlTemplate?: string
  slug: string
  values: Record<string, unknown>
  savedValues?: Record<string, unknown> | null
  onClose: () => void
  activeView?: 'edit' | 'preview'
}

function GlobalPreviewSection(props: GlobalPreviewSectionProps) {
  if (!props.hasPreview || !props.isOpen || !props.urlTemplate) return null
  return (
    <div
      className={cn(
        'lt:w-full lt:xl:w-1/2 lt:xl:sticky lt:xl:top-8 lt:xl:h-[calc(100vh-5rem)] lt:h-[600px] lt:shrink-0',
        props.activeView === 'edit' && 'lt:hidden lt:xl:block',
      )}
    >
      <PreviewPane
        collectionSlug={props.slug}
        urlTemplate={props.urlTemplate}
        values={props.values}
        savedValues={props.savedValues}
        onClose={props.onClose}
      />
    </div>
  )
}

export interface GlobalVersionHistoryProps {
  hasVersions: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  apiBase: string
  global: ClientGlobal
  currentDoc: Record<string, unknown> | null | undefined
  onRestore: (restored: Record<string, unknown>) => void
}

function GlobalVersionHistory({
  hasVersions,
  open,
  onOpenChange,
  apiBase,
  global,
  currentDoc,
  onRestore,
}: GlobalVersionHistoryProps) {
  if (!hasVersions) return null
  return (
    <VersionHistorySheet
      open={open}
      onOpenChange={onOpenChange}
      apiBase={apiBase}
      global={global}
      currentDoc={currentDoc}
      onRestoreSuccess={onRestore}
    />
  )
}

export interface GlobalEditorProps {
  global: ClientGlobal
  slug: string
  apiBase: string
}

function GlobalEditor({ global, slug, apiBase }: GlobalEditorProps) {
  const queryClient = useQueryClient()
  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const hasDrafts = Boolean(global.versions?.drafts)
  const hasVersions = Boolean(global.versions)
  const previewUrlTemplate = global.admin?.preview?.url
  const hasPreview = Boolean(previewUrlTemplate)
  const preview = usePreviewState(slug, hasPreview)
  const editorView = useEditorView(preview)

  const globalQuery = useQuery({
    queryKey: queryKeys.global(slug),
    queryFn: () => fetchGlobal(apiBase, slug, { draft: hasDrafts }),
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
    getValues,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const formValues = watch()

  const lastAppliedDocRef = useRef<Record<string, unknown> | null>(null)
  const onDocApplied = useCallback((doc: Record<string, unknown>) => {
    lastAppliedDocRef.current = doc
  }, [])

  useResetFormOnDocLoaded({
    doc: globalQuery.data,
    fields: global.fields,
    slug,
    isDirty,
    reset,
    lastAppliedDocRef,
  })

  const { autosave, autosaveEnabled } = useGlobalEditorAutosave({
    apiBase,
    slug,
    global,
    isDirty,
    errors,
    formValues,
    getValues,
    schema,
    reset,
    onDocApplied,
  })

  const { saveMutation, unpublishMutation } = useGlobalMutations({
    apiBase,
    slug,
    fields: global.fields,
    hasDrafts,
    reset,
    setError,
    setApiError,
    setSuccessMsg,
    onDocApplied,
    onSaveSuccess: () => {
      void autosave.cancelAutosave()
    },
  })

  const { onPublish, onSaveDraft, onUnpublish, isPublishing, isSavingDraft } =
    useGlobalEditorActions({
      hasDrafts,
      cancelAutosave: autosave.cancelAutosave,
      handleSubmit,
      saveMutation,
      unpublishMutation,
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

      <EditorSplitLayout
        hasPreview={hasPreview}
        isPreviewOpen={preview.isOpen}
        activeView={editorView.activeView}
        onViewChange={editorView.setActiveView}
        preview={
          <GlobalPreviewSection
            hasPreview={hasPreview}
            isOpen={preview.isOpen}
            urlTemplate={previewUrlTemplate}
            slug={global.slug}
            values={formatDocForSubmit(global.fields, formValues)}
            savedValues={globalQuery.data}
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
          <GlobalFormFields
            fields={global.fields}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
            errors={errors}
          />

          <GlobalEditorSidebar
            submitLabel={submitLabel}
            isSaving={isSaving}
            doc={globalQuery.data}
            hasDrafts={hasDrafts}
            hasVersions={hasVersions}
            hasPreview={hasPreview}
            preview={{
              isOpen: preview.isOpen,
              toggle: editorView.toggle,
              close: editorView.close,
            }}
            onOpenHistory={() => setIsHistoryOpen(true)}
            autosaveEnabled={autosaveEnabled}
            autosave={autosave}
            onPublish={onPublish}
            onSaveDraft={onSaveDraft}
            onUnpublish={onUnpublish}
            isPublishing={isPublishing}
            isSavingDraft={isSavingDraft}
            isUnpublishing={unpublishMutation.isPending}
          />
        </form>
      </EditorSplitLayout>

      <GlobalVersionHistory
        hasVersions={hasVersions}
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        apiBase={apiBase}
        global={global}
        currentDoc={globalQuery.data}
        onRestore={(restored) => {
          onDocApplied(restored)
          queryClient.setQueryData(queryKeys.global(slug), restored)
          reset(formatDocForForm(global.fields, restored))
          setSuccessMsg('Version restored successfully.')
        }}
      />
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
