import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useFormState, useWatch } from 'react-hook-form'
import {
  extractConditionPaths,
  flattenClientFields,
  getValueByPath,
  matchesCondition,
  setValueByPath,
  type ClientCollapsibleField,
  type ClientField,
  type ClientRowField,
  type ClientTab,
  type ClientTabsField,
  type FieldPermission,
} from '@lontar/core/client'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { cn } from '../lib/utils'
import type { FormControl, FormWatch } from './form-types'

export function buildWatchedRootValues(
  watchedPaths: string[],
  watchedValues: unknown,
  fallbackWatch?: () => Record<string, unknown>,
): Record<string, unknown> {
  if (watchedPaths.length > 0) {
    if (Array.isArray(watchedValues)) {
      const root: Record<string, unknown> = {}
      watchedPaths.forEach((path, i) => {
        setValueByPath(root, path, watchedValues[i])
      })
      return root
    }
    return fallbackWatch ? fallbackWatch() : {}
  }
  if (watchedValues && typeof watchedValues === 'object' && !Array.isArray(watchedValues)) {
    return watchedValues as Record<string, unknown>
  }
  return fallbackWatch ? fallbackWatch() : {}
}

function countLeafErrorMessages(errObj: unknown): number {
  if (!errObj || typeof errObj !== 'object') return 0
  const record = errObj as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.length > 0) {
    return 1
  }
  let count = 0
  for (const [key, val] of Object.entries(record)) {
    if (key === 'ref') continue
    count += countLeafErrorMessages(val)
  }
  return count
}

export function countFieldErrors(
  fields: readonly ClientField[],
  scopeErrors: Record<string, unknown> | undefined,
): number {
  if (!scopeErrors || typeof scopeErrors !== 'object') return 0
  let total = 0
  for (const field of flattenClientFields(fields)) {
    const fieldErr = Object.hasOwn(scopeErrors, field.name) ? scopeErrors[field.name] : undefined
    if (!fieldErr) continue

    if (field.type === 'group') {
      const nested = countFieldErrors(field.fields, fieldErr as Record<string, unknown>)
      total += nested > 0 ? nested : countLeafErrorMessages(fieldErr)
    } else if (field.type === 'array' || field.type === 'blocks') {
      total += countLeafErrorMessages(fieldErr)
    } else {
      total += 1
    }
  }
  return total
}

export function hasReadableFields(
  fields: readonly ClientField[],
  scopePermissions?: Record<string, FieldPermission>,
): boolean {
  return flattenClientFields(fields).some((field) => {
    const perm = scopePermissions?.[field.name]
    if (perm?.read === false) return false
    if (field.type === 'group' && perm?.fields) {
      return hasReadableFields(field.fields, perm.fields)
    }
    return true
  })
}

function useScopeErrorsAndSubmitCount(
  control: FormControl,
  pathPrefix: string | undefined,
  scopeErrors?: Record<string, unknown>,
) {
  const { errors: formErrors, submitCount } = useFormState({ control })
  const rhfScopeErrors = pathPrefix
    ? (getValueByPath(formErrors, pathPrefix) as Record<string, unknown> | undefined)
    : (formErrors as Record<string, unknown>)
  const resolvedErrors = scopeErrors ?? rhfScopeErrors
  return { resolvedErrors, submitCount }
}

export interface RowFieldRendererProps {
  field: ClientRowField
  fullName: string
  scopePermissions?: Record<string, FieldPermission>
  renderFields: (fields: readonly ClientField[]) => ReactNode
}

export function RowFieldRenderer({
  field,
  fullName,
  scopePermissions,
  renderFields,
}: RowFieldRendererProps) {
  if (!hasReadableFields(field.fields, scopePermissions)) {
    return null
  }

  return (
    <div className="lontar-field-row lt:flex lt:flex-col lt:gap-2" data-row={fullName}>
      {field.admin?.description && (
        <p className="lt:text-xs lt:text-muted-foreground lt:m-0">{field.admin.description}</p>
      )}
      <div className="lt:grid lt:grid-cols-1 lt:md:grid-flow-col lt:md:auto-cols-fr lt:gap-4 lt:items-start lt:*:min-w-0">
        {renderFields(field.fields)}
      </div>
    </div>
  )
}

export interface CollapsibleFieldRendererProps {
  field: ClientCollapsibleField
  fullName: string
  control: FormControl
  pathPrefix?: string
  scopeErrors?: Record<string, unknown>
  scopePermissions?: Record<string, FieldPermission>
  renderFields: (fields: readonly ClientField[]) => ReactNode
}

export function CollapsibleFieldRenderer({
  field,
  fullName,
  control,
  pathPrefix,
  scopeErrors,
  scopePermissions,
  renderFields,
}: CollapsibleFieldRendererProps) {
  const contentId = useId()
  const [open, setOpen] = useState(!field.initiallyCollapsed)
  const { resolvedErrors, submitCount } = useScopeErrorsAndSubmitCount(
    control,
    pathPrefix,
    scopeErrors,
  )
  const errorCount = countFieldErrors(field.fields, resolvedErrors)
  const prevSubmitCountRef = useRef(submitCount)
  const prevErrorCountRef = useRef(errorCount)

  useEffect(() => {
    const submitChanged = submitCount > prevSubmitCountRef.current
    const errorAppeared = errorCount > 0 && prevErrorCountRef.current === 0
    prevSubmitCountRef.current = submitCount
    prevErrorCountRef.current = errorCount

    if ((submitChanged && errorCount > 0) || errorAppeared) {
      setOpen(true)
    }
  }, [submitCount, errorCount])

  if (!hasReadableFields(field.fields, scopePermissions)) {
    return null
  }

  return (
    <div
      className="lontar-field-collapsible lt:rounded-lg lt:border lt:border-border lt:bg-card lt:overflow-hidden"
      data-collapsible={fullName}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        className="lt:flex lt:w-full lt:items-center lt:justify-between lt:gap-2 lt:border-0 lt:bg-muted/40 lt:px-4 lt:py-3 lt:text-left lt:text-sm lt:font-semibold lt:text-foreground lt:hover:bg-muted/70 lt:focus-visible:outline-none lt:focus-visible:ring-1 lt:focus-visible:ring-ring lt:cursor-pointer"
      >
        <span className="lt:flex lt:items-center lt:gap-2">
          {open ? (
            <ChevronDown className="lt:size-4 lt:text-muted-foreground lt:shrink-0" />
          ) : (
            <ChevronRight className="lt:size-4 lt:text-muted-foreground lt:shrink-0" />
          )}
          <span>{field.label}</span>
        </span>
        {errorCount > 0 && (
          <Badge
            variant="destructive"
            className="lt:h-5 lt:min-w-5 lt:px-1.5 lt:text-[0.6875rem]"
            data-testid={`collapsible-error-badge-${fullName}`}
            aria-label={`${errorCount} validation ${errorCount === 1 ? 'error' : 'errors'}`}
          >
            {errorCount}
          </Badge>
        )}
      </button>
      <div
        id={contentId}
        hidden={!open}
        className={cn(
          'lt:p-4 lt:border-t lt:border-border lt:flex lt:flex-col lt:gap-4',
          !open && 'lt:hidden',
        )}
      >
        {field.admin?.description && (
          <p className="lt:text-xs lt:text-muted-foreground lt:m-0">{field.admin.description}</p>
        )}
        {renderFields(field.fields)}
      </div>
    </div>
  )
}

interface VisibleTabEntry {
  tab: ClientTab
  value: string
  errorCount: number
}

function collectTabConditionPaths(tabs: readonly ClientTab[], pathPrefix?: string): string[] {
  const paths = new Set<string>()
  for (const tab of tabs) {
    const cond = tab.condition ?? tab.admin?.condition
    if (!cond) continue
    for (const p of extractConditionPaths(cond, pathPrefix)) {
      paths.add(p)
    }
  }
  return Array.from(paths)
}

function useVisibleTabs(
  tabs: readonly ClientTab[],
  control: FormControl,
  watch: FormWatch | undefined,
  pathPrefix: string | undefined,
  scopePermissions: Record<string, FieldPermission> | undefined,
  resolvedErrors: Record<string, unknown> | undefined,
): VisibleTabEntry[] {
  const watchedPaths = useMemo(() => collectTabConditionPaths(tabs, pathPrefix), [tabs, pathPrefix])
  const watchedValues: unknown = useWatch({
    control,
    name: (watchedPaths.length > 0 ? (watchedPaths as readonly string[]) : undefined) as never,
  })
  const rootValues = buildWatchedRootValues(
    watchedPaths,
    watchedValues,
    watch ? () => watch() : undefined,
  )
  const siblingData = pathPrefix
    ? (getValueByPath(rootValues, pathPrefix) as Record<string, unknown> | undefined)
    : rootValues

  const visible: VisibleTabEntry[] = []
  tabs.forEach((tab, index) => {
    if (!hasReadableFields(tab.fields, scopePermissions)) return
    const cond = tab.condition ?? tab.admin?.condition
    if (cond && !matchesCondition(cond, rootValues, siblingData)) return
    visible.push({
      tab,
      value: `tab-${index}`,
      errorCount: countFieldErrors(tab.fields, resolvedErrors),
    })
  })
  return visible
}

function scrollInvalidFieldInPanel(root: HTMLElement | null, tabValue: string): void {
  if (!root) return
  const panel = root.querySelector(`[data-tab-panel="${tabValue}"]`)
  if (!panel) return
  const invalidEl = panel.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')
  if (!invalidEl) return
  invalidEl.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  if (typeof invalidEl.focus === 'function' && invalidEl.tabIndex >= 0) {
    invalidEl.focus({ preventScroll: true })
  }
}

const TabMemoryContext = createContext<Map<string, string> | null>(null)

export interface TabMemoryProviderProps {
  children: ReactNode
}

/**
 * Remembers active tabs across temporary unmounts (e.g. locale reload) while
 * the same document editor instance remains open.
 */
export function TabMemoryProvider({ children }: TabMemoryProviderProps) {
  const memoryRef = useRef<Map<string, string>>(new Map())
  return <TabMemoryContext.Provider value={memoryRef.current}>{children}</TabMemoryContext.Provider>
}

export interface TabsFieldRendererProps {
  field: ClientTabsField
  fullName: string
  control: FormControl
  watch?: FormWatch
  pathPrefix?: string
  scopeErrors?: Record<string, unknown>
  scopePermissions?: Record<string, FieldPermission>
  renderFields: (fields: readonly ClientField[]) => ReactNode
}

export function TabsFieldRenderer({
  field,
  fullName,
  control,
  watch,
  pathPrefix,
  scopeErrors,
  scopePermissions,
  renderFields,
}: TabsFieldRendererProps) {
  const { resolvedErrors, submitCount } = useScopeErrorsAndSubmitCount(
    control,
    pathPrefix,
    scopeErrors,
  )
  const visibleTabs = useVisibleTabs(
    field.tabs,
    control,
    watch,
    pathPrefix,
    scopePermissions,
    resolvedErrors,
  )
  const tabMemory = useContext(TabMemoryContext)
  const [activeTab, setActiveTabState] = useState<string>(
    () => tabMemory?.get(fullName) ?? visibleTabs[0]?.value ?? 'tab-0',
  )
  const setActiveTab = useCallback(
    (next: string) => {
      tabMemory?.set(fullName, next)
      setActiveTabState(next)
    },
    [tabMemory, fullName],
  )
  const currentTab = visibleTabs.some((t) => t.value === activeTab)
    ? activeTab
    : (visibleTabs[0]?.value ?? '')

  const totalErrors = visibleTabs.reduce((sum, t) => sum + t.errorCount, 0)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollTabRef = useRef<string | null>(null)
  const prevSubmitCountRef = useRef(submitCount)
  const prevTotalErrorsRef = useRef(totalErrors)

  useEffect(() => {
    const submitChanged = submitCount > prevSubmitCountRef.current
    const errorsAppeared = totalErrors > 0 && prevTotalErrorsRef.current === 0
    prevSubmitCountRef.current = submitCount
    prevTotalErrorsRef.current = totalErrors

    if ((!submitChanged || totalErrors === 0) && !errorsAppeared) return

    const activeEntry = visibleTabs.find((t) => t.value === currentTab)
    if (activeEntry && activeEntry.errorCount > 0) {
      pendingScrollTabRef.current = currentTab
      return
    }
    const firstErrorTab = visibleTabs.find((t) => t.errorCount > 0)
    if (firstErrorTab) {
      setActiveTab(firstErrorTab.value)
      pendingScrollTabRef.current = firstErrorTab.value
    }
  }, [submitCount, totalErrors, visibleTabs, currentTab, setActiveTab])

  useEffect(() => {
    if (pendingScrollTabRef.current !== currentTab) return
    pendingScrollTabRef.current = null
    scrollInvalidFieldInPanel(tabsRef.current, currentTab)
  }, [currentTab, submitCount, totalErrors])

  if (visibleTabs.length === 0) {
    return null
  }

  return (
    <div
      ref={tabsRef}
      className="lontar-field-tabs lt:flex lt:flex-col lt:gap-3"
      data-tabs={fullName}
    >
      {field.admin?.description && (
        <p className="lt:text-xs lt:text-muted-foreground lt:m-0">{field.admin.description}</p>
      )}
      <Tabs value={currentTab} onValueChange={setActiveTab}>
        <TabsList>
          {visibleTabs.map(({ tab, value, errorCount }) => (
            <TabsTrigger key={value} value={value}>
              <span>{tab.label}</span>
              {errorCount > 0 && (
                <Badge
                  variant="destructive"
                  className="lt:h-4 lt:min-w-4 lt:px-1 lt:text-[0.625rem]"
                  data-testid={`tab-error-badge-${fullName}-${value}`}
                  aria-label={`${errorCount} validation ${errorCount === 1 ? 'error' : 'errors'}`}
                >
                  {errorCount}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleTabs.map(({ tab, value }) => (
          <TabsContent
            key={value}
            value={value}
            forceMount
            data-tab-panel={value}
            className="lt:mt-2 lt:rounded-lg lt:border lt:border-border lt:p-4 lt:flex lt:flex-col lt:gap-4 lt:data-[state=inactive]:hidden"
          >
            {tab.description && (
              <p className="lt:text-xs lt:text-muted-foreground lt:m-0">{tab.description}</p>
            )}
            {renderFields(tab.fields)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
