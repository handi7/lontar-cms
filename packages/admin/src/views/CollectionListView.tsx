import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type Table,
} from '@tanstack/react-table'
import type { ClientCollection } from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import { fetchCollectionDocs, deleteDoc, type PaginatedDocs } from '../api/client'
import { NotFoundView } from './NotFoundView'

function getColumnLabel(key: string, collection: ClientCollection): string {
  if (key === 'id') return 'ID'
  if (key === 'createdAt') return 'Created At'
  if (key === 'updatedAt') return 'Updated At'
  const field = collection.fields.find((f) => f.name === key)
  return field?.label ?? key
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
    return val
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val)
  }
  return JSON.stringify(val)
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

  const dataColumns: ColumnDef<Record<string, unknown>>[] = columnKeys.map((key) => ({
    id: key,
    header: getColumnLabel(key, collection),
    accessorFn: (row) => row[key],
    cell: ({ getValue, row }) => {
      const val = getValue()
      if (key === titleKey) {
        return (
          <Link
            to="/$collection/$id"
            params={{ collection: collection.slug, id: String(row.original.id) }}
            className="lontar-table-link"
          >
            {formatCellValue(val ?? row.original.id)}
          </Link>
        )
      }
      return formatCellValue(val)
    },
  }))

  const actionsColumn: ColumnDef<Record<string, unknown>> = {
    id: '__actions',
    header: 'Actions',
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
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
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

export function CollectionListView() {
  const { apiBase } = useAdmin()
  const { collection: slug } = useParams({ strict: false })
  const collection = useCollection(slug)
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: [slug, page],
    queryFn: () => (slug ? fetchCollectionDocs(apiBase, slug, { page, limit: 10 }) : null),
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
    getCoreRowModel: getCoreRowModel(),
  })

  if (!collection) {
    return <NotFoundView />
  }

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

      {error && <div className="lontar-alert lontar-alert-error">{error.message}</div>}

      {isLoading ? (
        <div className="lontar-loading">Loading documents...</div>
      ) : docs.length === 0 ? (
        <EmptyState collection={collection} />
      ) : (
        <CollectionTable table={table} data={data ?? undefined} onPageChange={setPage} />
      )}
    </div>
  )
}
