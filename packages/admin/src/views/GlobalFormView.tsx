import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { FormControl, FormRegister, FormSetValue, FormWatch } from '../fields/form-types'
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { useNavigate, useParams, useBlocker } from '@tanstack/react-router'
import {
  useForm,
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
  type ClientAction,
  type ClientField,
  type ClientGlobal,
  type ClientLocale,
  type FieldPermission,
  type GlobalPermission,
} from '@lontar/core/client'
import { DocumentFormProvider } from '../context/DocumentFormContext'
import { useAdmin, useGlobal } from '../context/AdminContext'
import { usePermissions, useGlobalPermissions } from '../context/PermissionsContext'
import { fetchGlobal, saveGlobal, unpublishGlobal, ApiClientError, queryKeys } from '../api/client'
import { ScopeFieldList } from '../fields/FieldRenderer'
import { TabMemoryProvider } from '../fields/LayoutFields'
import {
  buildFormValidationFields,
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
import { useDeclarativeAction } from './useDeclarativeAction'
import { VersionHistorySheet } from './VersionHistorySheet'
import { PreviewPane } from './preview/PreviewPane'
import { EditorSplitLayout, useEditorView } from './preview/EditorSplitLayout'
import { useAutosave } from '../hooks/useAutosave'
import { useLocale } from '../hooks/useLocale'
import { LocaleSwitcher } from './LocaleSwitcher'
import { cn } from '../lib/utils'

export interface GlobalFormFieldsProps {
  fields: ClientField[]
  control: FormControl
  register: FormRegister
  setValue: FormSetValue
  watch: FormWatch
  errors: FieldErrors<Record<string, unknown>>
  permissions?: Record<string, FieldPermission>
  readOnlyDoc?: boolean
  fallbackDoc?: Record<string, unknown> | null
  hasLocalization?: boolean
}

function GlobalFormFields({
  fields,
  control,
  register,
  setValue,
  watch,
  errors,
  permissions,
  readOnlyDoc,
  fallbackDoc,
  hasLocalization,
}: GlobalFormFieldsProps) {
  return (
    <div
      data-testid="field-column"
      className="lt:w-full lt:min-w-0 lt:@3xl:max-w-[760px] lt:flex-1"
    >
      <Card className="lt:block lt:p-8 lt:shadow-none">
        <div className="lt:flex lt:flex-col lt:gap-6">
          <ScopeFieldList
            fields={fields}
            control={control}
            register={register}
            setValue={setValue}
            watch={watch}
            mode="edit"
            scopeErrors={errors}
            scopePermissions={permissions}
            readOnlyDoc={readOnlyDoc}
            scopeFallback={fallbackDoc ?? undefined}
            hasLocalization={hasLocalization}
          />
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
  permissions?: Record<string, FieldPermission>
  locale?: string
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
  permissions,
  locale,
}: UseGlobalMutationsOptions) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async ({ values, draft }: { values: Record<string, unknown>; draft?: boolean }) => {
      setApiError(null)
      setSuccessMsg(null)
      return saveGlobal(
        apiBase,
        slug,
        formatDocForSubmit(fields, values, true, permissions, 'edit'),
        { draft, locale },
      )
    },
    onSuccess: (saved, vars) => {
      onDocApplied?.(saved)
      reset(formatDocForForm(fields, saved))
      if (hasDrafts) {
        setSuccessMsg(vars.draft ? 'Draft saved successfully.' : 'Published successfully.')
      } else {
        setSuccessMsg('Changes saved successfully.')
      }
      queryClient.setQueryData(queryKeys.global(slug, locale), saved)
      void queryClient.invalidateQueries({ queryKey: queryKeys.globalVersions(apiBase, slug) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.globalPermissionsPrefix(apiBase, slug),
      })
      onSaveSuccess?.()
    },
    onError: (err: Error) => handleValidationError(err, setError, setApiError),
  })

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      setApiError(null)
      setSuccessMsg(null)
      return unpublishGlobal(apiBase, slug, { locale })
    },
    onSuccess: (unpublished) => {
      onDocApplied?.(unpublished)
      reset(formatDocForForm(fields, unpublished))
      setSuccessMsg('Unpublished successfully.')
      queryClient.setQueryData(queryKeys.global(slug, locale), unpublished)
      void queryClient.invalidateQueries({ queryKey: queryKeys.globalVersions(apiBase, slug) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.globalPermissionsPrefix(apiBase, slug),
      })
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
  permissions?: Record<string, FieldPermission>
  readOnlyDoc?: boolean
  locale?: string
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
  permissions,
  readOnlyDoc,
  locale,
}: UseGlobalEditorAutosaveProps) {
  const queryClient = useQueryClient()
  const hasDrafts = Boolean(global.versions?.drafts)
  const autosaveEnabled = !readOnlyDoc && hasDrafts && Boolean(global.versions?.autosave)
  const autosaveInterval = global.versions?.autosave?.interval ?? 2000

  const isValid = useMemo(() => {
    if (Object.keys(errors).length > 0) return false
    const values = formValues && Object.keys(formValues).length > 0 ? formValues : getValues()
    const payload = formatDocForSubmit(global.fields, values, true, undefined, 'edit')
    return schema.safeParse(payload).success
  }, [errors, formValues, getValues, global.fields, schema])

  const onAutosave = useCallback(async () => {
    const values = getValues()
    const payload = formatDocForSubmit(global.fields, values, true, permissions, 'edit')
    return saveGlobal(apiBase, slug, payload, { draft: true, autosave: true, locale })
  }, [apiBase, global.fields, slug, getValues, permissions, locale])

  const onAutosaveSuccess = useCallback(
    (savedDoc: Record<string, unknown>) => {
      onDocApplied?.(savedDoc)
      reset(formatDocForForm(global.fields, savedDoc), { keepValues: true })
      queryClient.setQueryData(queryKeys.global(slug, locale), savedDoc)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.globalVersions(apiBase, slug),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.globalPermissionsPrefix(apiBase, slug),
      })
    },
    [apiBase, global.fields, locale, onDocApplied, queryClient, reset, slug],
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
  readOnly?: boolean
  documentActions?: ClientAction[]
  isActionPending?: boolean
  onExecuteAction?: (action: ClientAction) => void
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
      readOnly={props.readOnly}
      documentActions={props.documentActions}
      isActionPending={props.isActionPending}
      onExecuteAction={props.onExecuteAction}
    />
  )
}

export interface UseResetGlobalFormOnDocLoadedOptions {
  doc: Record<string, unknown> | null | undefined
  fields: ClientField[]
  slug: string
  locale?: string
  isDirty: boolean
  reset: (values?: Record<string, unknown>) => void
  lastAppliedDocRef: React.MutableRefObject<Record<string, unknown> | null>
}

function useResetFormOnDocLoaded({
  doc,
  fields,
  slug,
  locale,
  isDirty,
  reset,
  lastAppliedDocRef,
}: UseResetGlobalFormOnDocLoadedOptions) {
  const lastLoadedSlugRef = useRef<string | null>(null)
  const currentKey = `${slug}:${locale ?? ''}`

  useEffect(() => {
    if (!doc) return
    if (currentKey !== lastLoadedSlugRef.current) {
      lastLoadedSlugRef.current = currentKey
      lastAppliedDocRef.current = null
    }

    if (isSameDoc(doc, lastAppliedDocRef.current)) return
    if (lastAppliedDocRef.current !== null && isDirty) return

    lastAppliedDocRef.current = doc
    reset(formatDocForForm(fields, doc))
  }, [currentKey, doc, fields, isDirty, lastAppliedDocRef, reset])
}

function useFallbackGlobalQuery(
  apiBase: string,
  slug?: string,
  hasDrafts?: boolean,
  hasLocalization?: boolean,
  activeLocale?: string,
  fallbackLocale?: string,
) {
  const isEnabled =
    Boolean(slug) &&
    Boolean(hasLocalization) &&
    Boolean(fallbackLocale) &&
    activeLocale !== fallbackLocale

  return useQuery({
    queryKey: slug ? queryKeys.global(slug, fallbackLocale) : ['fallbackGlobal'],
    queryFn: () =>
      slug && fallbackLocale
        ? fetchGlobal(apiBase, slug, {
            draft: hasDrafts,
            locale: fallbackLocale,
            fallbackLocale: 'none',
          })
        : null,
    enabled: isEnabled,
    refetchOnWindowFocus: false,
  })
}

function confirmAction(message: string): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return true
  }
  return window.confirm(message)
}

interface UseGlobalLocaleNavigationOptions {
  activeLocale?: string
  isDirty: boolean
}

function useGlobalLocaleNavigation({ activeLocale, isDirty }: UseGlobalLocaleNavigationOptions) {
  const navigate = useNavigate()
  const isSwitchingLocaleRef = useRef(false)

  useBlocker({
    shouldBlockFn: () => {
      if (!isDirty) return false
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

export interface GlobalPreviewSectionProps {
  hasPreview: boolean
  isOpen: boolean
  urlTemplate?: string
  slug: string
  values: Record<string, unknown>
  savedValues?: Record<string, unknown> | null
  locale?: string
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
        locale={props.locale}
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
  canRestore?: boolean
}

function GlobalVersionHistory({
  hasVersions,
  open,
  onOpenChange,
  apiBase,
  global,
  currentDoc,
  onRestore,
  canRestore,
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
      canRestore={canRestore}
    />
  )
}

function useGlobalPermissionsState(globalPermissions?: GlobalPermission) {
  const readOnlyDoc = globalPermissions?.update === false
  const canReadVersions = globalPermissions?.readVersions !== false
  const fieldPermissions = globalPermissions?.fields
  const isUnreadable = Boolean(globalPermissions && globalPermissions.read === false)
  return { readOnlyDoc, canReadVersions, fieldPermissions, isUnreadable }
}

function shouldShowGlobalQueryState(
  isLoadingQuery: boolean,
  isLoadingPerms: boolean,
  error: unknown,
): boolean {
  return isLoadingQuery || isLoadingPerms || Boolean(error)
}

function getGlobalSubmitLabel(isSaving: boolean): string {
  return isSaving ? 'Saving...' : 'Save Changes'
}

interface UseGlobalQueriesOptions {
  apiBase: string
  slug: string
  hasDrafts: boolean
  hasLocalization: boolean
  activeLocale?: string
  fallbackLocale?: string
}

function useGlobalQueries({
  apiBase,
  slug,
  hasDrafts,
  hasLocalization,
  activeLocale,
  fallbackLocale,
}: UseGlobalQueriesOptions) {
  const currentLocale = hasLocalization ? activeLocale : undefined
  const globalQuery = useQuery({
    queryKey: queryKeys.global(slug, currentLocale),
    queryFn: () =>
      fetchGlobal(apiBase, slug, {
        draft: hasDrafts,
        locale: currentLocale,
        fallbackLocale: hasLocalization ? 'none' : undefined,
      }),
    refetchOnWindowFocus: false,
  })

  const fallbackQuery = useFallbackGlobalQuery(
    apiBase,
    slug,
    hasDrafts,
    hasLocalization,
    activeLocale,
    fallbackLocale,
  )
  const fallbackDoc =
    hasLocalization && activeLocale !== fallbackLocale ? fallbackQuery.data : undefined

  return { globalQuery, fallbackDoc, currentLocale }
}

function useGlobalForm(
  global: ClientGlobal,
  fieldPermissions?: Record<string, FieldPermission>,
  readOnlyDoc?: boolean,
) {
  const schema = useMemo(
    () =>
      clientFieldsToZod(
        buildFormValidationFields(global.fields, fieldPermissions, 'edit', readOnlyDoc),
      ),
    [global.fields, fieldPermissions, readOnlyDoc],
  )
  const defaultValues = useMemo(() => computeDefaultValues(global.fields), [global])

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const formValues = form.watch()
  return { ...form, formValues, schema }
}

interface UseGlobalVersionRestoreOptions {
  apiBase: string
  slug: string
  locale?: string
  fields: ClientField[]
  reset: (values?: Record<string, unknown>) => void
  onDocApplied: (doc: Record<string, unknown>) => void
  setSuccessMsg: (msg: string | null) => void
}

function useGlobalVersionRestore({
  apiBase,
  slug,
  locale,
  fields,
  reset,
  onDocApplied,
  setSuccessMsg,
}: UseGlobalVersionRestoreOptions) {
  const queryClient = useQueryClient()

  return useCallback(
    (restored: Record<string, unknown>) => {
      onDocApplied(restored)
      queryClient.setQueryData(queryKeys.global(slug, locale), restored)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.globalPermissionsPrefix(apiBase, slug),
      })
      reset(formatDocForForm(fields, restored))
      setSuccessMsg('Version restored successfully.')
    },
    [apiBase, fields, locale, onDocApplied, queryClient, reset, setSuccessMsg, slug],
  )
}

function renderGlobalLocaleSwitcher(
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

function useGlobalDocumentActions(
  global: ClientGlobal,
  globalPermissions?: GlobalPermission,
  canExecuteGlobalAction?: (slug: string, key: string) => boolean,
): ClientAction[] {
  return useMemo(() => {
    const actions = global.admin?.actions
    if (!actions) return []
    return actions.filter(
      (action) =>
        action.scope.includes('document') &&
        globalPermissions?.actions?.[action.key] !== false &&
        (canExecuteGlobalAction ? canExecuteGlobalAction(global.slug, action.key) : true),
    )
  }, [global.admin?.actions, global.slug, globalPermissions?.actions, canExecuteGlobalAction])
}

function useGlobalEditorData({
  apiBase,
  slug,
  hasDrafts,
  hasLocalization,
  activeLocale,
  fallbackLocale,
}: {
  apiBase: string
  slug: string
  hasDrafts: boolean
  hasLocalization: boolean
  activeLocale?: string
  fallbackLocale?: string
}) {
  const { globalQuery, fallbackDoc, currentLocale } = useGlobalQueries({
    apiBase,
    slug,
    hasDrafts,
    hasLocalization,
    activeLocale,
    fallbackLocale,
  })

  const { data: globalPermissions, isLoading: isGlobalPermsLoading } = useGlobalPermissions(
    apiBase,
    slug,
  )

  const { readOnlyDoc, canReadVersions, fieldPermissions, isUnreadable } =
    useGlobalPermissionsState(globalPermissions)

  const isQueryLoading = globalQuery.isLoading || isGlobalPermsLoading
  const showQueryState = shouldShowGlobalQueryState(
    globalQuery.isLoading,
    isGlobalPermsLoading,
    globalQuery.error,
  )

  return {
    globalQuery,
    globalPermissions,
    fallbackDoc,
    currentLocale,
    readOnlyDoc,
    canReadVersions,
    fieldPermissions,
    isUnreadable,
    showQueryState,
    isQueryLoading,
  }
}

function resolveGlobalEditorStatus(
  isSubmitting: boolean,
  isSavePending: boolean,
  declarativeAction: { actionError: string | null; actionSuccess: string | null },
  apiError: string | null,
  successMsg: string | null,
) {
  const isSaving = isSubmitting || isSavePending
  const submitLabel = getGlobalSubmitLabel(isSaving)
  const displayError = declarativeAction.actionError || apiError
  const displaySuccess = declarativeAction.actionSuccess || successMsg
  return { isSaving, submitLabel, displayError, displaySuccess }
}

export interface GlobalEditorProps {
  global: ClientGlobal
  slug: string
  apiBase: string
}

function GlobalEditor({ global, slug, apiBase }: GlobalEditorProps) {
  const [apiError, setApiError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const { hasLocalization, activeLocale, fallbackLocale, locales } = useLocale()
  const hasDrafts = Boolean(global.versions?.drafts)
  const hasVersions = Boolean(global.versions)
  const previewUrlTemplate = global.admin?.preview?.url
  const hasPreview = Boolean(previewUrlTemplate)
  const preview = usePreviewState(slug, hasPreview)
  const editorView = useEditorView(preview)

  const {
    globalQuery,
    globalPermissions,
    fallbackDoc,
    currentLocale,
    readOnlyDoc,
    canReadVersions,
    fieldPermissions,
    isUnreadable,
    showQueryState,
    isQueryLoading,
  } = useGlobalEditorData({
    apiBase,
    slug,
    hasDrafts,
    hasLocalization,
    activeLocale,
    fallbackLocale,
  })
  const { canExecuteGlobalAction } = usePermissions()

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
  } = useGlobalForm(global, fieldPermissions, readOnlyDoc)

  const { handleLocaleChange } = useGlobalLocaleNavigation({
    activeLocale,
    isDirty,
  })

  const lastAppliedDocRef = useRef<Record<string, unknown> | null>(null)
  const onDocApplied = useCallback((doc: Record<string, unknown>) => {
    lastAppliedDocRef.current = doc
  }, [])

  useResetFormOnDocLoaded({
    doc: globalQuery.data,
    fields: global.fields,
    slug,
    locale: currentLocale,
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
    permissions: fieldPermissions,
    readOnlyDoc,
    locale: currentLocale,
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
    permissions: fieldPermissions,
    locale: currentLocale,
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

  const onRestore = useGlobalVersionRestore({
    apiBase,
    slug,
    locale: currentLocale,
    fields: global.fields,
    reset,
    onDocApplied,
    setSuccessMsg,
  })

  const declarativeAction = useDeclarativeAction({
    apiBase,
    scopeType: 'global',
    slug: global.slug,
    locale: currentLocale,
  })

  const documentActions = useGlobalDocumentActions(
    global,
    globalPermissions,
    canExecuteGlobalAction,
  )

  const { isSaving, submitLabel, displayError, displaySuccess } = resolveGlobalEditorStatus(
    isSubmitting,
    saveMutation.isPending,
    declarativeAction,
    apiError,
    successMsg,
  )

  const onExecuteAction = useCallback(
    (action: ClientAction) => {
      declarativeAction.triggerAction(action, { doc: globalQuery.data })
    },
    [declarativeAction, globalQuery.data],
  )

  const canShowVersions = hasVersions && canReadVersions

  if (showQueryState) {
    return <GlobalQueryState isLoading={isQueryLoading} error={globalQuery.error} />
  }

  if (isUnreadable) {
    return <NotFoundView />
  }

  return (
    <div>
      <ViewHeader
        title={global.label}
        breadcrumbs={<GlobalBreadcrumbs label={global.label} />}
        actions={renderGlobalLocaleSwitcher(
          hasLocalization,
          locales,
          activeLocale,
          handleLocaleChange,
        )}
      />

      {declarativeAction.dialogs}

      <GlobalStatusAlerts apiError={displayError} successMsg={displaySuccess} />

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
            values={formatDocForSubmit(global.fields, formValues, true, fieldPermissions, 'edit')}
            savedValues={globalQuery.data}
            locale={currentLocale}
            onClose={editorView.close}
            activeView={editorView.activeView}
          />
        }
      >
        <DocumentFormProvider values={formValues}>
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
              permissions={fieldPermissions}
              readOnlyDoc={readOnlyDoc}
              fallbackDoc={fallbackDoc}
              hasLocalization={hasLocalization}
            />

            <GlobalEditorSidebar
              submitLabel={submitLabel}
              isSaving={isSaving}
              doc={globalQuery.data}
              hasDrafts={hasDrafts}
              hasVersions={canShowVersions}
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
              readOnly={readOnlyDoc}
              documentActions={documentActions}
              isActionPending={declarativeAction.isPending}
              onExecuteAction={onExecuteAction}
            />
          </form>
        </DocumentFormProvider>
      </EditorSplitLayout>

      <GlobalVersionHistory
        hasVersions={canShowVersions}
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        apiBase={apiBase}
        global={global}
        currentDoc={globalQuery.data}
        onRestore={onRestore}
        canRestore={!readOnlyDoc}
      />
    </div>
  )
}

export function GlobalFormView() {
  const { apiBase } = useAdmin()
  const { slug } = useParams({ strict: false })
  const global = useGlobal(slug)
  const { canReadGlobal } = usePermissions()

  if (!global || !slug) return <NotFoundView />
  if (!canReadGlobal(slug)) return <NotFoundView />

  return (
    <TabMemoryProvider key={slug}>
      <GlobalEditor global={global} slug={slug} apiBase={apiBase} />
    </TabMemoryProvider>
  )
}
