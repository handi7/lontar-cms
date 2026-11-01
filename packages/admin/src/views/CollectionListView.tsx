import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type Table,
  type SortingState,
} from '@tanstack/react-table'
import type { ClientCollection, ClientField, ClientSelectField, Where } from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import { fetchCollectionDocs, deleteDoc, type PaginatedDocs } from '../api/client'
import { CollectionFilterBar, type ActiveFilter } from './CollectionFilterBar'
import { NotFoundView } from './NotFoundView'

function getColumnLabel(key: string, collection: ClientCollection): string {
  if (key === 'id') return 'ID'
  if (key === 'createdAt') return 'Created At'
  if (key === 'updatedAt') return 'Updated At'
  const field = collection.fields.find((f) => f.name === key)
  return field?.label ?? key
}

function renderBooleanCell(val: unknown): React.ReactNode {
  return val ? (
    <span className="lontar-tag lontar-tag-success">true</span>
  ) : (
    <span className="lontar-tag lontar-tag-muted">false</span>
  )
}

function renderSelectCell(val: unknown, field: ClientSelectField): React.ReactNode {
  const str = typeof val === 'string' ? val : typeof val === 'number' ? String(val) : ''
  const opt = field.options.find((o) => o.value === str)
  return <span className="lontar-tag lontar-tag-neutral">{opt?.label ?? str}</span>
}

function renderDateCell(val: unknown): string {
  if (typeof val === 'string' || val instanceof Date) {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  }
  return typeof val === 'string' ? val : ''
}

function renderFieldCell(val: unknown, field: ClientField): React.ReactNode {
  switch (field.type) {
    case 'checkbox':
      return renderBooleanCell(val)
    case 'select':
      return renderSelectCell(val, field)
    case 'date':
      return renderDateCell(val)
    default:
      return null
  }
}

function renderPrimitiveValue(val: unknown): React.ReactNode {
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return val
  return JSON.stringify(val)
}

function isDateKey(key: string): boolean {
  return key === 'createdAt' || key === 'updatedAt'
}

function renderCellContent(
  val: unknown,
  field: ClientField | undefined,
  key: string,
): React.ReactNode {
  if (val === null || val === undefined || val === '') {
    return <span className="lontar-cell-empty">—</span>
  }
  if (field) {
    const rendered = renderFieldCell(val, field)
    if (rendered !== null) return rendered
  }
  if (isDateKey(key)) {
    return renderDateCell(val)
  }
  return renderPrimitiveValue(val)
}

function buildWhereQuery(
  searchTerm: string,
  searchField: string,
  activeFilters: ActiveFilter[],
): Where | undefined {
  const where: Where = {}
  if (searchTerm.trim()) {
    where[searchField] = { contains: searchTerm.trim() }
  }

  for (const filter of activeFilters) {
    if (!filter.field || !filter.operator || filter.value === '') continue
    const fieldWhere = (where[filter.field] ?? {}) as Record<string, unknown>
    if (filter.operator === 'in') {
      fieldWhere[filter.operator] = filter.value.split(',').map((s) => s.trim())
    } else {
      fieldWhere[filter.operator] = filter.value
    }
    where[filter.field] = fieldWhere
  }

  return Object.keys(where).length > 0 ? where : undefined
}

function buildColumns(
  collection: ClientCollection,
  onDelete: (id: number | string) => void,
  isDeleting: boolean,
): ColumnDef<Record<string, unknown>>[] {
  const columnKeys =
    collection.admin.defaultColumns.length > 0
      ? collection.admin.defaultColumns
      : ['id', ...collection.fields.map((f) => f.name), 'createdAt']

  const titleKey = collection.admin.useAsTitle || 'id'

  const dataColumns: ColumnDef<Record<string, unknown>>[] = columnKeys.map((key) => {
    const field = collection.fields.find((f) => f.name === key)
    return {
      id: key,
      header: getColumnLabel(key, collection),
      accessorFn: (row) => row[key],
      enableSorting: true,
      cell: ({ getValue, row }) => {
        const val = getValue()
        const content = renderCellContent(val ?? (key === 'id' ? row.original.id : ''), field, key)
        if (key === titleKey) {
          return (
            <Link
              to="/$collection/$id"
              params={{ collection: collection.slug, id: String(row.original.id) }}
              className="lontar-table-link"
            >
              {content}
            </Link>
          )
        }
        return content
      },
    }
  })

  const actionsColumn: ColumnDef<Record<string, unknown>> = {
    id: '__actions',
    header: 'Actions',
    enableSorting: false,
    cell: ({ row }) => {
      const id = String(row.original.id)
      return (
        <div className="lontar-table-actions">
          <Link
            to="/$collection/$id"
            params={{ collection: collection.slug, id }}
            className="lontar-btn-link"
          >
            Edit
          </Link>
          <button
            type="button"
            className="lontar-btn-link lontar-btn-danger"
            disabled={isDeleting}
            onClick={() => {
              onDelete(id)
            }}
          >
            Delete
          </button>
        </div>
      )
    },
  }

  return [...dataColumns, actionsColumn]
}

function CollectionTable({
  table,
  data,
  onPageChange,
}: {
  table: Table<Record<string, unknown>>
  data?: PaginatedDocs
  onPageChange: (newPage: number) => void
}) {
  return (
    <div className="lontar-table-wrapper">
      <table className="lontar-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const isSorted = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    className={canSort ? 'lontar-th-sortable' : undefined}
                    onClick={header.column.getToggleSortingHandler()}
                    aria-sort={
                      isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : 'none'
                    }
                  >
                    <div className="lontar-th-content">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && (
                        <span className="lontar-sort-indicator" aria-hidden="true">
                          {isSorted === 'asc' ? ' ↑' : isSorted === 'desc' ? ' ↓' : ' ⇅'}
                        </span>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="lontar-pagination">
        <button
          type="button"
          className="lontar-btn lontar-btn-secondary"
          onClick={() => {
            onPageChange(Math.max(1, (data?.page ?? 1) - 1))
          }}
          disabled={!data?.hasPrevPage}
        >
          Previous
        </button>
        <span className="lontar-pagination-info">
          Page {data?.page ?? 1} of {data?.totalPages ?? 1}
        </span>
        <button
          type="button"
          className="lontar-btn lontar-btn-secondary"
          onClick={() => {
            onPageChange((data?.page ?? 1) + 1)
          }}
          disabled={!data?.hasNextPage}
        >
          Next
        </button>
      </div>
    </div>
  )
}

function EmptyState({ collection }: { collection: ClientCollection }) {
  return (
    <div className="lontar-empty-state">
      <p>No {collection.labels.plural.toLowerCase()} found.</p>
      <Link
        to="/$collection/create"
        params={{ collection: collection.slug }}
        className="lontar-btn lontar-btn-secondary"
      >
        Create the first {collection.labels.singular.toLowerCase()}
      </Link>
    </div>
  )
}

function ListContent({
  isLoading,
  docsCount,
  hasActiveFilters,
  collection,
  onClearFilters,
  table,
  data,
  onPageChange,
}: {
  isLoading: boolean
  docsCount: number
  hasActiveFilters: boolean
  collection: ClientCollection
  onClearFilters: () => void
  table: Table<Record<string, unknown>>
  data?: PaginatedDocs
  onPageChange: (newPage: number) => void
}) {
  if (isLoading) {
    return <div className="lontar-loading">Loading documents...</div>
  }
  if (docsCount === 0) {
    if (hasActiveFilters) {
      return (
        <div className="lontar-empty-state">
          <p>No documents found matching the filter criteria.</p>
          <button
            type="button"
            className="lontar-btn lontar-btn-secondary"
            onClick={onClearFilters}
          >
            Clear filters
          </button>
        </div>
      )
    }
    return <EmptyState collection={collection} />
  }
  return <CollectionTable table={table} data={data} onPageChange={onPageChange} />
}

export function CollectionListView() {
  const { apiBase } = useAdmin()
  const { collection: slug } = useParams({ strict: false })
  const collection = useCollection(slug)
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [sorting, setSorting] = useState<SortingState>([])

  const searchField = useMemo(() => {
    if (!collection) return 'title'
    return (
      collection.admin.useAsTitle ||
      collection.fields.find((f) => f.type === 'text' || f.type === 'email' || f.type === 'slug')
        ?.name ||
      'title'
    )
  }, [collection])

  const where = useMemo(
    () => buildWhereQuery(searchTerm, searchField, activeFilters),
    [searchTerm, searchField, activeFilters],
  )

  const sortParam = useMemo(() => {
    if (sorting.length === 0) return undefined
    return sorting.map((s) => (s.desc ? `-${s.id}` : s.id)).join(',')
  }, [sorting])

  const handleSearchChange = (term: string) => {
    setSearchTerm(term)
    setPage(1)
  }

  const handleAddFilter = (filter: ActiveFilter) => {
    setActiveFilters((prev) => [...prev, filter])
    setPage(1)
  }

  const handleRemoveFilter = (id: string) => {
    setActiveFilters((prev) => prev.filter((f) => f.id !== id))
    setPage(1)
  }

  const handleClearAll = () => {
    setSearchTerm('')
    setActiveFilters([])
    setPage(1)
  }

  const { data, isLoading, error } = useQuery({
    queryKey: [slug, page, sortParam, where],
    queryFn: () =>
      slug
        ? fetchCollectionDocs(apiBase, slug, {
            page,
            limit: 10,
            sort: sortParam,
            where,
          })
        : null,
    enabled: !!slug,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) =>
      slug ? deleteDoc(apiBase, slug, id) : Promise.reject(new Error('Missing collection slug')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [slug] })
    },
  })

  const handleDelete = (id: number | string) => {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm('Are you sure you want to delete this document?')
    if (confirmed) {
      deleteMutation.mutate(id)
    }
  }

  const columns = useMemo(() => {
    if (!collection) return []
    return buildColumns(collection, handleDelete, deleteMutation.isPending)
  }, [collection, deleteMutation.isPending])

  const docs = useMemo(() => data?.docs ?? [], [data?.docs])

  const table = useReactTable({
    data: docs,
    columns,
    state: {
      sorting,
    },
    onSortingChange: (updater) => {
      setSorting(updater)
      setPage(1)
    },
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  if (!collection) {
    return <NotFoundView />
  }

  const hasActiveFilters = Boolean(searchTerm.trim() || activeFilters.length > 0)

  return (
    <div className="lontar-collection-list">
      <header className="lontar-view-header">
        <div>
          <h1>{collection.labels.plural}</h1>
          <span className="lontar-badge">{data?.totalDocs ?? 0} items</span>
        </div>
        <Link
          to="/$collection/create"
          params={{ collection: collection.slug }}
          className="lontar-btn lontar-btn-primary"
        >
          Create {collection.labels.singular}
        </Link>
      </header>

      <CollectionFilterBar
        collection={collection}
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        activeFilters={activeFilters}
        onAddFilter={handleAddFilter}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={handleClearAll}
      />

      {error && <div className="lontar-alert lontar-alert-error">{error.message}</div>}

      <ListContent
        isLoading={isLoading}
        docsCount={docs.length}
        hasActiveFilters={hasActiveFilters}
        collection={collection}
        onClearFilters={handleClearAll}
        table={table}
        data={data ?? undefined}
        onPageChange={setPage}
      />
    </div>
  )
}
