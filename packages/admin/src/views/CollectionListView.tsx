import { useState, useMemo, useEffect } from 'react'
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
import { cn } from '../lib/utils'
import {
  fetchCollectionDocs,
  deleteDoc,
  formatApiErrorMessage,
  type PaginatedDocs,
} from '../api/client'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { CollectionFilterBar, type ActiveFilter } from './CollectionFilterBar'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { EmptyCard } from './EmptyCard'
import { NotFoundView } from './NotFoundView'
import { ViewHeader } from './ViewHeader'

const mediaCellClass = 'lt:flex lt:items-center lt:gap-2.5'
const thumbnailClass = 'lt:size-9 lt:shrink-0 lt:rounded-sm lt:border lt:object-cover'
const emptyTextClass = 'lt:mt-0 lt:mb-5 lt:text-muted-foreground'
const rowActionClass = 'lt:h-7 lt:px-2 lt:text-[0.8125rem] lt:text-muted-foreground'
const headClass =
  'lt:h-auto lt:px-4 lt:py-3 lt:text-xs lt:font-semibold lt:tracking-wider lt:text-muted-foreground lt:uppercase'

function getColumnLabel(key: string, collection: ClientCollection): string {
  if (key === 'id') return 'ID'
  if (key === 'createdAt') return 'Created At'
  if (key === 'updatedAt') return 'Updated At'
  const field = collection.fields.find((f) => f.name === key)
  return field?.label ?? key
}

function renderBooleanCell(val: unknown): React.ReactNode {
  return val ? <Badge variant="success">true</Badge> : <Badge variant="muted">false</Badge>
}

function renderSelectCell(val: unknown, field: ClientSelectField): React.ReactNode {
  const str = typeof val === 'string' ? val : typeof val === 'number' ? String(val) : ''
  const opt = field.options.find((o) => o.value === str)
  return <Badge variant="secondary">{opt?.label ?? str}</Badge>
}

function renderDateCell(val: unknown): string {
  if (typeof val === 'string' || val instanceof Date) {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  }
  return typeof val === 'string' ? val : ''
}

function getDocTitle(doc: Record<string, unknown>): string {
  if (typeof doc.filename === 'string' && doc.filename) return doc.filename
  if (typeof doc.title === 'string' && doc.title) return doc.title
  if (typeof doc.id === 'string' || typeof doc.id === 'number') return `#${doc.id}`
  return '—'
}

function isDocImage(mimeType: unknown, url: string): boolean {
  if (typeof mimeType === 'string' && mimeType.startsWith('image/')) return true
  return Boolean(url.match(/\.(png|jpe?g|gif|webp|svg)$/i))
}

function renderUploadCell(val: unknown): React.ReactNode {
  if (typeof val === 'object' && val !== null) {
    const doc = val as Record<string, unknown>
    const url = typeof doc.url === 'string' ? doc.url : ''
    const thumbUrl = (doc.sizes as Record<string, { url?: string }> | undefined)?.thumb?.url || url
    const isImage = isDocImage(doc.mimeType, url)
    const title = getDocTitle(doc)
    return (
      <div className={mediaCellClass}>
        {isImage && thumbUrl && <img src={thumbUrl} alt="" className={thumbnailClass} />}
        <span>{title}</span>
      </div>
    )
  }
  return `#${String(val)}`
}

function renderFieldCell(val: unknown, field: ClientField): React.ReactNode {
  switch (field.type) {
    case 'checkbox':
      return renderBooleanCell(val)
    case 'select':
      return renderSelectCell(val, field)
    case 'date':
      return renderDateCell(val)
    case 'upload':
      return renderUploadCell(val)
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
    return <span className="lt:text-muted-foreground">—</span>
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

interface DataCellRendererProps {
  val: unknown
  rowDoc: Record<string, unknown>
  field?: ClientField
  colKey: string
  titleKey: string
  isUploadCollection: boolean
  collectionSlug: string
}

function renderMediaThumbnailCell(
  rowDoc: Record<string, unknown>,
  content: React.ReactNode,
): React.ReactNode {
  const thumbUrl =
    (rowDoc.sizes as Record<string, { url?: string }> | undefined)?.thumb?.url ||
    (typeof rowDoc.url === 'string' ? rowDoc.url : '')
  const isImage = isDocImage(rowDoc.mimeType, thumbUrl)
  if (isImage && thumbUrl) {
    return (
      <div className={mediaCellClass}>
        <img src={thumbUrl} alt="" className={thumbnailClass} />
        <span>{content}</span>
      </div>
    )
  }
  return content
}

function DataCellRenderer({
  val,
  rowDoc,
  field,
  colKey,
  titleKey,
  isUploadCollection,
  collectionSlug,
}: DataCellRendererProps) {
  const rawContent = renderCellContent(val ?? (colKey === 'id' ? rowDoc.id : ''), field, colKey)
  const isMediaTitle = isUploadCollection && (colKey === titleKey || colKey === 'filename')
  const content = isMediaTitle ? renderMediaThumbnailCell(rowDoc, rawContent) : rawContent

  if (colKey === titleKey) {
    return (
      <Link
        to="/$collection/$id"
        params={{ collection: collectionSlug, id: String(rowDoc.id) }}
        className="lt:font-semibold lt:text-foreground lt:underline lt:underline-offset-2"
      >
        {content}
      </Link>
    )
  }
  return <>{content}</>
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
      accessorFn: (row) => {
        if (key.includes('.')) {
          return key.split('.').reduce((acc: unknown, part) => {
            if (acc && typeof acc === 'object') {
              return (acc as Record<string, unknown>)[part]
            }
            return undefined
          }, row)
        }
        return row[key]
      },
      enableSorting: true,
      cell: ({ getValue, row }) => (
        <DataCellRenderer
          val={getValue()}
          rowDoc={row.original}
          field={field}
          colKey={key}
          titleKey={titleKey}
          isUploadCollection={Boolean(collection.upload)}
          collectionSlug={collection.slug}
        />
      ),
    }
  })

  const actionsColumn: ColumnDef<Record<string, unknown>> = {
    id: '__actions',
    header: 'Actions',
    enableSorting: false,
    cell: ({ row }) => {
      const id = String(row.original.id)
      return (
        <div className="lt:flex lt:items-center lt:gap-2">
          <Button asChild variant="ghost" size="sm" className={rowActionClass}>
            <Link to="/$collection/$id" params={{ collection: collection.slug, id }}>
              Edit
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              rowActionClass,
              'lt:text-destructive lt:hover:bg-error-bg lt:hover:text-destructive',
            )}
            disabled={isDeleting}
            onClick={() => {
              onDelete(id)
            }}
          >
            Delete
          </Button>
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
    <div className="lt:overflow-hidden lt:rounded-md lt:border lt:bg-card">
      <UITable>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="lt:bg-background lt:hover:bg-background">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const isSorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      headClass,
                      canSort && 'lt:cursor-pointer lt:select-none lt:hover:bg-muted',
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                    aria-sort={
                      isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : 'none'
                    }
                  >
                    <div className="lt:inline-flex lt:items-center lt:gap-1.5">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && (
                        <span
                          className="lt:text-[0.6875rem] lt:text-muted-foreground"
                          aria-hidden="true"
                        >
                          {isSorted === 'asc' ? ' ↑' : isSorted === 'desc' ? ' ↓' : ' ⇅'}
                        </span>
                      )}
                    </div>
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="lt:px-4 lt:py-3.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </UITable>

      <div className="lt:flex lt:items-center lt:justify-between lt:border-t lt:bg-background lt:px-5 lt:py-3.5">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onPageChange(Math.max(1, (data?.page ?? 1) - 1))
          }}
          disabled={!data?.hasPrevPage}
        >
          Previous
        </Button>
        <span className="lt:text-[0.8125rem] lt:text-muted-foreground">
          Page {data?.page ?? 1} of {data?.totalPages ?? 1}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onPageChange((data?.page ?? 1) + 1)
          }}
          disabled={!data?.hasNextPage}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ collection }: { collection: ClientCollection }) {
  return (
    <EmptyCard>
      <p className={emptyTextClass}>No {collection.labels.plural.toLowerCase()} found.</p>
      <Button asChild variant="outline">
        <Link to="/$collection/create" params={{ collection: collection.slug }}>
          Create the first {collection.labels.singular.toLowerCase()}
        </Link>
      </Button>
    </EmptyCard>
  )
}

function ListContent({
  isLoading,
  isError,
  docsCount,
  hasActiveFilters,
  collection,
  onClearFilters,
  table,
  data,
  onPageChange,
}: {
  isLoading: boolean
  isError?: boolean
  docsCount: number
  hasActiveFilters: boolean
  collection: ClientCollection
  onClearFilters: () => void
  table: Table<Record<string, unknown>>
  data?: PaginatedDocs
  onPageChange: (newPage: number) => void
}) {
  if (isLoading) {
    return <EmptyCard>Loading documents...</EmptyCard>
  }
  if (isError) {
    return null
  }
  if (docsCount === 0) {
    if (hasActiveFilters) {
      return (
        <EmptyCard>
          <p className={emptyTextClass}>No documents found matching the filter criteria.</p>
          <Button type="button" variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        </EmptyCard>
      )
    }
    return <EmptyState collection={collection} />
  }
  return <CollectionTable table={table} data={data} onPageChange={onPageChange} />
}

function formatSortParam(sorting: SortingState): string | undefined {
  if (sorting.length === 0) return undefined
  return sorting.map((s) => (s.desc ? `-${s.id}` : s.id)).join(',')
}

function useListFilters() {
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])

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

  return {
    page,
    setPage,
    searchTerm,
    activeFilters,
    handleSearchChange,
    handleAddFilter,
    handleRemoveFilter,
    handleClearAll,
  }
}

function useListDeleteMutation(apiBase: string, slug?: string) {
  const queryClient = useQueryClient()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (id: number | string) =>
      slug ? deleteDoc(apiBase, slug, id) : Promise.reject(new Error('Missing collection slug')),
    onSuccess: () => {
      setDeleteError(null)
      void queryClient.invalidateQueries({ queryKey: [slug] })
    },
    onError: (err: Error) => {
      setDeleteError(formatApiErrorMessage(err))
    },
  })

  // The row's Delete button only asks; the dialog's confirm does the delete.
  const [pendingId, setPendingId] = useState<number | string | null>(null)

  const handleDelete = (id: number | string) => {
    setPendingId(id)
  }

  const confirmDelete = () => {
    if (pendingId === null) return
    setDeleteError(null)
    mutation.mutate(pendingId)
    setPendingId(null)
  }

  return {
    deleteError,
    setDeleteError,
    handleDelete,
    isDeleting: mutation.isPending,
    confirmOpen: pendingId !== null,
    closeConfirm: () => setPendingId(null),
    confirmDelete,
  }
}

function ListAlerts({
  queryError,
  deleteError,
}: {
  queryError?: Error | null
  deleteError?: string | null
}) {
  if (!queryError && !deleteError) return null
  return (
    <>
      {queryError && (
        <Alert variant="destructive" className="lt:mb-5">
          {queryError.message}
        </Alert>
      )}
      {deleteError && (
        <Alert variant="destructive" className="lt:mb-5" data-testid="delete-error-alert">
          {deleteError}
        </Alert>
      )}
    </>
  )
}

function useCollectionDocsQuery(
  apiBase: string,
  slug: string | undefined,
  page: number,
  sortParam: string | undefined,
  where: Where | undefined,
) {
  return useQuery({
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
    enabled: Boolean(slug),
  })
}

export function CollectionListView() {
  const { apiBase } = useAdmin()
  const { collection: slug } = useParams({ strict: false })
  const collection = useCollection(slug)
  const [sorting, setSorting] = useState<SortingState>([])

  const {
    page,
    setPage,
    searchTerm,
    activeFilters,
    handleSearchChange,
    handleAddFilter,
    handleRemoveFilter,
    handleClearAll,
  } = useListFilters()

  const {
    deleteError,
    setDeleteError,
    handleDelete,
    isDeleting,
    confirmOpen,
    closeConfirm,
    confirmDelete,
  } = useListDeleteMutation(apiBase, slug)

  useEffect(() => {
    setDeleteError(null)
  }, [slug, page, setDeleteError])

  const searchField = collection?.admin.useAsTitle || 'title'

  const where = useMemo(
    () => buildWhereQuery(searchTerm, searchField, activeFilters),
    [searchTerm, searchField, activeFilters],
  )

  const sortParam = useMemo(() => formatSortParam(sorting), [sorting])
  const { data, isLoading, error } = useCollectionDocsQuery(apiBase, slug, page, sortParam, where)

  const columns = useMemo(() => {
    if (!collection) return []
    return buildColumns(collection, handleDelete, isDeleting)
  }, [collection, handleDelete, isDeleting])

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
    <div>
      <ViewHeader
        title={collection.labels.plural}
        actions={
          <Button asChild>
            <Link to="/$collection/create" params={{ collection: collection.slug }}>
              Create {collection.labels.singular}
            </Link>
          </Button>
        }
      >
        <Badge variant="secondary" className="lt:mt-1.5">
          {data?.totalDocs ?? 0} items
        </Badge>
      </ViewHeader>

      <CollectionFilterBar
        collection={collection}
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        activeFilters={activeFilters}
        onAddFilter={handleAddFilter}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={handleClearAll}
      />

      <ListAlerts queryError={error} deleteError={deleteError} />

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) closeConfirm()
        }}
        onConfirm={confirmDelete}
      />

      <ListContent
        isLoading={isLoading}
        isError={Boolean(error)}
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
