import { useState } from 'react'
import type { ClientCollection, ClientField } from '@lontar/core/client'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { cn } from '../lib/utils'

export interface ActiveFilter {
  id: string
  field: string
  operator: string
  value: string
}

// Shared by the two selects and the value input so the row lines up.
const filterControlClass = 'lt:h-8 lt:w-auto lt:gap-2 lt:bg-card lt:md:text-[0.8125rem]'

export const OPERATOR_OPTIONS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greater_than', label: 'Greater than' },
  { value: 'less_than', label: 'Less than' },
  { value: 'in', label: 'In (comma-separated)' },
]

export interface FilterFieldOption {
  name: string
  label: string
}

export function collectFilterFields(
  fields: ClientField[],
  prefix = '',
  labelPrefix = '',
): FilterFieldOption[] {
  const options: FilterFieldOption[] = []
  for (const field of fields) {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name
    const fieldLabel = labelPrefix
      ? `${labelPrefix} > ${field.label || field.name}`
      : field.label || field.name

    if (field.type === 'group') {
      options.push(...collectFilterFields(field.fields, fieldPath, fieldLabel))
    } else {
      options.push({ name: fieldPath, label: fieldLabel })
    }
  }
  return options
}

export interface CollectionFilterBarProps {
  collection: ClientCollection
  searchTerm: string
  onSearchChange: (val: string) => void
  activeFilters: ActiveFilter[]
  onAddFilter: (filter: ActiveFilter) => void
  onRemoveFilter: (id: string) => void
  onClearAll: () => void
  hasDrafts?: boolean
  statusFilter?: 'all' | 'published' | 'draft'
  onStatusFilterChange?: (val: 'all' | 'published' | 'draft') => void
}

function resolveInitialField(candidate: string, fields: FilterFieldOption[]): string {
  const match = fields.find((f) => f.name === candidate)
  return match ? match.name : fields[1]?.name || fields[0]?.name || 'id'
}

interface FilterFormProps {
  filterFields: FilterFieldOption[]
  defaultField: string
  onApply: (filter: ActiveFilter) => void
  onCancel: () => void
}

function FilterForm({ filterFields, defaultField, onApply, onCancel }: FilterFormProps) {
  const [selectedField, setSelectedField] = useState(defaultField)
  const [selectedOperator, setSelectedOperator] = useState('contains')
  const [filterValue, setFilterValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!filterValue.trim()) return
    onApply({
      id: `${selectedField}-${selectedOperator}-${Date.now()}`,
      field: selectedField,
      operator: selectedOperator,
      value: filterValue.trim(),
    })
    setFilterValue('')
  }

  return (
    <form
      className="lt:flex lt:flex-wrap lt:items-center lt:gap-2.5 lt:rounded-md lt:border lt:bg-card lt:p-3.5"
      onSubmit={handleSubmit}
    >
      <Select value={selectedField} onValueChange={setSelectedField}>
        <SelectTrigger aria-label="Filter column" className={filterControlClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {filterFields.map((f) => (
            <SelectItem key={f.name} value={f.name}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedOperator} onValueChange={setSelectedOperator}>
        <SelectTrigger aria-label="Filter operator" className={filterControlClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATOR_OPTIONS.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="text"
        className={filterControlClass}
        placeholder="Value..."
        value={filterValue}
        onChange={(e) => setFilterValue(e.target.value)}
        aria-label="Filter value"
      />

      <Button type="submit">Apply</Button>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

interface ActiveFilterListProps {
  searchTerm: string
  onSearchChange: (val: string) => void
  hasStatusFilter: boolean
  statusFilter: 'all' | 'published' | 'draft'
  onStatusFilterChange?: (val: 'all' | 'published' | 'draft') => void
  activeFilters: ActiveFilter[]
  onRemoveFilter: (id: string) => void
  onClearAll: () => void
}

function ActiveFilterList({
  searchTerm,
  onSearchChange,
  hasStatusFilter,
  statusFilter,
  onStatusFilterChange,
  activeFilters,
  onRemoveFilter,
  onClearAll,
}: ActiveFilterListProps) {
  if (activeFilters.length === 0 && !searchTerm && !hasStatusFilter) {
    return null
  }

  return (
    <div className="lt:flex lt:flex-wrap lt:items-center lt:gap-2">
      {searchTerm && (
        <FilterPill label="Remove search filter" onRemove={() => onSearchChange('')}>
          Search: "{searchTerm}"
        </FilterPill>
      )}
      {hasStatusFilter && (
        <FilterPill label="Remove status filter" onRemove={() => onStatusFilterChange?.('all')}>
          status = "{statusFilter}"
        </FilterPill>
      )}
      {activeFilters.map((f) => (
        <FilterPill
          key={f.id}
          label={`Remove ${f.field} filter`}
          onRemove={() => onRemoveFilter(f.id)}
        >
          {f.field} {f.operator} "{f.value}"
        </FilterPill>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="lt:h-7 lt:px-2 lt:text-[0.8125rem] lt:text-muted-foreground"
        onClick={onClearAll}
      >
        Clear all
      </Button>
    </div>
  )
}

interface StatusFilterSelectProps {
  statusFilter: 'all' | 'published' | 'draft'
  onChange: (val: 'all' | 'published' | 'draft') => void
}

function StatusFilterSelect({ statusFilter, onChange }: StatusFilterSelectProps) {
  return (
    <Select
      value={statusFilter}
      onValueChange={(val) => onChange(val as 'all' | 'published' | 'draft')}
    >
      <SelectTrigger
        className="lt:h-9 lt:w-[135px] lt:shrink-0 lt:bg-card"
        aria-label="Filter by status"
      >
        <SelectValue placeholder="All statuses" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        <SelectItem value="published">Published</SelectItem>
        <SelectItem value="draft">Draft</SelectItem>
      </SelectContent>
    </Select>
  )
}

function buildFilterFields(collection: ClientCollection): FilterFieldOption[] {
  const fields = collectFilterFields(collection.fields)
  const draftOption = collection.versions?.drafts ? [{ name: '_status', label: 'Status' }] : []
  return [
    { name: 'id', label: 'ID' },
    ...fields,
    ...draftOption,
    { name: 'createdAt', label: 'Created At' },
  ]
}

export function CollectionFilterBar(props: CollectionFilterBarProps) {
  const {
    collection,
    searchTerm,
    onSearchChange,
    activeFilters,
    onAddFilter,
    onRemoveFilter,
    onClearAll,
    onStatusFilterChange,
  } = props
  const [isOpen, setIsOpen] = useState(false)
  const hasDrafts = Boolean(props.hasDrafts)
  const statusFilter = props.statusFilter ?? 'all'
  const filterFields = buildFilterFields(collection)
  const defaultField = resolveInitialField(collection.admin.useAsTitle || '', filterFields)
  const hasStatusFilter = hasDrafts && statusFilter !== 'all'
  const filterButtonLabel =
    activeFilters.length > 0 ? `Filters (${activeFilters.length})` : 'Add Filter'

  return (
    <div className="lt:mb-5 lt:flex lt:flex-col lt:gap-3">
      <div className="lt:flex lt:items-center lt:gap-3">
        <Input
          type="search"
          className="lt:max-w-[400px] lt:flex-1 lt:bg-card"
          placeholder={`Search ${collection.labels.plural.toLowerCase()}...`}
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={`Search ${collection.labels.plural}`}
        />
        {hasDrafts && onStatusFilterChange ? (
          <StatusFilterSelect statusFilter={statusFilter} onChange={onStatusFilterChange} />
        ) : null}
        <Button
          type="button"
          variant="outline"
          aria-expanded={isOpen}
          className={cn(isOpen && 'lt:border-primary lt:bg-accent')}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          {filterButtonLabel}
        </Button>
      </div>

      {isOpen ? (
        <FilterForm
          filterFields={filterFields}
          defaultField={defaultField}
          onApply={(filter) => {
            onAddFilter(filter)
            setIsOpen(false)
          }}
          onCancel={() => setIsOpen(false)}
        />
      ) : null}

      <ActiveFilterList
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        hasStatusFilter={hasStatusFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        activeFilters={activeFilters}
        onRemoveFilter={onRemoveFilter}
        onClearAll={onClearAll}
      />
    </div>
  )
}

interface FilterPillProps {
  label: string
  onRemove: () => void
  children: React.ReactNode
}

function FilterPill({ label, onRemove, children }: FilterPillProps) {
  return (
    <Badge variant="secondary" className="lt:gap-1.5 lt:px-2.5 lt:py-1">
      {children}
      <button
        type="button"
        className="lt:flex lt:cursor-pointer lt:items-center lt:border-0 lt:bg-transparent lt:p-0 lt:text-sm lt:leading-none lt:text-muted-foreground lt:hover:text-destructive"
        onClick={onRemove}
        aria-label={label}
      >
        ×
      </button>
    </Badge>
  )
}
