import type { SortingState } from '@tanstack/react-table'
import type { ClientCollection, FieldPermission } from '@lontar/core/client'
import { OPERATOR_OPTIONS, buildFilterFields, type ActiveFilter } from './CollectionFilterBar'

export type ListStatus = 'published' | 'draft'

export interface ListFilterParam {
  field: string
  operator: string
  value: string
}

/** What the list route keeps in the URL. Every key is optional and omitted at its default. */
export interface ListSearchParams {
  locale?: string
  page?: number
  q?: string
  status?: ListStatus
  sort?: string
  filters?: ListFilterParam[]
}

/** `ListSearchParams` checked against a collection and turned into what the view renders. */
export interface ListState {
  page: number
  searchTerm: string
  statusFilter: 'all' | ListStatus
  sorting: SortingState
  filters: ActiveFilter[]
}

const OPERATORS = new Set(OPERATOR_OPTIONS.map((op) => op.value))

// The router parses `?q=123` to a number, so scalars are accepted as text too.
function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function parsePage(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n > 1 ? n : undefined
}

function parseFilter(raw: unknown): ListFilterParam | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { field, operator, value } = raw as Record<string, unknown>
  const text = asText(value)
  if (typeof field !== 'string' || typeof operator !== 'string' || text === undefined) {
    return undefined
  }
  return { field, operator, value: text }
}

function parseFilters(value: unknown): ListFilterParam[] | undefined {
  if (!Array.isArray(value)) return undefined
  const filters = value.map(parseFilter).filter((f): f is ListFilterParam => f !== undefined)
  return filters.length > 0 ? filters : undefined
}

/**
 * Route-level `validateSearch`. It checks shapes only, and never throws on a hand-edited URL.
 * Names are checked against the collection later, by `resolveListState`.
 */
export function parseListSearch(search: Record<string, unknown>): ListSearchParams {
  const q = asText(search.q)
  const sort = asText(search.sort)
  return {
    locale: typeof search.locale === 'string' ? search.locale : undefined,
    page: parsePage(search.page),
    q: q?.trim() ? q : undefined,
    status: search.status === 'published' || search.status === 'draft' ? search.status : undefined,
    sort: sort?.trim() ? sort : undefined,
    filters: parseFilters(search.filters),
  }
}

function sanitizeFilters(filters: ListFilterParam[] | undefined, allowed: Set<string>) {
  const result: ActiveFilter[] = []
  for (const f of filters ?? []) {
    if (!allowed.has(f.field) || !OPERATORS.has(f.operator) || f.value === '') continue
    result.push({ id: `${f.field}-${f.operator}-${result.length}`, ...f })
  }
  return result
}

function sanitizeSorting(sort: string | undefined, allowed: Set<string>): SortingState {
  const sorting: SortingState = []
  for (const part of (sort ?? '').split(',')) {
    const desc = part.startsWith('-')
    const id = desc ? part.slice(1) : part
    if (allowed.has(id) && !sorting.some((s) => s.id === id)) sorting.push({ id, desc })
  }
  return sorting
}

export function resolveListState(
  params: ListSearchParams,
  collection: ClientCollection,
  fieldPermissions?: Record<string, FieldPermission>,
): ListState {
  const filterable = new Set(buildFilterFields(collection, fieldPermissions).map((f) => f.name))
  const sortable = new Set([...filterable, 'updatedAt'])
  const hasDrafts = Boolean(collection.versions?.drafts)
  return {
    page: params.page ?? 1,
    searchTerm: params.q ?? '',
    statusFilter: hasDrafts && params.status ? params.status : 'all',
    sorting: sanitizeSorting(params.sort, sortable),
    filters: sanitizeFilters(params.filters, filterable),
  }
}

export function formatSortParam(sorting: SortingState): string | undefined {
  if (sorting.length === 0) return undefined
  return sorting.map((s) => (s.desc ? `-${s.id}` : s.id)).join(',')
}

export function toFilterParams(filters: ActiveFilter[]): ListFilterParam[] | undefined {
  if (filters.length === 0) return undefined
  return filters.map(({ field, operator, value }) => ({ field, operator, value }))
}
