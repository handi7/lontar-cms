import { useState, useEffect, useMemo, useContext, type ReactNode } from 'react'
import type { FormRegister, FormSetValue, FormWatch } from './form-types'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import type { ClientConfig, ClientRelationshipField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { PermissionsContext, type PermissionsContextValue } from '../context/PermissionsContext'
import { useLocale } from '../hooks/useLocale'
import { ApiClientError, fetchCollectionDocs, fetchDoc } from '../api/client'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import {
  PickerButton,
  PickerCard,
  PickerEmptyTrigger,
  PickerOption,
  PickerPopover,
  PickerResults,
  PickerSearchBar,
  PickerStatus,
  PickerViewLink,
  pickerActionsClass,
  pickerTitleClass,
} from './picker-parts'

export interface RelationshipPickerProps {
  field: ClientRelationshipField
  register: FormRegister
  setValue?: FormSetValue
  watch?: FormWatch
  disabled?: boolean
}

function getNonEmptyString(val: unknown): string | null {
  if (typeof val === 'string' && val.trim().length > 0) return val
  return null
}

export function getDocTitle(
  doc: Record<string, unknown> | null | undefined,
  titleField: string,
): string {
  if (!doc) return ''
  const explicit = getNonEmptyString(doc[titleField])
  if (explicit) return explicit
  if (typeof doc[titleField] === 'number') return String(doc[titleField])
  const fallback = getNonEmptyString(doc.title) ?? getNonEmptyString(doc.name)
  if (fallback) return fallback
  if (typeof doc.id === 'string' || typeof doc.id === 'number') return `#${doc.id}`
  return 'Untitled'
}

export function getDocEditUrl(basePath: string, relationTo: string, id: number | string): string {
  const base = basePath && basePath !== '/' ? basePath.replace(/\/+$/, '') : ''
  return `${base}/${relationTo}/${id}`
}

function extractNumericId(item: unknown): number | null {
  if (typeof item === 'number' && item > 0) return item
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const id = (item as Record<string, unknown>).id
    if (typeof id === 'number' && id > 0) return id
  }
  return null
}

function normalizeSingleId(val: unknown): number | null {
  return extractNumericId(val)
}

function normalizeManyIds(val: unknown): number[] {
  if (!Array.isArray(val)) return []
  return (val as unknown[]).map(extractNumericId).filter((id): id is number => id !== null)
}

function isForbiddenError(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 403
}

interface TargetCollectionMeta {
  slug: string
  singularLabel: string
  pluralLabel: string
  titleField: string
  canRead: boolean
}

function resolveTargetMeta(
  config: ClientConfig | undefined,
  permCtx: PermissionsContextValue | null,
  slug: string,
): TargetCollectionMeta {
  const targetCol = config ? config.collections.find((c) => c.slug === slug) : undefined
  return {
    slug,
    singularLabel: targetCol ? targetCol.labels.singular : slug,
    pluralLabel: targetCol ? targetCol.labels.plural : slug,
    titleField: targetCol ? targetCol.admin.useAsTitle : 'title',
    canRead: permCtx ? permCtx.canReadCollection(slug) : true,
  }
}

function useRelationshipConfig(relationTo: string) {
  const adminCtx = useContext(AdminContext)
  const permCtx = useContext(PermissionsContext)
  const meta = resolveTargetMeta(adminCtx?.config, permCtx, relationTo)

  return {
    apiBase: adminCtx ? adminCtx.apiBase : '/api',
    basePath: adminCtx ? adminCtx.basePath : '/admin',
    targetCol: adminCtx?.config.collections.find((c) => c.slug === relationTo),
    titleField: meta.titleField,
    singularLabel: meta.singularLabel,
    pluralLabel: meta.pluralLabel,
    canRead: meta.canRead,
  }
}

function usePolymorphicTargets(targets: readonly string[]) {
  const adminCtx = useContext(AdminContext)
  const permCtx = useContext(PermissionsContext)
  const apiBase = adminCtx ? adminCtx.apiBase : '/api'
  const basePath = adminCtx ? adminCtx.basePath : '/admin'

  const targetMap = useMemo(() => {
    const map = new Map<string, TargetCollectionMeta>()
    for (const slug of targets) {
      map.set(slug, resolveTargetMeta(adminCtx?.config, permCtx, slug))
    }
    return map
  }, [adminCtx?.config, permCtx, targets])

  const readableTargets = useMemo(
    () => targets.filter((slug) => targetMap.get(slug)?.canRead !== false),
    [targets, targetMap],
  )

  return { apiBase, basePath, targetMap, readableTargets }
}

interface RelationshipSearchDropdownProps {
  relationTo: string
  titleField: string
  singularLabel: string
  pluralLabel: string
  apiBase: string
  locale?: string
  fallbackLocale?: string
  excludeIds?: number[]
  onSelect: (doc: Record<string, unknown>) => void
  onCancel?: () => void
}

interface DropdownOptionsListProps {
  docs: Array<Record<string, unknown>>
  titleField: string
  excludeIds?: number[]
  onSelect: (doc: Record<string, unknown>) => void
}

function DropdownOptionsList(props: DropdownOptionsListProps) {
  const { docs, titleField, excludeIds, onSelect } = props
  const filtered = excludeIds?.length
    ? docs.filter((d) => !excludeIds.includes(Number(d.id)))
    : docs

  if (filtered.length === 0) {
    return <PickerStatus>No matching documents found</PickerStatus>
  }

  return (
    <>
      {filtered.map((doc) => {
        const id = Number(doc.id)
        return (
          <PickerOption
            key={id}
            onClick={() => onSelect(doc)}
            data-testid={`relationship-option-${id}`}
          >
            <span className={pickerTitleClass}>{getDocTitle(doc, titleField)}</span>
            <span className="lt:text-muted-foreground">#{id}</span>
          </PickerOption>
        )
      })}
    </>
  )
}

function RelationshipSearchDropdown({
  relationTo,
  titleField,
  pluralLabel,
  apiBase,
  locale,
  fallbackLocale,
  excludeIds,
  onSelect,
  onCancel,
}: RelationshipSearchDropdownProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const query = useQuery({
    queryKey: ['relationship-options', relationTo, searchTerm, locale],
    queryFn: () => {
      const trimmed = searchTerm.trim()
      const where = trimmed ? { [titleField]: { contains: trimmed } } : undefined
      return fetchCollectionDocs(apiBase, relationTo, {
        limit: 20,
        where,
        locale,
        fallbackLocale,
      })
    },
  })

  return (
    <div className="lt:flex lt:w-full lt:flex-col lt:gap-1">
      <PickerSearchBar
        placeholder={`Search ${pluralLabel}...`}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        data-testid="relationship-search"
        onCancel={onCancel}
        cancelTestId="relationship-cancel-search"
      />
      <PickerResults data-testid="relationship-dropdown">
        {query.isLoading && <PickerStatus>Loading {pluralLabel}...</PickerStatus>}
        {query.isError && <PickerStatus error>Failed to load {pluralLabel}</PickerStatus>}
        {query.data && (
          <DropdownOptionsList
            docs={query.data.docs}
            titleField={titleField}
            excludeIds={excludeIds}
            onSelect={onSelect}
          />
        )}
      </PickerResults>
    </div>
  )
}

interface SingleSelectedViewProps {
  selectedId: number | null
  title: string
  basePath: string
  relationTo: string
  collectionBadge?: string
  changeButton?: ReactNode
  onRemove?: () => void
  disabled?: boolean
  locked?: boolean
  lockTestId?: string
}

function resolveItemTitle(id: number | null, title: string, locked?: boolean): string {
  if (locked) return 'Restricted'
  if (id === null) return 'Unavailable'
  return title
}

function LockedBadgeIcon({ testId }: { testId: string }) {
  return (
    <Lock
      className="lt:size-3.5 lt:shrink-0 lt:text-muted-foreground"
      data-testid={testId}
      aria-label="Locked"
    />
  )
}

function SingleSelectedActions({
  canLink,
  href,
  canEdit,
  changeButton,
  onRemove,
}: {
  canLink: boolean
  href: string
  canEdit: boolean
  changeButton?: ReactNode
  onRemove?: () => void
}) {
  return (
    <div className={pickerActionsClass}>
      {canLink && <PickerViewLink href={href} testId="relationship-link" />}
      {canEdit && changeButton}
      {canEdit && onRemove && (
        <PickerButton destructive onClick={onRemove} data-testid="relationship-clear">
          Remove
        </PickerButton>
      )}
    </div>
  )
}

function SingleSelectedView(props: SingleSelectedViewProps) {
  const {
    selectedId,
    title,
    basePath,
    relationTo,
    collectionBadge,
    changeButton,
    onRemove,
    disabled,
    locked,
    lockTestId,
  } = props
  const canLink = !locked && selectedId !== null && selectedId > 0
  const displayTitle = resolveItemTitle(selectedId, title, locked)
  const href = selectedId !== null ? getDocEditUrl(basePath, relationTo, selectedId) : ''
  return (
    <PickerCard data-testid="relationship-single-selected">
      <div className="lt:flex lt:min-w-0 lt:items-center lt:gap-2">
        {locked && <LockedBadgeIcon testId={lockTestId ?? 'relationship-locked'} />}
        {collectionBadge && (
          <Badge variant="secondary" data-testid="relationship-collection-badge">
            {collectionBadge}
          </Badge>
        )}
        <span className={pickerTitleClass}>{displayTitle}</span>
        {selectedId !== null && <Badge variant="muted">#{selectedId}</Badge>}
      </div>
      <SingleSelectedActions
        canLink={canLink}
        href={href}
        canEdit={!disabled && !locked}
        changeButton={changeButton}
        onRemove={onRemove}
      />
    </PickerCard>
  )
}

function formatIdFallback(id: number | null | undefined): string {
  return typeof id === 'number' ? `#${id}` : ''
}

function useMonomorphicSingleDoc(
  apiBase: string,
  relationTo: string,
  selectedId: number | null,
  canRead: boolean,
  currentLocale?: string,
  fallbackLocale?: string,
) {
  return useQuery({
    queryKey: ['collection-doc', relationTo, selectedId, currentLocale],
    queryFn: () =>
      selectedId
        ? fetchDoc(apiBase, relationTo, selectedId, {
            locale: currentLocale,
            fallbackLocale,
          })
        : null,
    enabled: canRead && typeof selectedId === 'number' && selectedId > 0,
  })
}

function SingleRelationshipPicker({
  field,
  register,
  setValue,
  watch,
  disabled,
}: RelationshipPickerProps) {
  const relationTo = typeof field.relationTo === 'string' ? field.relationTo : ''
  const { apiBase, basePath, titleField, singularLabel, pluralLabel, canRead } =
    useRelationshipConfig(relationTo)
  const { hasLocalization, activeLocale, fallbackLocale } = useLocale()
  const currentLocale = hasLocalization ? activeLocale : undefined

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const selectedId = normalizeSingleId(watch?.(field.name))
  const [isSearching, setIsSearching] = useState(false)
  const docQuery = useMonomorphicSingleDoc(
    apiBase,
    relationTo,
    selectedId,
    canRead,
    currentLocale,
    fallbackLocale,
  )

  const locked = !canRead || isForbiddenError(docQuery.error)
  const title = getDocTitle(docQuery.data, titleField) || formatIdFallback(selectedId)

  const search = (
    <RelationshipSearchDropdown
      relationTo={relationTo}
      titleField={titleField}
      singularLabel={singularLabel}
      pluralLabel={pluralLabel}
      apiBase={apiBase}
      locale={currentLocale}
      fallbackLocale={fallbackLocale}
      onSelect={(doc) => {
        setValue?.(field.name, Number(doc.id), { shouldValidate: true, shouldDirty: true })
        setIsSearching(false)
      }}
      onCancel={() => setIsSearching(false)}
    />
  )

  if (selectedId) {
    return (
      <SingleSelectedView
        selectedId={selectedId}
        title={title}
        basePath={basePath}
        relationTo={relationTo}
        disabled={disabled}
        locked={locked}
        changeButton={
          <PickerPopover
            open={isSearching}
            onOpenChange={setIsSearching}
            trigger={<PickerButton data-testid="relationship-change">Change</PickerButton>}
          >
            {search}
          </PickerPopover>
        }
        onRemove={() => setValue?.(field.name, null, { shouldValidate: true, shouldDirty: true })}
      />
    )
  }

  if (disabled || !canRead) {
    return <span className="lt:text-xs lt:text-muted-foreground">—</span>
  }

  return (
    <PickerPopover
      open={isSearching}
      onOpenChange={setIsSearching}
      trigger={
        <PickerEmptyTrigger data-testid="relationship-open-search">
          Select {singularLabel}…
        </PickerEmptyTrigger>
      }
    >
      {search}
    </PickerPopover>
  )
}

// `aria-label` is the accessible name, since the glyph alone (↑, ↓, ✕) would
// be announced literally; the Tooltip shows the same text on hover and focus.
interface PickerIconButtonProps {
  label: string
  testId: string
  children: string
  disabled?: boolean
  destructive?: boolean
  onClick: () => void
}

// A disabled button gets no pointer events, so the first item's ↑ and the
// last item's ↓ show no tooltip, as they never did with `title` either.
function PickerIconButton(props: PickerIconButtonProps) {
  const { label, testId, children, ...rest } = props
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PickerButton
          aria-label={label}
          className="lt:size-6.5 lt:p-0 lt:disabled:opacity-40"
          data-testid={testId}
          {...rest}
        >
          {children}
        </PickerButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface ManyItemRowProps {
  id: number | null
  index: number
  total: number
  title: string
  basePath: string
  relationTo: string
  collectionBadge?: string
  testIdSuffix?: string
  locked?: boolean
  lockTestId?: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
  disabled?: boolean
}

function ManyRowActions({
  canLink,
  href,
  canEdit,
  index,
  total,
  suffix,
  onMove,
  onRemove,
}: {
  canLink: boolean
  href: string
  canEdit: boolean
  index: number
  total: number
  suffix: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className={pickerActionsClass}>
      {canLink && <PickerViewLink href={href} testId={`relationship-link-${suffix}`} />}
      {canEdit && (
        <>
          <PickerIconButton
            label="Move Up"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            testId={`relationship-move-up-${suffix}`}
          >
            ↑
          </PickerIconButton>
          <PickerIconButton
            label="Move Down"
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
            testId={`relationship-move-down-${suffix}`}
          >
            ↓
          </PickerIconButton>
          <PickerIconButton
            label="Remove"
            destructive
            onClick={() => onRemove(index)}
            testId={`relationship-remove-${suffix}`}
          >
            ✕
          </PickerIconButton>
        </>
      )}
    </div>
  )
}

function ManyRowContent({
  index,
  locked,
  lockTestId,
  collectionBadge,
  suffix,
  displayTitle,
  id,
}: {
  index: number
  locked?: boolean
  lockTestId?: string
  collectionBadge?: string
  suffix: string
  displayTitle: string
  id: number | null
}) {
  return (
    <div className="lt:flex lt:min-w-0 lt:items-center lt:gap-2">
      <span className="lt:min-w-5 lt:text-xs lt:font-semibold lt:text-muted-foreground">
        {index + 1}.
      </span>
      {locked && <LockedBadgeIcon testId={lockTestId ?? `relationship-locked-${suffix}`} />}
      {collectionBadge && (
        <Badge variant="secondary" data-testid={`relationship-item-collection-${suffix}`}>
          {collectionBadge}
        </Badge>
      )}
      <span className={pickerTitleClass}>{displayTitle}</span>
      {id !== null && <Badge variant="muted">#{id}</Badge>}
    </div>
  )
}

function ManyItemRow(props: ManyItemRowProps) {
  const { id, index, total, title, basePath, relationTo, locked, onMove, onRemove, disabled } =
    props
  const suffix = props.testIdSuffix ?? String(id ?? index)
  const canLink = !locked && id !== null && id > 0
  const displayTitle = resolveItemTitle(id, title, locked)
  const href = id !== null ? getDocEditUrl(basePath, relationTo, id) : ''
  return (
    <PickerCard
      className="lt:gap-2 lt:px-2.5 lt:py-1.5"
      data-testid={`relationship-item-${suffix}`}
    >
      <ManyRowContent
        index={index}
        locked={locked}
        lockTestId={props.lockTestId}
        collectionBadge={props.collectionBadge}
        suffix={suffix}
        displayTitle={displayTitle}
        id={id}
      />
      <ManyRowActions
        canLink={canLink}
        href={href}
        canEdit={!disabled && !locked}
        index={index}
        total={total}
        suffix={suffix}
        onMove={onMove}
        onRemove={onRemove}
      />
    </PickerCard>
  )
}

function useManySelectedDocs(
  apiBase: string,
  relationTo: string,
  selectedIds: number[],
  canRead: boolean,
  locale?: string,
  fallbackLocale?: string,
) {
  const query = useQuery({
    queryKey: ['relationship-selected-docs', relationTo, selectedIds, locale],
    queryFn: async () => {
      if (selectedIds.length === 0) return []
      const res = await fetchCollectionDocs(apiBase, relationTo, {
        limit: selectedIds.length,
        where: { id: { in: selectedIds } },
        locale,
        fallbackLocale,
      })
      return res.docs
    },
    enabled: canRead && selectedIds.length > 0,
  })

  const docsMap = useMemo(() => {
    return new Map(query.data?.map((d) => [Number(d.id), d]))
  }, [query.data])

  return { docsMap, forbidden: isForbiddenError(query.error) }
}

function reorderItems<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) {
    next.splice(to, 0, moved)
  }
  return next
}

interface ManySelectedListProps {
  ids: number[]
  docsMap: Map<number, Record<string, unknown>>
  titleField: string
  basePath: string
  relationTo: string
  locked?: boolean
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
  disabled?: boolean
}

function ManySelectedList({
  ids,
  docsMap,
  titleField,
  basePath,
  relationTo,
  locked,
  onMove,
  onRemove,
  disabled,
}: ManySelectedListProps) {
  return (
    <div className="lt:flex lt:flex-col lt:gap-1.5" data-testid="relationship-many-list">
      {ids.map((id, index) => {
        const doc = docsMap.get(id)
        const title = getDocTitle(doc, titleField) || `#${id}`
        return (
          <ManyItemRow
            key={`${id}-${index}`}
            id={id}
            index={index}
            total={ids.length}
            title={title}
            basePath={basePath}
            relationTo={relationTo}
            locked={locked}
            onMove={onMove}
            onRemove={onRemove}
            disabled={disabled}
          />
        )
      })}
    </div>
  )
}

function ManyRelationshipPicker({
  field,
  register,
  setValue,
  watch,
  disabled,
}: RelationshipPickerProps) {
  const relationTo = typeof field.relationTo === 'string' ? field.relationTo : ''
  const { apiBase, basePath, titleField, singularLabel, pluralLabel, canRead } =
    useRelationshipConfig(relationTo)
  const { hasLocalization, activeLocale, fallbackLocale } = useLocale()
  const currentLocale = hasLocalization ? activeLocale : undefined

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedIds = useMemo(() => normalizeManyIds(rawValue), [rawValue])
  const [isSearching, setIsSearching] = useState(false)
  const { docsMap, forbidden } = useManySelectedDocs(
    apiBase,
    relationTo,
    selectedIds,
    canRead,
    currentLocale,
    fallbackLocale,
  )
  const locked = !canRead || forbidden

  const handleMove = (from: number, to: number) => {
    setValue?.(field.name, reorderItems(selectedIds, from, to), {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  const handleRemove = (index: number) => {
    setValue?.(
      field.name,
      selectedIds.filter((_, i) => i !== index),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  const handleAdd = (doc: Record<string, unknown>) => {
    const id = Number(doc.id)
    if (!selectedIds.includes(id)) {
      setValue?.(field.name, [...selectedIds, id], { shouldValidate: true, shouldDirty: true })
    }
    setIsSearching(false)
  }

  return (
    <div className="lt:flex lt:flex-col lt:gap-2">
      {selectedIds.length > 0 ? (
        <ManySelectedList
          ids={selectedIds}
          docsMap={docsMap}
          titleField={titleField}
          basePath={basePath}
          relationTo={relationTo}
          locked={locked}
          onMove={handleMove}
          onRemove={handleRemove}
          disabled={disabled}
        />
      ) : (
        <div className="lt:text-muted-foreground" data-testid="relationship-empty-hint">
          No {pluralLabel} selected
        </div>
      )}

      {!disabled && canRead && (
        <PickerPopover
          open={isSearching}
          onOpenChange={setIsSearching}
          trigger={
            <PickerButton className="lt:w-fit" data-testid="relationship-add-btn">
              + Add {singularLabel}
            </PickerButton>
          }
        >
          <RelationshipSearchDropdown
            relationTo={relationTo}
            titleField={titleField}
            singularLabel={singularLabel}
            pluralLabel={pluralLabel}
            apiBase={apiBase}
            locale={currentLocale}
            fallbackLocale={fallbackLocale}
            excludeIds={selectedIds}
            onSelect={handleAdd}
            onCancel={() => setIsSearching(false)}
          />
        </PickerPopover>
      )}
    </div>
  )
}

interface ParsedPolymorphicEntry {
  relationTo: string
  id: number | null
  populatedDoc?: Record<string, unknown>
}

function parsePolymorphicEntry(raw: unknown): ParsedPolymorphicEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.relationTo !== 'string' || !rec.relationTo) return null
  if (rec.value === null || rec.value === undefined) {
    return { relationTo: rec.relationTo, id: null }
  }
  const id = extractNumericId(rec.value)
  if (id === null) return null
  const populatedDoc =
    typeof rec.value === 'object' && rec.value !== null
      ? (rec.value as Record<string, unknown>)
      : undefined
  return { relationTo: rec.relationTo, id, populatedDoc }
}

function parsePolymorphicMany(raw: unknown): ParsedPolymorphicEntry[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[])
    .map(parsePolymorphicEntry)
    .filter((item): item is ParsedPolymorphicEntry => item !== null)
}

function toStoredPolymorphicItem(entry: ParsedPolymorphicEntry) {
  return { relationTo: entry.relationTo, value: entry.id }
}

interface PolymorphicSearchPanelProps {
  readableTargets: string[]
  targetMap: Map<string, TargetCollectionMeta>
  apiBase: string
  locale?: string
  fallbackLocale?: string
  initialTarget?: string
  excludeByCollection?: Map<string, number[]>
  onSelect: (relationTo: string, doc: Record<string, unknown>) => void
  onCancel: () => void
}

function PolymorphicSearchPanel({
  readableTargets,
  targetMap,
  apiBase,
  locale,
  fallbackLocale,
  initialTarget,
  excludeByCollection,
  onSelect,
  onCancel,
}: PolymorphicSearchPanelProps) {
  const defaultTarget =
    initialTarget && readableTargets.includes(initialTarget)
      ? initialTarget
      : (readableTargets[0] ?? '')
  const [selectedTarget, setSelectedTarget] = useState(defaultTarget)

  if (readableTargets.length === 0) {
    return <PickerStatus>No readable collections available</PickerStatus>
  }

  const activeMeta = targetMap.get(selectedTarget)
  const excludeIds = excludeByCollection?.get(selectedTarget)

  return (
    <div className="lt:flex lt:w-full lt:flex-col lt:gap-2">
      <div
        className="lt:flex lt:flex-wrap lt:items-center lt:gap-1"
        role="group"
        aria-label="Target collection"
        data-testid="relationship-collection-selector"
      >
        {readableTargets.map((slug) => {
          const meta = targetMap.get(slug)
          const active = slug === selectedTarget
          return (
            <Button
              key={slug}
              type="button"
              size="sm"
              variant={active ? 'default' : 'outline'}
              className="lt:h-7 lt:px-2 lt:text-xs lt:shadow-none"
              aria-pressed={active}
              onClick={() => setSelectedTarget(slug)}
              data-testid={`relationship-collection-${slug}`}
            >
              {meta?.pluralLabel ?? slug}
            </Button>
          )
        })}
      </div>

      {activeMeta && (
        <RelationshipSearchDropdown
          relationTo={selectedTarget}
          titleField={activeMeta.titleField}
          singularLabel={activeMeta.singularLabel}
          pluralLabel={activeMeta.pluralLabel}
          apiBase={apiBase}
          locale={locale}
          fallbackLocale={fallbackLocale}
          excludeIds={excludeIds}
          onSelect={(doc) => onSelect(selectedTarget, doc)}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}

function usePolymorphicSingleDoc(
  apiBase: string,
  selected: ParsedPolymorphicEntry | null,
  canReadSelected: boolean,
  currentLocale?: string,
  fallbackLocale?: string,
) {
  const relationTo = selected?.relationTo
  const id = selected?.id
  const shouldFetch =
    Boolean(relationTo) &&
    canReadSelected &&
    typeof id === 'number' &&
    id > 0 &&
    !selected?.populatedDoc
  return useQuery({
    queryKey: ['collection-doc', relationTo, id, currentLocale],
    queryFn: () =>
      relationTo && id
        ? fetchDoc(apiBase, relationTo, id, {
            locale: currentLocale,
            fallbackLocale,
          })
        : null,
    enabled: shouldFetch,
  })
}

function resolvePolymorphicTriggerLabel(
  readableTargets: string[],
  targetMap: Map<string, TargetCollectionMeta>,
): string {
  const targetNames = readableTargets.map((slug) => targetMap.get(slug)?.singularLabel ?? slug)
  return targetNames.length <= 2 ? `Select ${targetNames.join(' or ')}…` : 'Select document…'
}

function resolveRelationTargets(relationTo: string | string[]): string[] {
  return Array.isArray(relationTo) ? relationTo : [relationTo]
}

function PolymorphicSingleSelectedCard({
  selected,
  selectedMeta,
  docQuery,
  basePath,
  disabled,
  isSearching,
  setIsSearching,
  search,
  onRemove,
}: {
  selected: ParsedPolymorphicEntry
  selectedMeta: TargetCollectionMeta | undefined
  docQuery: ReturnType<typeof usePolymorphicSingleDoc>
  basePath: string
  disabled?: boolean
  isSearching: boolean
  setIsSearching: (open: boolean) => void
  search: ReactNode
  onRemove: () => void
}) {
  const canReadSelected = selectedMeta?.canRead ?? false
  const locked = !canReadSelected || isForbiddenError(docQuery.error)
  const doc = selected.populatedDoc ?? docQuery.data
  const title =
    getDocTitle(doc, selectedMeta?.titleField ?? 'title') || formatIdFallback(selected.id)
  return (
    <SingleSelectedView
      selectedId={selected.id}
      title={title}
      basePath={basePath}
      relationTo={selected.relationTo}
      collectionBadge={selectedMeta?.singularLabel ?? selected.relationTo}
      disabled={disabled}
      locked={locked}
      changeButton={
        <PickerPopover
          open={isSearching}
          onOpenChange={setIsSearching}
          trigger={<PickerButton data-testid="relationship-change">Change</PickerButton>}
        >
          {search}
        </PickerPopover>
      }
      onRemove={onRemove}
    />
  )
}

function PolymorphicSinglePicker({
  field,
  register,
  setValue,
  watch,
  disabled,
}: RelationshipPickerProps) {
  const targets = useMemo(() => resolveRelationTargets(field.relationTo), [field.relationTo])
  const { apiBase, basePath, targetMap, readableTargets } = usePolymorphicTargets(targets)
  const { hasLocalization, activeLocale, fallbackLocale } = useLocale()
  const currentLocale = hasLocalization ? activeLocale : undefined

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const selected = parsePolymorphicEntry(watch?.(field.name))
  const [isSearching, setIsSearching] = useState(false)
  const selectedMeta = selected ? targetMap.get(selected.relationTo) : undefined
  const canReadSelected = selectedMeta?.canRead ?? false
  const docQuery = usePolymorphicSingleDoc(
    apiBase,
    selected,
    canReadSelected,
    currentLocale,
    fallbackLocale,
  )

  const search = (
    <PolymorphicSearchPanel
      readableTargets={readableTargets}
      targetMap={targetMap}
      apiBase={apiBase}
      locale={currentLocale}
      fallbackLocale={fallbackLocale}
      initialTarget={selected?.relationTo}
      onSelect={(relationTo, doc) => {
        setValue?.(
          field.name,
          { relationTo, value: Number(doc.id) },
          { shouldValidate: true, shouldDirty: true },
        )
        setIsSearching(false)
      }}
      onCancel={() => setIsSearching(false)}
    />
  )

  if (selected) {
    return (
      <PolymorphicSingleSelectedCard
        selected={selected}
        selectedMeta={selectedMeta}
        docQuery={docQuery}
        basePath={basePath}
        disabled={disabled}
        isSearching={isSearching}
        setIsSearching={setIsSearching}
        search={search}
        onRemove={() => setValue?.(field.name, null, { shouldValidate: true, shouldDirty: true })}
      />
    )
  }

  if (disabled || readableTargets.length === 0) {
    return <span className="lt:text-xs lt:text-muted-foreground">—</span>
  }

  return (
    <PickerPopover
      open={isSearching}
      onOpenChange={setIsSearching}
      trigger={
        <PickerEmptyTrigger data-testid="relationship-open-search">
          {resolvePolymorphicTriggerLabel(readableTargets, targetMap)}
        </PickerEmptyTrigger>
      }
    >
      {search}
    </PickerPopover>
  )
}

function groupIdsToFetchByCollection(
  entries: readonly ParsedPolymorphicEntry[],
  targetMap: Map<string, TargetCollectionMeta>,
): Array<[string, number[]]> {
  const byCollection = new Map<string, Set<number>>()
  for (const entry of entries) {
    if (entry.id === null || entry.populatedDoc) continue
    const meta = targetMap.get(entry.relationTo)
    if (meta && !meta.canRead) continue
    const set = byCollection.get(entry.relationTo) ?? new Set<number>()
    set.add(entry.id)
    byCollection.set(entry.relationTo, set)
  }
  return Array.from(byCollection.entries()).map(([slug, set]) => [slug, Array.from(set)])
}

function usePolymorphicManyDocs(
  apiBase: string,
  entries: readonly ParsedPolymorphicEntry[],
  targetMap: Map<string, TargetCollectionMeta>,
  locale?: string,
  fallbackLocale?: string,
) {
  const grouped = useMemo(
    () => groupIdsToFetchByCollection(entries, targetMap),
    [entries, targetMap],
  )

  const queries = useQueries({
    queries: grouped.map(([slug, ids]) => ({
      queryKey: ['relationship-selected-docs', slug, ids, locale],
      queryFn: async () => {
        const res = await fetchCollectionDocs(apiBase, slug, {
          limit: ids.length,
          where: { id: { in: ids } },
          locale,
          fallbackLocale,
        })
        return { slug, docs: res.docs }
      },
      enabled: ids.length > 0,
    })),
  })

  return useMemo(() => {
    const docsByKey = new Map<string, Record<string, unknown>>()
    const forbiddenCollections = new Set<string>()
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]
      const slug = grouped[i]?.[0]
      if (!slug || !q) continue
      if (isForbiddenError(q.error)) {
        forbiddenCollections.add(slug)
        continue
      }
      for (const doc of q.data?.docs ?? []) {
        docsByKey.set(`${slug}:${String(doc.id)}`, doc)
      }
    }
    return { docsByKey, forbiddenCollections }
  }, [queries, grouped])
}

function PolymorphicManyItem({
  entry,
  index,
  total,
  meta,
  forbiddenCollections,
  docsByKey,
  basePath,
  onMove,
  onRemove,
  disabled,
}: {
  entry: ParsedPolymorphicEntry
  index: number
  total: number
  meta: TargetCollectionMeta | undefined
  forbiddenCollections: Set<string>
  docsByKey: Map<string, Record<string, unknown>>
  basePath: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
  disabled?: boolean
}) {
  const locked = (meta ? !meta.canRead : false) || forbiddenCollections.has(entry.relationTo)
  const doc = entry.populatedDoc ?? docsByKey.get(`${entry.relationTo}:${String(entry.id)}`)
  const title = getDocTitle(doc, meta?.titleField ?? 'title') || formatIdFallback(entry.id)
  const suffix = `${entry.relationTo}-${entry.id ?? index}`
  return (
    <ManyItemRow
      id={entry.id}
      index={index}
      total={total}
      title={title}
      basePath={basePath}
      relationTo={entry.relationTo}
      collectionBadge={meta?.singularLabel ?? entry.relationTo}
      testIdSuffix={suffix}
      locked={locked}
      lockTestId={`relationship-locked-${suffix}`}
      onMove={onMove}
      onRemove={onRemove}
      disabled={disabled}
    />
  )
}

function PolymorphicManyList({
  entries,
  targetMap,
  forbiddenCollections,
  docsByKey,
  basePath,
  onMove,
  onRemove,
  disabled,
}: {
  entries: readonly ParsedPolymorphicEntry[]
  targetMap: Map<string, TargetCollectionMeta>
  forbiddenCollections: Set<string>
  docsByKey: Map<string, Record<string, unknown>>
  basePath: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
  disabled?: boolean
}) {
  return (
    <div className="lt:flex lt:flex-col lt:gap-1.5" data-testid="relationship-many-list">
      {entries.map((entry, index) => (
        <PolymorphicManyItem
          key={`${entry.relationTo}-${entry.id ?? index}-${index}`}
          entry={entry}
          index={index}
          total={entries.length}
          meta={targetMap.get(entry.relationTo)}
          forbiddenCollections={forbiddenCollections}
          docsByKey={docsByKey}
          basePath={basePath}
          onMove={onMove}
          onRemove={onRemove}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function PolymorphicManyPicker({
  field,
  register,
  setValue,
  watch,
  disabled,
}: RelationshipPickerProps) {
  const targets = useMemo(
    () => (Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo]),
    [field.relationTo],
  )
  const { apiBase, basePath, targetMap, readableTargets } = usePolymorphicTargets(targets)
  const { hasLocalization, activeLocale, fallbackLocale } = useLocale()
  const currentLocale = hasLocalization ? activeLocale : undefined

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const entries = useMemo(() => parsePolymorphicMany(rawValue), [rawValue])
  const [isSearching, setIsSearching] = useState(false)

  const { docsByKey, forbiddenCollections } = usePolymorphicManyDocs(
    apiBase,
    entries,
    targetMap,
    currentLocale,
    fallbackLocale,
  )

  const excludeByCollection = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const entry of entries) {
      if (entry.id === null) continue
      const arr = map.get(entry.relationTo) ?? []
      arr.push(entry.id)
      map.set(entry.relationTo, arr)
    }
    return map
  }, [entries])

  const commitEntries = (next: ParsedPolymorphicEntry[]) => {
    setValue?.(field.name, next.map(toStoredPolymorphicItem), {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  const handleAdd = (relationTo: string, doc: Record<string, unknown>) => {
    const id = Number(doc.id)
    const exists = entries.some((e) => e.relationTo === relationTo && e.id === id)
    if (!exists) {
      commitEntries([...entries, { relationTo, id }])
    }
    setIsSearching(false)
  }

  return (
    <div className="lt:flex lt:flex-col lt:gap-2">
      {entries.length > 0 ? (
        <PolymorphicManyList
          entries={entries}
          targetMap={targetMap}
          forbiddenCollections={forbiddenCollections}
          docsByKey={docsByKey}
          basePath={basePath}
          onMove={(from, to) => commitEntries(reorderItems(entries, from, to))}
          onRemove={(idx) => commitEntries(entries.filter((_, i) => i !== idx))}
          disabled={disabled}
        />
      ) : (
        <div className="lt:text-muted-foreground" data-testid="relationship-empty-hint">
          No items selected
        </div>
      )}

      {!disabled && readableTargets.length > 0 && (
        <PickerPopover
          open={isSearching}
          onOpenChange={setIsSearching}
          trigger={
            <PickerButton className="lt:w-fit" data-testid="relationship-add-btn">
              + Add Item
            </PickerButton>
          }
        >
          <PolymorphicSearchPanel
            readableTargets={readableTargets}
            targetMap={targetMap}
            apiBase={apiBase}
            locale={currentLocale}
            fallbackLocale={fallbackLocale}
            excludeByCollection={excludeByCollection}
            onSelect={handleAdd}
            onCancel={() => setIsSearching(false)}
          />
        </PickerPopover>
      )}
    </div>
  )
}

export function RelationshipPicker(props: RelationshipPickerProps) {
  const isPolymorphic = Array.isArray(props.field.relationTo)
  if (isPolymorphic) {
    return (
      <div className="lt:flex lt:w-full lt:flex-col lt:gap-2">
        {props.field.hasMany ? (
          <PolymorphicManyPicker {...props} />
        ) : (
          <PolymorphicSinglePicker {...props} />
        )}
      </div>
    )
  }
  return (
    <div className="lt:flex lt:w-full lt:flex-col lt:gap-2">
      {props.field.hasMany ? (
        <ManyRelationshipPicker {...props} />
      ) : (
        <SingleRelationshipPicker {...props} />
      )}
    </div>
  )
}
