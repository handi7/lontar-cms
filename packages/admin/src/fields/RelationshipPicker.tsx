import { useState, useEffect, useMemo, useContext, type ReactNode } from 'react'
import type { FormRegister, FormSetValue, FormWatch } from './form-types'
import { useQuery } from '@tanstack/react-query'
import type { ClientRelationshipField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { useLocale } from '../hooks/useLocale'
import { fetchCollectionDocs, fetchDoc } from '../api/client'
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

function useRelationshipConfig(relationTo: string) {
  const adminCtx = useContext(AdminContext)
  const config = adminCtx ? adminCtx.config : undefined
  const targetCol = config ? config.collections.find((c) => c.slug === relationTo) : undefined

  return {
    apiBase: adminCtx ? adminCtx.apiBase : '/api',
    basePath: adminCtx ? adminCtx.basePath : '/admin',
    targetCol,
    titleField: targetCol ? targetCol.admin.useAsTitle : 'title',
    singularLabel: targetCol ? targetCol.labels.singular : relationTo,
    pluralLabel: targetCol ? targetCol.labels.plural : relationTo,
  }
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
  selectedId: number
  title: string
  basePath: string
  relationTo: string
  changeButton?: ReactNode
  onRemove?: () => void
  disabled?: boolean
}

function SingleSelectedView(props: SingleSelectedViewProps) {
  const { selectedId, title, basePath, relationTo, changeButton, onRemove, disabled } = props
  const editUrl = getDocEditUrl(basePath, relationTo, selectedId)
  return (
    <PickerCard data-testid="relationship-single-selected">
      <div className="lt:flex lt:min-w-0 lt:items-center lt:gap-2">
        <span className={pickerTitleClass}>{title}</span>
        <Badge variant="muted">#{selectedId}</Badge>
      </div>
      <div className={pickerActionsClass}>
        <PickerViewLink href={editUrl} testId="relationship-link" />
        {!disabled && changeButton}
        {!disabled && onRemove && (
          <PickerButton destructive onClick={onRemove} data-testid="relationship-clear">
            Remove
          </PickerButton>
        )}
      </div>
    </PickerCard>
  )
}

function SingleRelationshipPicker({
  field,
  register,
  setValue,
  watch,
  disabled,
}: RelationshipPickerProps) {
  const { apiBase, basePath, titleField, singularLabel, pluralLabel } = useRelationshipConfig(
    field.relationTo,
  )
  const { hasLocalization, activeLocale, fallbackLocale } = useLocale()
  const currentLocale = hasLocalization ? activeLocale : undefined

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedId = normalizeSingleId(rawValue)
  const [isSearching, setIsSearching] = useState(false)

  const docQuery = useQuery({
    queryKey: ['collection-doc', field.relationTo, selectedId, currentLocale],
    queryFn: () =>
      selectedId
        ? fetchDoc(apiBase, field.relationTo, selectedId, {
            locale: currentLocale,
            fallbackLocale,
          })
        : null,
    enabled: typeof selectedId === 'number' && selectedId > 0,
  })

  const title = getDocTitle(docQuery.data, titleField) || `#${selectedId}`

  const search = (
    <RelationshipSearchDropdown
      relationTo={field.relationTo}
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
        relationTo={field.relationTo}
        disabled={disabled}
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

  if (disabled) {
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
  id: number
  index: number
  total: number
  title: string
  basePath: string
  relationTo: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
  disabled?: boolean
}

function ManyItemRow(props: ManyItemRowProps) {
  const { id, index, total, title, basePath, relationTo, onMove, onRemove, disabled } = props
  const editUrl = getDocEditUrl(basePath, relationTo, id)
  return (
    <PickerCard className="lt:gap-2 lt:px-2.5 lt:py-1.5" data-testid={`relationship-item-${id}`}>
      <div className="lt:flex lt:min-w-0 lt:items-center lt:gap-2">
        <span className="lt:min-w-5 lt:text-xs lt:font-semibold lt:text-muted-foreground">
          {index + 1}.
        </span>
        <span className={pickerTitleClass}>{title}</span>
        <Badge variant="muted">#{id}</Badge>
      </div>
      <div className={pickerActionsClass}>
        <PickerViewLink href={editUrl} testId={`relationship-link-${id}`} />
        {!disabled && (
          <>
            <PickerIconButton
              label="Move Up"
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
              testId={`relationship-move-up-${id}`}
            >
              ↑
            </PickerIconButton>
            <PickerIconButton
              label="Move Down"
              disabled={index === total - 1}
              onClick={() => onMove(index, index + 1)}
              testId={`relationship-move-down-${id}`}
            >
              ↓
            </PickerIconButton>
            <PickerIconButton
              label="Remove"
              destructive
              onClick={() => onRemove(index)}
              testId={`relationship-remove-${id}`}
            >
              ✕
            </PickerIconButton>
          </>
        )}
      </div>
    </PickerCard>
  )
}

function useManySelectedDocs(
  apiBase: string,
  relationTo: string,
  selectedIds: number[],
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
    enabled: selectedIds.length > 0,
  })

  return useMemo(() => {
    return new Map(query.data?.map((d) => [Number(d.id), d]))
  }, [query.data])
}

function reorderItems(ids: number[], from: number, to: number): number[] {
  if (to < 0 || to >= ids.length) return ids
  const next = [...ids]
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
  const { apiBase, basePath, titleField, singularLabel, pluralLabel } = useRelationshipConfig(
    field.relationTo,
  )
  const { hasLocalization, activeLocale, fallbackLocale } = useLocale()
  const currentLocale = hasLocalization ? activeLocale : undefined

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedIds = useMemo(() => normalizeManyIds(rawValue), [rawValue])
  const [isSearching, setIsSearching] = useState(false)
  const docsMap = useManySelectedDocs(
    apiBase,
    field.relationTo,
    selectedIds,
    currentLocale,
    fallbackLocale,
  )

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
          relationTo={field.relationTo}
          onMove={handleMove}
          onRemove={handleRemove}
          disabled={disabled}
        />
      ) : (
        <div className="lt:text-muted-foreground" data-testid="relationship-empty-hint">
          No {pluralLabel} selected
        </div>
      )}

      {!disabled && (
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
            relationTo={field.relationTo}
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

export function RelationshipPicker(props: RelationshipPickerProps) {
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
