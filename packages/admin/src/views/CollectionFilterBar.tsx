import { useState } from 'react'
import type { ClientCollection } from '@lontar/core/client'

export interface ActiveFilter {
  id: string
  field: string
  operator: string
  value: string
}

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
    <div className="lontar-filter-container">
      <div className="lontar-toolbar">
        <div className="lontar-search-wrapper">
          <input
            type="search"
            className="lontar-search-input"
            placeholder={`Search ${collection.labels.plural.toLowerCase()}...`}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={`Search ${collection.labels.plural}`}
          />
        </div>
        <button
          type="button"
          className={`lontar-btn lontar-btn-secondary ${isOpen ? 'lontar-btn-active' : ''}`}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          {activeFilters.length > 0 ? `Filters (${activeFilters.length})` : 'Add Filter'}
        </button>
      </div>

      {isOpen && (
        <form className="lontar-filter-form" onSubmit={handleApply}>
          <select
            className="lontar-select"
            value={selectedField}
            onChange={(e) => setSelectedField(e.target.value)}
            aria-label="Filter column"
          >
            {filterFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            className="lontar-select"
            value={selectedOperator}
            onChange={(e) => setSelectedOperator(e.target.value)}
            aria-label="Filter operator"
          >
            {OPERATOR_OPTIONS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            className="lontar-input"
            placeholder="Value..."
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            aria-label="Filter value"
          />

          <button type="submit" className="lontar-btn lontar-btn-primary">
            Apply
          </button>
          <button
            type="button"
            className="lontar-btn lontar-btn-secondary"
            onClick={() => setIsOpen(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {(activeFilters.length > 0 || searchTerm) && (
        <div className="lontar-filter-pills">
          {searchTerm && (
            <span className="lontar-pill">
              Search: "{searchTerm}"
              <button
                type="button"
                className="lontar-pill-remove"
                onClick={() => onSearchChange('')}
                aria-label="Remove search filter"
              >
                ×
              </button>
            </span>
          )}
          {activeFilters.map((f) => (
            <span key={f.id} className="lontar-pill">
              {f.field} {f.operator} "{f.value}"
              <button
                type="button"
                className="lontar-pill-remove"
                onClick={() => onRemoveFilter(f.id)}
                aria-label={`Remove ${f.field} filter`}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="lontar-btn-link" onClick={onClearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
