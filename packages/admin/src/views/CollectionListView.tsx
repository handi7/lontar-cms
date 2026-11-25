import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type Table,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import type {
  ClientAction,
  ClientCollection,
  ClientField,
  ClientRadioField,
  ClientSelectField,
  FieldPermission,
  Where,
} from '@lontar/core/client'
import { useAdmin, useCollection } from '../context/AdminContext'
import { usePermissions } from '../context/PermissionsContext'
import { useLocale } from '../hooks/useLocale'
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
import { Checkbox } from '../components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { useDeclarativeAction } from './useDeclarativeAction'
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { CollectionFilterBar, resolveSearchField, type ActiveFilter } from './CollectionFilterBar'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { DocumentStatusBadge } from './DocumentStatusBadge'
import { EmptyCard } from './EmptyCard'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NotFoundView } from './NotFoundView'
import { ViewHeader } from './ViewHeader'
import type { RowId, RowSelection } from './bulk'
import { ColumnPicker } from './ColumnPicker'
import { getColumnLabel, titleColumnKey } from './columns'
import { useColumnPreference, type ColumnPreference } from './useColumnPreference'
import { useListBulk } from './useListBulk'
import { MediaControls } from './MediaControls'
import { MediaDetailDialog } from './MediaDetailDialog'
import { MediaGrid } from './MediaGrid'
import { ListPagination } from './ListPagination'
import { mimeGroupWhere, type ListViewMode, type MimeGroup } from './media'
import { useViewMode } from './useViewMode'
import {
  formatSortParam,
  parseListSearch,
  resolveListState,
  toFilterParams,
  type ListSearchParams,
  type ListStatus,
} from './listSearch'

const mediaCellClass = 'lt:flex lt:items-center lt:gap-2.5'
const thumbnailClass = 'lt:size-9 lt:shrink-0 lt:rounded-sm lt:border lt:object-cover'
const emptyTextClass = 'lt:mt-0 lt:mb-5 lt:text-muted-foreground'
const rowActionClass = 'lt:h-7 lt:px-2 lt:text-[0.8125rem] lt:text-muted-foreground'
const headClass =
  'lt:h-auto lt:px-4 lt:py-3 lt:text-xs lt:font-semibold lt:tracking-wider lt:text-muted-foreground lt:uppercase'

function renderBooleanCell(val: unknown): React.ReactNode {
  return val ? <Badge variant="success">true</Badge> : <Badge variant="muted">false</Badge>
}

function renderSelectCell(
  val: unknown,
  field: ClientSelectField | ClientRadioField,
): React.ReactNode {
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

function renderPointCell(val: unknown): string {
  if (
    Array.isArray(val) &&
    val.length === 2 &&
    typeof val[0] === 'number' &&
    typeof val[1] === 'number'
  ) {
    return `${val[0]}, ${val[1]}`
  }
  return ''
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

function renderScalarHasManyCell(val: unknown, field: ClientField): React.ReactNode | null {
  if (Array.isArray(val) && (field.type === 'text' || field.type === 'number') && field.hasMany) {
    if (val.length === 0) return <span className="lt:text-muted-foreground">—</span>
    return val.join(', ')
  }
  return null
}

function renderFieldCell(val: unknown, field: ClientField): React.ReactNode {
  const hasManyCell = renderScalarHasManyCell(val, field)
  if (hasManyCell !== null) return hasManyCell

  switch (field.type) {
    case 'checkbox':
      return renderBooleanCell(val)
    case 'select':
    case 'radio':
      return renderSelectCell(val, field)
    case 'date':
      return renderDateCell(val)
    case 'point':
      return renderPointCell(val)
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

function applyActiveFilters(where: Where, activeFilters: ActiveFilter[]): void {
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
}

function buildWhereQuery(
  searchTerm: string,
  searchField: string | undefined,
  activeFilters: ActiveFilter[],
  statusFilter?: 'all' | 'published' | 'draft',
  mimeGroup?: MimeGroup,
): Where | undefined {
  const where: Where = {}
  if (searchTerm.trim() && searchField) {
    where[searchField] = { contains: searchTerm.trim() }
  }

  if (statusFilter && statusFilter !== 'all') {
    where._status = { equals: statusFilter }
  }

  if (mimeGroup) {
    where.and = [mimeGroupWhere(mimeGroup)]
  }

  applyActiveFilters(where, activeFilters)

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
  activeLocale?: string
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
  activeLocale,
}: DataCellRendererProps) {
  if (colKey === '_status') {
    return <DocumentStatusBadge doc={rowDoc} />
  }

  const rawContent = renderCellContent(val ?? (colKey === 'id' ? rowDoc.id : ''), field, colKey)
  const isMediaTitle = isUploadCollection && (colKey === titleKey || colKey === 'filename')
  const content = isMediaTitle ? renderMediaThumbnailCell(rowDoc, rawContent) : rawContent

  if (colKey === titleKey) {
    return (
      <Link
        to="/$collection/$id"
        params={{ collection: collectionSlug, id: String(rowDoc.id) }}
        search={(prev: Record<string, unknown>) =>
          activeLocale ? { ...prev, locale: activeLocale } : prev
        }
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
  columnKeys: string[],
  onDelete: (id: number | string) => void,
  isDeleting: boolean,
  canDelete: boolean = true,
  activeLocale?: string,
  onExecuteAction?: (action: ClientAction, rowDoc: Record<string, unknown>) => void,
  isAllowedAction?: (actionKey: string) => boolean,
): ColumnDef<Record<string, unknown>>[] {
  const titleKey = titleColumnKey(collection)
  const rowActions = (collection.admin.actions ?? []).filter(
    (action) => action.scope.includes('row') && (!isAllowedAction || isAllowedAction(action.key)),
  )

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
          activeLocale={activeLocale}
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
      const docTitle = String(row.original[titleKey] || row.original.id)
      return (
        <div className="lt:flex lt:items-center lt:gap-2">
          <Button asChild variant="ghost" size="sm" className={rowActionClass}>
            <Link
              to="/$collection/$id"
              params={{ collection: collection.slug, id }}
              search={(prev: Record<string, unknown>) =>
                activeLocale ? { ...prev, locale: activeLocale } : prev
              }
            >
              Edit
            </Link>
          </Button>
          {canDelete && (
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
          )}
          {rowActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={rowActionClass}
                  aria-label={`Actions for ${docTitle}`}
                >
                  <MoreHorizontal className="lt:size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {rowActions.map((action) => (
                  <DropdownMenuItem
                    key={action.key}
                    className={cn(
                      action.variant === 'destructive' &&
                        'lt:text-destructive lt:hover:text-destructive lt:focus:text-destructive',
                    )}
                    onClick={() => onExecuteAction?.(action, row.original)}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )
    },
  }

  return [...dataColumns, actionsColumn]
}

interface CollectionTableProps {
  table: Table<Record<string, unknown>>
  data?: PaginatedDocs
  onPageChange: (newPage: number) => void
  selection?: RowSelection
}

interface SelectAllHeadProps {
  selection: RowSelection
}

function SelectAllHead({ selection }: SelectAllHeadProps) {
  return (
    <TableHead className={cn(headClass, 'lt:w-10')}>
      <Checkbox
        aria-label="Select all on this page"
        checked={selection.pageState}
        onCheckedChange={(checked) => selection.togglePage(checked === true)}
      />
    </TableHead>
  )
}

interface SelectRowCellProps {
  id: RowId
  selection: RowSelection
}

function SelectRowCell({ id, selection }: SelectRowCellProps) {
  return (
    <TableCell className="lt:w-10 lt:px-4 lt:py-3.5">
      <Checkbox
        aria-label={`Select ${selection.labelFor(id)}`}
        checked={selection.isSelected(id)}
        onCheckedChange={(checked) => selection.toggle(id, checked === true)}
      />
    </TableCell>
  )
}

function CollectionTable({ table, data, onPageChange, selection }: CollectionTableProps) {
  return (
    <div className="lt:overflow-hidden lt:rounded-md lt:border lt:bg-card">
      <UITable>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="lt:bg-background lt:hover:bg-background">
              {selection && <SelectAllHead selection={selection} />}
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
              {selection && <SelectRowCell id={row.original.id as RowId} selection={selection} />}
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="lt:px-4 lt:py-3.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </UITable>

      <ListPagination data={data} onPageChange={onPageChange} />
    </div>
  )
}

interface EmptyStateProps {
  collection: ClientCollection
  canCreate?: boolean
  activeLocale?: string
}

function EmptyState({ collection, canCreate = true, activeLocale }: EmptyStateProps) {
  return (
    <EmptyCard>
      <p className={emptyTextClass}>No {collection.labels.plural.toLowerCase()} found.</p>
      {canCreate && (
        <Button asChild variant="outline">
          <Link
            to="/$collection/create"
            params={{ collection: collection.slug }}
            search={(prev: Record<string, unknown>) =>
              activeLocale ? { ...prev, locale: activeLocale } : prev
            }
          >
            Create the first {collection.labels.singular.toLowerCase()}
          </Link>
        </Button>
      )}
    </EmptyCard>
  )
}

interface ListContentProps {
  isLoading: boolean
  isError?: boolean
  docsCount: number
  hasActiveFilters: boolean
  collection: ClientCollection
  canCreate?: boolean
  activeLocale?: string
  onClearFilters: () => void
  table: Table<Record<string, unknown>>
  data?: PaginatedDocs
  onPageChange: (newPage: number) => void
  selection?: RowSelection
  /** Set when the upload collection is shown as a grid. */
  grid?: { docs: Array<Record<string, unknown>>; onOpen: (doc: Record<string, unknown>) => void }
}

function ListContent({
  isLoading,
  isError,
  docsCount,
  hasActiveFilters,
  collection,
  canCreate = true,
  activeLocale,
  onClearFilters,
  table,
  data,
  onPageChange,
  selection,
  grid,
}: ListContentProps) {
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
    return <EmptyState collection={collection} canCreate={canCreate} activeLocale={activeLocale} />
  }
  if (grid) {
    return (
      <MediaGrid docs={grid.docs} data={data} onOpen={grid.onOpen} onPageChange={onPageChange} />
    )
  }
  return (
    <CollectionTable table={table} data={data} onPageChange={onPageChange} selection={selection} />
  )
}

const SEARCH_DEBOUNCE_MS = 250

function useListSearchNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (patch: ListSearchParams, replace = false) => {
      void navigate({
        search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as never,
        replace,
      })
    },
    [navigate],
  )
}

// The typed text lives here so typing never waits on the router; the URL gets it after a pause.
function useDebouncedSearchInput(urlTerm: string, commit: (term: string) => void) {
  const [input, setInput] = useState(urlTerm)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (timer.current === undefined) setInput(urlTerm)
  }, [urlTerm])
  useEffect(() => () => clearTimeout(timer.current), [])

  const change = (term: string) => {
    setInput(term)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      commit(term)
    }, SEARCH_DEBOUNCE_MS)
  }
  const reset = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    setInput('')
  }
  return { input, change, reset }
}

function useListFilters(
  collection: ClientCollection,
  fieldPermissions?: Record<string, FieldPermission>,
) {
  const rawSearch: unknown = useSearch({ strict: false })
  const params = useMemo(
    () => parseListSearch(rawSearch && typeof rawSearch === 'object' ? { ...rawSearch } : {}),
    [rawSearch],
  )
  const state = useMemo(
    () => resolveListState(params, collection, fieldPermissions),
    [params, collection, fieldPermissions],
  )
  const go = useListSearchNavigate()

  const search = useDebouncedSearchInput(state.searchTerm, (term) =>
    // Typing replaces the history entry, so Back skips the keystrokes.
    go({ q: term.trim() ? term : undefined, page: undefined }, true),
  )

  const setPage = (page: number) => go({ page: page > 1 ? page : undefined })

  const setSorting = (updater: Updater<SortingState>) => {
    const next = typeof updater === 'function' ? updater(state.sorting) : updater
    go({ sort: formatSortParam(next), page: undefined })
  }

  const handleStatusFilterChange = (val: 'all' | ListStatus) =>
    go({ status: val === 'all' ? undefined : val, page: undefined })

  const handleMimeGroupChange = (group: MimeGroup | undefined) =>
    go({ mime: group, page: undefined })

  const handleAddFilter = (filter: ActiveFilter) =>
    go({ filters: toFilterParams([...state.filters, filter]), page: undefined })

  const handleRemoveFilter = (id: string) =>
    go({ filters: toFilterParams(state.filters.filter((f) => f.id !== id)), page: undefined })

  const handleClearAll = () => {
    search.reset()
    go({ q: undefined, status: undefined, mime: undefined, filters: undefined, page: undefined })
  }

  return {
    page: state.page,
    setPage,
    sorting: state.sorting,
    setSorting,
    searchTerm: state.searchTerm,
    searchInput: search.input,
    statusFilter: state.statusFilter,
    mimeGroup: state.mimeGroup,
    handleMimeGroupChange,
    activeFilters: state.filters,
    handleSearchChange: search.change,
    handleStatusFilterChange,
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
      // A row the caller may not touch (or that is already gone) answers 404; drop it from the list.
      void queryClient.invalidateQueries({ queryKey: [slug] })
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

interface ListAlertsProps {
  queryError?: Error | null
  deleteError?: string | null
  actionError?: string | null
  actionSuccess?: string | null
}

function ListAlerts({ queryError, deleteError, actionError, actionSuccess }: ListAlertsProps) {
  if (!queryError && !deleteError && !actionError && !actionSuccess) return null
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
      {actionError && (
        <Alert variant="destructive" className="lt:mb-5" data-testid="action-error-alert">
          {actionError}
        </Alert>
      )}
      {actionSuccess && (
        <Alert
          variant="success"
          role="status"
          className="lt:mb-5"
          data-testid="action-success-alert"
        >
          {actionSuccess}
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
  hasDrafts?: boolean,
  locale?: string,
  fallbackLocale?: string | false,
) {
  return useQuery({
    queryKey: [slug, page, sortParam, where, hasDrafts ? 'draft' : 'published', locale],
    queryFn: () =>
      slug
        ? fetchCollectionDocs(apiBase, slug, {
            page,
            limit: 10,
            sort: sortParam,
            where,
            draft: hasDrafts,
            locale,
            fallbackLocale,
          })
        : null,
    enabled: Boolean(slug),
  })
}

function computeHasActiveFilters(
  searchTerm: string,
  filterCount: number,
  hasDrafts: boolean,
  statusFilter: string,
  mimeGroup?: MimeGroup,
): boolean {
  if (searchTerm.trim().length > 0) return true
  if (filterCount > 0 || mimeGroup) return true
  return hasDrafts && statusFilter !== 'all'
}

function useCollectionPermissionsState(slug: string) {
  const { getCollectionPermission, canCreateInCollection, canDeleteInCollection } = usePermissions()
  return {
    collectionPerm: getCollectionPermission(slug),
    canCreate: canCreateInCollection(slug),
    canDelete: canDeleteInCollection(slug),
  }
}

function renderListHeaderActions(
  hasLocalization: boolean,
  locales: Array<{ code: string; label: string }>,
  activeLocale: string | undefined,
  onLocaleChange: (locale: string) => void,
  canCreate: boolean,
  collection: ClientCollection,
  columnPreference: ColumnPreference,
) {
  return (
    <div className="lt:flex lt:flex-wrap lt:items-center lt:gap-3">
      <ColumnPicker collection={collection} preference={columnPreference} />
      {hasLocalization && activeLocale && (
        <LocaleSwitcher
          locales={locales}
          activeLocale={activeLocale}
          onLocaleChange={onLocaleChange}
        />
      )}
      {canCreate && (
        <Button asChild>
          <Link
            to="/$collection/create"
            params={{ collection: collection.slug }}
            search={(prev: Record<string, unknown>) =>
              activeLocale ? { ...prev, locale: activeLocale } : prev
            }
          >
            Create {collection.labels.singular}
          </Link>
        </Button>
      )}
    </div>
  )
}

function useListColumns(
  collection: ClientCollection,
  columnKeys: string[],
  handleDelete: (id: number | string) => void,
  isDeleting: boolean,
  canDelete: boolean,
  activeLocale: string | undefined,
  onExecuteAction?: (action: ClientAction, rowDoc: Record<string, unknown>) => void,
  isAllowedAction?: (actionKey: string) => boolean,
) {
  return useMemo(
    () =>
      buildColumns(
        collection,
        columnKeys,
        handleDelete,
        isDeleting,
        canDelete,
        activeLocale,
        onExecuteAction,
        isAllowedAction,
      ),
    [
      collection,
      columnKeys,
      handleDelete,
      isDeleting,
      canDelete,
      activeLocale,
      onExecuteAction,
      isAllowedAction,
    ],
  )
}

interface ListWhereState {
  searchTerm: string
  activeFilters: ActiveFilter[]
  statusFilter: 'all' | ListStatus
  mimeGroup: MimeGroup | undefined
}

function useListWhere(
  collection: ClientCollection,
  fieldPermissions: Record<string, FieldPermission> | undefined,
  state: ListWhereState,
) {
  const { searchTerm, activeFilters, statusFilter, mimeGroup } = state
  const searchField = useMemo(
    () => resolveSearchField(collection, fieldPermissions),
    [collection, fieldPermissions],
  )
  return useMemo(
    () => buildWhereQuery(searchTerm, searchField, activeFilters, statusFilter, mimeGroup),
    [searchTerm, searchField, activeFilters, statusFilter, mimeGroup],
  )
}

function useMediaLibrary(
  collection: ClientCollection,
  docs: Array<Record<string, unknown>>,
  onDelete: (id: number | string) => void,
  canDelete: boolean,
  activeLocale: string | undefined,
) {
  const enabled = Boolean(collection.upload)
  const { mode, setMode } = useViewMode(collection.slug, enabled)
  const [opened, setOpened] = useState<Record<string, unknown> | null>(null)
  const grid = mode === 'grid' ? { docs, onOpen: setOpened } : undefined
  const dialog = grid ? (
    <MediaDetailDialog
      doc={opened}
      collectionSlug={collection.slug}
      activeLocale={activeLocale}
      canDelete={canDelete}
      onDelete={onDelete}
      onClose={() => setOpened(null)}
    />
  ) : null
  return { enabled, mode: mode satisfies ListViewMode, setMode, grid, dialog }
}

interface CollectionListTableProps {
  collection: ClientCollection
}

function CollectionListTable({ collection }: CollectionListTableProps) {
  const { apiBase } = useAdmin()
  const navigate = useNavigate()
  const { hasLocalization, activeLocale, fallbackLocale, locales } = useLocale()
  const { collectionPerm, canCreate, canDelete } = useCollectionPermissionsState(collection.slug)

  const fieldPermissions = collectionPerm?.fields

  const {
    page,
    setPage,
    sorting,
    setSorting,
    searchTerm,
    searchInput,
    statusFilter,
    mimeGroup,
    handleMimeGroupChange,
    activeFilters,
    handleSearchChange,
    handleStatusFilterChange,
    handleAddFilter,
    handleRemoveFilter,
    handleClearAll,
  } = useListFilters(collection, fieldPermissions)

  const handleLocaleChange = (newLocale: string) => {
    void navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, locale: newLocale })) as never,
    })
  }

  const {
    deleteError,
    setDeleteError,
    handleDelete,
    isDeleting,
    confirmOpen,
    closeConfirm,
    confirmDelete,
  } = useListDeleteMutation(apiBase, collection.slug)

  useEffect(() => {
    setDeleteError(null)
  }, [collection.slug, page, setDeleteError])

  const hasDrafts = Boolean(collection.versions?.drafts)

  const where = useListWhere(collection, fieldPermissions, {
    searchTerm,
    activeFilters,
    statusFilter,
    mimeGroup,
  })

  const listLocale = hasLocalization ? activeLocale : undefined
  const sortParam = useMemo(() => formatSortParam(sorting), [sorting])
  const { data, isLoading, error } = useCollectionDocsQuery(
    apiBase,
    collection.slug,
    page,
    sortParam,
    where,
    hasDrafts,
    listLocale,
    fallbackLocale,
  )

  const declarativeAction = useDeclarativeAction({
    apiBase,
    scopeType: 'collection',
    slug: collection.slug,
    locale: listLocale,
  })

  const handleExecuteAction = useCallback(
    (action: ClientAction, rowDoc: Record<string, unknown>) => {
      declarativeAction.triggerAction(action, { id: rowDoc.id as never, doc: rowDoc })
    },
    [declarativeAction],
  )

  const handleExecuteBulkAction = useCallback(
    (action: ClientAction, ids: RowId[], clearSelection: () => void) => {
      declarativeAction.triggerAction(action, {
        ids,
        onSuccess: clearSelection,
      })
    },
    [declarativeAction],
  )

  const isAllowedAction = useCallback(
    (actionKey: string) => collectionPerm?.actions?.[actionKey] !== false,
    [collectionPerm],
  )

  const columnPreference = useColumnPreference(collection, collectionPerm)
  const columns = useListColumns(
    collection,
    columnPreference.keys,
    handleDelete,
    isDeleting,
    canDelete,
    activeLocale,
    handleExecuteAction,
    isAllowedAction,
  )

  const docs = useMemo(() => data?.docs ?? [], [data?.docs])

  const table = useReactTable({
    data: docs,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const hasActiveFilters = computeHasActiveFilters(
    searchTerm,
    activeFilters.length,
    hasDrafts,
    statusFilter,
    mimeGroup,
  )

  const media = useMediaLibrary(collection, docs, handleDelete, canDelete, activeLocale)

  const { selection, controls: bulkControls } = useListBulk({
    apiBase,
    collection,
    docs,
    resetKey: JSON.stringify([
      page,
      searchTerm,
      statusFilter,
      mimeGroup,
      sorting,
      activeFilters,
      activeLocale,
    ]),
    locale: listLocale,
    permission: collectionPerm,
    canDelete,
    isActionPending: declarativeAction.isPending,
    onExecuteAction: handleExecuteBulkAction,
  })

  return (
    <div>
      <ViewHeader
        title={collection.labels.plural}
        actions={renderListHeaderActions(
          hasLocalization,
          locales,
          activeLocale,
          handleLocaleChange,
          canCreate,
          collection,
          columnPreference,
        )}
      >
        <Badge variant="secondary" className="lt:mt-1.5">
          {data?.totalDocs ?? 0} items
        </Badge>
      </ViewHeader>

      <CollectionFilterBar
        collection={collection}
        searchTerm={searchInput}
        onSearchChange={handleSearchChange}
        activeFilters={activeFilters}
        onAddFilter={handleAddFilter}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={handleClearAll}
        hasDrafts={hasDrafts}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        fieldPermissions={fieldPermissions}
      />

      {media.enabled && (
        <MediaControls
          mimeGroup={mimeGroup}
          onMimeGroupChange={handleMimeGroupChange}
          viewMode={media.mode}
          onViewModeChange={media.setMode}
        />
      )}

      <ListAlerts
        queryError={error}
        deleteError={deleteError}
        actionError={declarativeAction.actionError}
        actionSuccess={declarativeAction.actionSuccess}
      />

      {bulkControls}

      {declarativeAction.dialogs}

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
        canCreate={canCreate}
        activeLocale={activeLocale}
        onClearFilters={handleClearAll}
        table={table}
        data={data ?? undefined}
        onPageChange={setPage}
        selection={selection}
        grid={media.grid}
      />
      {media.dialog}
    </div>
  )
}

export function CollectionListView() {
  const { collection: slug } = useParams({ strict: false })
  const collection = useCollection(slug)
  const { canReadCollection } = usePermissions()

  if (!collection || !canReadCollection(collection.slug)) {
    return <NotFoundView />
  }

  return <CollectionListTable collection={collection} />
}
