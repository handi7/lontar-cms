import { useState } from 'react'
import type { ClientCollection } from '@lontar/core/client'
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

export function CollectionFilterBar({
  collection,
  searchTerm,
  onSearchChange,
  activeFilters,
  onAddFilter,
  onRemoveFilter,
  onClearAll,
}: {
  collection: ClientCollection
  searchTerm: string
  onSearchChange: (val: string) => void
  activeFilters: ActiveFilter[]
  onAddFilter: (filter: ActiveFilter) => void
  onRemoveFilter: (id: string) => void
  onClearAll: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedField, setSelectedField] = useState(
    collection.admin.useAsTitle || collection.fields[0]?.name || 'id',
  )
  const [selectedOperator, setSelectedOperator] = useState('contains')
  const [filterValue, setFilterValue] = useState('')

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault()
    if (!filterValue.trim()) return
    onAddFilter({
      id: `${selectedField}-${selectedOperator}-${Date.now()}`,
      field: selectedField,
      operator: selectedOperator,
      value: filterValue.trim(),
    })
    setFilterValue('')
    setIsOpen(false)
  }

  const filterFields = [
    { name: 'id', label: 'ID' },
    ...collection.fields.map((f) => ({ name: f.name, label: f.label ?? f.name })),
    { name: 'createdAt', label: 'Created At' },
  ]

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
        <Button
          type="button"
          variant="outline"
          aria-expanded={isOpen}
          className={cn(isOpen && 'lt:border-primary lt:bg-accent')}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          {activeFilters.length > 0 ? `Filters (${activeFilters.length})` : 'Add Filter'}
        </Button>
      </div>

      {isOpen && (
        <form
          className="lt:flex lt:flex-wrap lt:items-center lt:gap-2.5 lt:rounded-md lt:border lt:bg-card lt:p-3.5"
          onSubmit={handleApply}
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
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </form>
      )}

      {(activeFilters.length > 0 || searchTerm) && (
        <div className="lt:flex lt:flex-wrap lt:items-center lt:gap-2">
          {searchTerm && (
            <FilterPill label="Remove search filter" onRemove={() => onSearchChange('')}>
              Search: "{searchTerm}"
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
      )}
    </div>
  )
}

function FilterPill({
  label,
  onRemove,
  children,
}: {
  label: string
  onRemove: () => void
  children: React.ReactNode
}) {
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
