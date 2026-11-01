import { useState, useEffect, useMemo, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { ClientRelationshipField } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { fetchCollectionDocs, fetchDoc } from '../api/client'

export interface RelationshipPickerProps {
  field: ClientRelationshipField
  register: UseFormRegister<Record<string, unknown>>
  setValue?: UseFormSetValue<Record<string, unknown>>
  watch?: UseFormWatch<Record<string, unknown>>
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
  excludeIds?: number[]
  onSelect: (doc: Record<string, unknown>) => void
  onCancel?: () => void
  autoFocus?: boolean
}

function DropdownOptionsList({
  docs,
  titleField,
  excludeIds,
  onSelect,
}: {
  docs: Array<Record<string, unknown>>
  titleField: string
  excludeIds?: number[]
  onSelect: (doc: Record<string, unknown>) => void
}) {
  const filtered = excludeIds?.length
    ? docs.filter((d) => !excludeIds.includes(Number(d.id)))
    : docs

  if (filtered.length === 0) {
    return <div className="lontar-relationship-empty">No matching documents found</div>
  }

  return (
    <>
      {filtered.map((doc) => {
        const id = Number(doc.id)
        return (
          <button
            key={id}
            type="button"
            className="lontar-relationship-option"
            onClick={() => onSelect(doc)}
            data-testid={`relationship-option-${id}`}
          >
            <span className="lontar-relationship-option-title">{getDocTitle(doc, titleField)}</span>
            <span className="lontar-text-muted">#{id}</span>
          </button>
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
  excludeIds,
  onSelect,
  onCancel,
  autoFocus,
}: RelationshipSearchDropdownProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const query = useQuery({
    queryKey: ['relationship-options', relationTo, searchTerm],
    queryFn: () => {
      const trimmed = searchTerm.trim()
      const where = trimmed ? { [titleField]: { contains: trimmed } } : undefined
      return fetchCollectionDocs(apiBase, relationTo, { limit: 20, where })
    },
  })

  return (
    <div className="lontar-relationship-search-container">
      <div className="lontar-relationship-search-bar">
        <input
          type="text"
          className="lontar-input"
          placeholder={`Search ${pluralLabel}...`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoFocus={autoFocus}
          data-testid="relationship-search"
        />
        {onCancel && (
          <button
            type="button"
            className="lontar-btn lontar-btn-secondary lontar-btn-sm"
            onClick={onCancel}
            data-testid="relationship-cancel-search"
          >
            Cancel
          </button>
        )}
      </div>
      <div className="lontar-relationship-dropdown" data-testid="relationship-dropdown">
        {query.isLoading && (
          <div className="lontar-relationship-empty">Loading {pluralLabel}...</div>
        )}
        {query.isError && (
          <div className="lontar-relationship-empty lontar-error-text">
            Failed to load {pluralLabel}
          </div>
        )}
        {query.data && (
          <DropdownOptionsList
            docs={query.data.docs}
            titleField={titleField}
            excludeIds={excludeIds}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  )
}

function SingleSelectedView({
  selectedId,
  title,
  basePath,
  relationTo,
  onStartChange,
  onRemove,
}: {
  selectedId: number
  title: string
  basePath: string
  relationTo: string
  onStartChange: () => void
  onRemove: () => void
}) {
  const editUrl = getDocEditUrl(basePath, relationTo, selectedId)
  return (
    <div className="lontar-relationship-selected" data-testid="relationship-single-selected">
      <div className="lontar-relationship-selected-info">
        <span className="lontar-relationship-selected-title">{title}</span>
        <span className="lontar-badge">#{selectedId}</span>
      </div>
      <div className="lontar-relationship-actions">
        <a
          href={editUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="lontar-btn lontar-btn-secondary lontar-btn-sm"
          data-testid="relationship-link"
        >
          View ↗
        </a>
        <button
          type="button"
          className="lontar-btn lontar-btn-secondary lontar-btn-sm"
          onClick={onStartChange}
          data-testid="relationship-change"
        >
          Change
        </button>
        <button
          type="button"
          className="lontar-btn lontar-btn-danger lontar-btn-sm"
          onClick={onRemove}
          data-testid="relationship-clear"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function SingleRelationshipPicker({ field, register, setValue, watch }: RelationshipPickerProps) {
  const { apiBase, basePath, titleField, singularLabel, pluralLabel } = useRelationshipConfig(
    field.relationTo,
  )

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedId = normalizeSingleId(rawValue)
  const [isSearching, setIsSearching] = useState(false)

  const docQuery = useQuery({
    queryKey: ['collection-doc', field.relationTo, selectedId],
    queryFn: () => (selectedId ? fetchDoc(apiBase, field.relationTo, selectedId) : null),
    enabled: typeof selectedId === 'number' && selectedId > 0,
  })

  const title = getDocTitle(docQuery.data, titleField) || `#${selectedId}`

  if (selectedId && !isSearching) {
    return (
      <SingleSelectedView
        selectedId={selectedId}
        title={title}
        basePath={basePath}
        relationTo={field.relationTo}
        onStartChange={() => setIsSearching(true)}
        onRemove={() => setValue?.(field.name, null, { shouldValidate: true, shouldDirty: true })}
      />
    )
  }

  return (
    <RelationshipSearchDropdown
      relationTo={field.relationTo}
      titleField={titleField}
      singularLabel={singularLabel}
      pluralLabel={pluralLabel}
      apiBase={apiBase}
      autoFocus={isSearching}
      onSelect={(doc) => {
        setValue?.(field.name, Number(doc.id), { shouldValidate: true, shouldDirty: true })
        setIsSearching(false)
      }}
      onCancel={selectedId ? () => setIsSearching(false) : undefined}
    />
  )
}

function ManyItemRow({
  id,
  index,
  total,
  title,
  basePath,
  relationTo,
  onMove,
  onRemove,
}: {
  id: number
  index: number
  total: number
  title: string
  basePath: string
  relationTo: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
}) {
  const editUrl = getDocEditUrl(basePath, relationTo, id)
  return (
    <div className="lontar-relationship-item" data-testid={`relationship-item-${id}`}>
      <div className="lontar-relationship-item-info">
        <span className="lontar-relationship-item-index">{index + 1}.</span>
        <span className="lontar-relationship-item-title">{title}</span>
        <span className="lontar-badge">#{id}</span>
      </div>
      <div className="lontar-relationship-actions">
        <a
          href={editUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="lontar-btn lontar-btn-secondary lontar-btn-sm"
          data-testid={`relationship-link-${id}`}
        >
          View ↗
        </a>
        <button
          type="button"
          className="lontar-btn-icon"
          title="Move Up"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          data-testid={`relationship-move-up-${id}`}
        >
          ↑
        </button>
        <button
          type="button"
          className="lontar-btn-icon"
          title="Move Down"
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
          data-testid={`relationship-move-down-${id}`}
        >
          ↓
        </button>
        <button
          type="button"
          className="lontar-btn-icon lontar-btn-danger"
          title="Remove"
          onClick={() => onRemove(index)}
          data-testid={`relationship-remove-${id}`}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function useManySelectedDocs(apiBase: string, relationTo: string, selectedIds: number[]) {
  const query = useQuery({
    queryKey: ['relationship-selected-docs', relationTo, selectedIds],
    queryFn: async () => {
      if (selectedIds.length === 0) return []
      const res = await fetchCollectionDocs(apiBase, relationTo, {
        limit: selectedIds.length,
        where: { id: { in: selectedIds } },
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

function ManySelectedList({
  ids,
  docsMap,
  titleField,
  basePath,
  relationTo,
  onMove,
  onRemove,
}: {
  ids: number[]
  docsMap: Map<number, Record<string, unknown>>
  titleField: string
  basePath: string
  relationTo: string
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className="lontar-relationship-list" data-testid="relationship-many-list">
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
          />
        )
      })}
    </div>
  )
}

function ManyRelationshipPicker({ field, register, setValue, watch }: RelationshipPickerProps) {
  const { apiBase, basePath, titleField, singularLabel, pluralLabel } = useRelationshipConfig(
    field.relationTo,
  )

  useEffect(() => {
    register(field.name)
  }, [register, field.name])

  const rawValue = watch ? watch(field.name) : undefined
  const selectedIds = useMemo(() => normalizeManyIds(rawValue), [rawValue])
  const [isSearching, setIsSearching] = useState(false)
  const docsMap = useManySelectedDocs(apiBase, field.relationTo, selectedIds)

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
    <div className="lontar-relationship-many-container">
      {selectedIds.length > 0 ? (
        <ManySelectedList
          ids={selectedIds}
          docsMap={docsMap}
          titleField={titleField}
          basePath={basePath}
          relationTo={field.relationTo}
          onMove={handleMove}
          onRemove={handleRemove}
        />
      ) : (
        <div className="lontar-text-muted" data-testid="relationship-empty-hint">
          No {pluralLabel} selected
        </div>
      )}

      {isSearching ? (
        <RelationshipSearchDropdown
          relationTo={field.relationTo}
          titleField={titleField}
          singularLabel={singularLabel}
          pluralLabel={pluralLabel}
          apiBase={apiBase}
          excludeIds={selectedIds}
          autoFocus
          onSelect={handleAdd}
          onCancel={() => setIsSearching(false)}
        />
      ) : (
        <button
          type="button"
          className="lontar-btn lontar-btn-secondary lontar-btn-sm"
          onClick={() => setIsSearching(true)}
          data-testid="relationship-add-btn"
        >
          + Add {singularLabel}
        </button>
      )}
    </div>
  )
}

export function RelationshipPicker(props: RelationshipPickerProps) {
  return (
    <div className="lontar-relationship-picker">
      {props.field.hasMany ? (
        <ManyRelationshipPicker {...props} />
      ) : (
        <SingleRelationshipPicker {...props} />
      )}
    </div>
  )
}
