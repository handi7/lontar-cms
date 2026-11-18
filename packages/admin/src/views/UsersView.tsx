import { useState, useMemo, useCallback } from 'react'
import type { ClientConfig } from '@lontar/core/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, Plus, Search } from 'lucide-react'
import {
  deleteUser,
  enableUser,
  fetchUsers,
  formatApiErrorMessage,
  resendUserInvite,
  revokeUserSessions,
  type PaginatedUsers,
  type UserDoc,
} from '../api/client'
import { queryKeys } from '../api/query-keys'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import {
  CreateUserDialog,
  DisableUserDialog,
  EditUserDialog,
  ResetPasswordDialog,
} from './UserDialogs'
import { ViewHeader, ViewSubtitle } from './ViewHeader'

const rowActionClass = 'lt:h-7 lt:px-2 lt:text-[0.8125rem] lt:text-muted-foreground'
const headClass =
  'lt:h-auto lt:px-4 lt:py-3 lt:text-xs lt:font-semibold lt:tracking-wider lt:text-muted-foreground lt:uppercase'

export interface UserActionsMenuProps {
  user: UserDoc
  isCurrent: boolean
  emailEnabled?: boolean
  onEdit: () => void
  onResetPassword: () => void
  onResendInvite?: () => void
  onRevokeSessions: () => void
  onToggleSuspend: () => void
  onDelete: () => void
}

function UserActionsMenu(props: UserActionsMenuProps) {
  const {
    user: u,
    isCurrent,
    emailEnabled,
    onEdit,
    onResetPassword,
    onResendInvite,
    onRevokeSessions,
    onToggleSuspend,
    onDelete,
  } = props

  return (
    <div className="lt:flex lt:justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={rowActionClass}
            aria-label={`Actions for ${u.name}`}
          >
            <MoreHorizontal className="lt:size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>Edit user</DropdownMenuItem>
          <DropdownMenuItem onClick={onResetPassword}>Reset password</DropdownMenuItem>
          {emailEnabled && onResendInvite && (
            <DropdownMenuItem onClick={onResendInvite}>Resend invitation</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onRevokeSessions}>Revoke sessions</DropdownMenuItem>
          {u.banned ? (
            <DropdownMenuItem onClick={onToggleSuspend}>Reactivate account</DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={onToggleSuspend}
              disabled={isCurrent}
              className={isCurrent ? 'lt:opacity-50' : 'lt:text-destructive'}
            >
              Suspend account
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            disabled={isCurrent}
            className={isCurrent ? 'lt:opacity-50' : 'lt:text-destructive'}
          >
            Delete user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function renderUserCell(u: UserDoc) {
  const initial = (u.name?.[0] || u.email?.[0] || 'U').toUpperCase()
  return (
    <div className="lt:flex lt:items-center lt:gap-3">
      <div className="lt:flex lt:size-8 lt:shrink-0 lt:items-center lt:justify-center lt:rounded-full lt:bg-muted lt:text-xs lt:font-semibold lt:text-muted-foreground">
        {initial}
      </div>
      <div className="lt:flex lt:flex-col">
        <span className="lt:font-semibold lt:text-foreground">{u.name}</span>
        <span className="lt:text-xs lt:text-muted-foreground">{u.email}</span>
      </div>
    </div>
  )
}

function renderRoleCell(role: string, adminRole: string) {
  return <Badge variant={role === adminRole ? 'default' : 'secondary'}>{role}</Badge>
}

function renderStatusCell(banned: boolean | null | undefined) {
  return banned ? (
    <Badge variant="destructive">Suspended</Badge>
  ) : (
    <Badge variant="success">Active</Badge>
  )
}

function renderCreatedCell(raw: string | number | Date | null | undefined) {
  if (!raw) return '—'
  return new Date(raw).toLocaleDateString()
}

export interface UseUsersColumnsOptions {
  adminRole: string
  currentUserId?: string
  emailEnabled?: boolean
  onEdit: (user: UserDoc) => void
  onResetPassword: (user: UserDoc) => void
  onResendInvite: (user: UserDoc) => void
  onRevokeSessions: (user: UserDoc) => void
  onToggleSuspend: (user: UserDoc) => void
  onDelete: (user: UserDoc) => void
}

function useUsersColumns(options: UseUsersColumnsOptions): ColumnDef<UserDoc>[] {
  const {
    adminRole,
    currentUserId,
    emailEnabled,
    onEdit,
    onResetPassword,
    onResendInvite,
    onRevokeSessions,
    onToggleSuspend,
    onDelete,
  } = options

  return useMemo<ColumnDef<UserDoc>[]>(
    () => [
      {
        id: 'name',
        header: 'User',
        cell: ({ row }) => renderUserCell(row.original),
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => renderRoleCell(row.original.role, adminRole),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => renderStatusCell(row.original.banned),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => renderCreatedCell(row.original.createdAt),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <UserActionsMenu
            user={row.original}
            isCurrent={row.original.id === currentUserId}
            emailEnabled={emailEnabled}
            onEdit={() => onEdit(row.original)}
            onResetPassword={() => onResetPassword(row.original)}
            onResendInvite={() => onResendInvite(row.original)}
            onRevokeSessions={() => onRevokeSessions(row.original)}
            onToggleSuspend={() => onToggleSuspend(row.original)}
            onDelete={() => onDelete(row.original)}
          />
        ),
      },
    ],
    [
      adminRole,
      currentUserId,
      emailEnabled,
      onEdit,
      onResetPassword,
      onResendInvite,
      onRevokeSessions,
      onToggleSuspend,
      onDelete,
    ],
  )
}

export interface UsersFilterBarProps {
  search: string
  onSearchChange: (search: string) => void
  roleFilter: string
  onRoleFilterChange: (role: string) => void
  roles: string[]
}

function UsersFilterBar(props: UsersFilterBarProps) {
  const { search, onSearchChange, roleFilter, onRoleFilterChange, roles } = props
  return (
    <div className="lt:mb-5 lt:flex lt:flex-wrap lt:items-center lt:gap-3">
      <div className="lt:relative lt:min-w-[240px] lt:flex-1">
        <Search className="lt:absolute lt:top-1/2 lt:left-3 lt:size-4 lt:-translate-y-1/2 lt:text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name or email..."
          className="lt:pl-9"
        />
      </div>

      <div className="lt:w-44">
        <Select value={roleFilter} onValueChange={onRoleFilterChange}>
          <SelectTrigger aria-label="Filter role">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export interface UsersTableProps {
  table: ReturnType<typeof useReactTable<UserDoc>>
  isLoading: boolean
  columnsCount: number
}

function UsersTable(props: UsersTableProps) {
  const { table, isLoading, columnsCount } = props
  return (
    <div className="lt:rounded-md lt:border lt:border-border lt:bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className={headClass}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell
                colSpan={columnsCount}
                className="lt:py-8 lt:text-center lt:text-muted-foreground"
              >
                Loading users...
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnsCount}
                className="lt:py-8 lt:text-center lt:text-muted-foreground"
              >
                No users found.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="lt:px-4 lt:py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export interface UsersPaginationProps {
  data?: PaginatedUsers
  onPrev: () => void
  onNext: () => void
}

function UsersPagination(props: UsersPaginationProps) {
  const { data, onPrev, onNext } = props
  if (!data || data.totalPages <= 1) return null
  return (
    <div className="lt:mt-4 lt:flex lt:items-center lt:justify-between lt:text-sm lt:text-muted-foreground">
      <span>
        Showing page {data.page} of {data.totalPages} ({data.totalDocs} total users)
      </span>
      <div className="lt:flex lt:items-center lt:gap-2">
        <Button variant="outline" size="sm" onClick={onPrev} disabled={!data.hasPrevPage}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!data.hasNextPage}>
          Next
        </Button>
      </div>
    </div>
  )
}

export interface UsersNotificationsProps {
  error: string | null
  success: string | null
}

function UsersNotifications(props: UsersNotificationsProps) {
  const { error, success } = props
  if (error) {
    return (
      <Alert variant="destructive" className="lt:mb-4">
        {error}
      </Alert>
    )
  }
  if (success) {
    return (
      <Alert className="lt:mb-4 lt:border-success-border lt:bg-success-bg lt:text-success-text">
        {success}
      </Alert>
    )
  }
  return null
}

export interface UsersModalsProps {
  apiBase: string
  roles: string[]
  defaultRole: string
  emailEnabled?: boolean
  currentUserId?: string
  isCreateOpen: boolean
  onCloseCreate: () => void
  editingUser: UserDoc | null
  onCloseEdit: () => void
  resettingUser: UserDoc | null
  onCloseReset: () => void
  disablingUser: UserDoc | null
  onCloseDisable: () => void
  deletingUser: UserDoc | null
  onCloseDelete: () => void
  onConfirmDelete: () => void
  onSuccess: (message: string, shouldRefresh?: boolean) => void
}

function UsersModals(props: UsersModalsProps) {
  const {
    apiBase,
    roles,
    defaultRole,
    emailEnabled,
    currentUserId,
    isCreateOpen,
    onCloseCreate,
    editingUser,
    onCloseEdit,
    resettingUser,
    onCloseReset,
    disablingUser,
    onCloseDisable,
    deletingUser,
    onCloseDelete,
    onConfirmDelete,
    onSuccess,
  } = props

  return (
    <>
      <CreateUserDialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open) onCloseCreate()
        }}
        roles={roles}
        defaultRole={defaultRole}
        apiBase={apiBase}
        emailEnabled={emailEnabled}
        onSuccess={() => onSuccess('User created successfully.', true)}
      />

      <EditUserDialog
        user={editingUser}
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open) onCloseEdit()
        }}
        roles={roles}
        isCurrentUser={editingUser !== null && editingUser.id === currentUserId}
        apiBase={apiBase}
        onSuccess={() => onSuccess('User updated successfully.', true)}
      />

      <ResetPasswordDialog
        user={resettingUser}
        open={resettingUser !== null}
        onOpenChange={(open) => {
          if (!open) onCloseReset()
        }}
        apiBase={apiBase}
        onSuccess={() => onSuccess('Password reset successfully.', false)}
      />

      <DisableUserDialog
        user={disablingUser}
        open={disablingUser !== null}
        onOpenChange={(open) => {
          if (!open) onCloseDisable()
        }}
        apiBase={apiBase}
        onSuccess={() => onSuccess('User account has been suspended.', true)}
      />

      <ConfirmDeleteDialog
        open={deletingUser !== null}
        onOpenChange={(open) => {
          if (!open) onCloseDelete()
        }}
        title="Delete user"
        description={`Are you sure you want to permanently delete user "${deletingUser?.email ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete user"
        onConfirm={onConfirmDelete}
      />
    </>
  )
}

function getAuthConfig(configAuth: ClientConfig['auth']) {
  return {
    adminRole: configAuth?.adminRole ?? 'admin',
    roles: configAuth?.roles ?? ['admin', 'editor'],
    defaultRole: configAuth?.defaultRole ?? 'editor',
    emailEnabled: Boolean(configAuth?.emailEnabled),
  }
}

function useQueryKeys(apiBase: string, page: number, search: string, roleFilter: string) {
  return useMemo(
    () =>
      queryKeys.users(
        apiBase,
        page,
        search.trim() || undefined,
        roleFilter === 'all' ? undefined : roleFilter,
      ),
    [apiBase, page, search, roleFilter],
  )
}

export function UsersView() {
  const { config, apiBase } = useAdmin()
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()

  const { adminRole, roles, defaultRole, emailEnabled } = getAuthConfig(config.auth)
  const isAdmin = currentUser?.role === adminRole

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const [pageError, setPageError] = useState<string | null>(null)
  const [pageSuccess, setPageSuccess] = useState<string | null>(null)

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserDoc | null>(null)
  const [resettingUser, setResettingUser] = useState<UserDoc | null>(null)
  const [disablingUser, setDisablingUser] = useState<UserDoc | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserDoc | null>(null)

  const usersQueryKey = useQueryKeys(apiBase, page, search, roleFilter)

  const { data, isLoading } = useQuery({
    queryKey: usersQueryKey,
    queryFn: () =>
      fetchUsers(apiBase, {
        page,
        limit: 10,
        search: search.trim() || undefined,
        role: roleFilter === 'all' ? undefined : roleFilter,
      }),
    enabled: isAdmin,
  })

  const refreshUsers = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['_lontar_users', apiBase] })
  }, [queryClient, apiBase])

  const handleEnableUser = async (targetUser: UserDoc) => {
    setPageError(null)
    try {
      await enableUser(apiBase, targetUser.id)
      setPageSuccess(`User ${targetUser.email} has been reactivated.`)
      refreshUsers()
    } catch (err) {
      setPageError(formatApiErrorMessage(err))
    }
  }

  const handleRevokeSessions = async (targetUser: UserDoc) => {
    setPageError(null)
    try {
      await revokeUserSessions(apiBase, targetUser.id)
      setPageSuccess(`All active sessions for ${targetUser.email} have been revoked.`)
    } catch (err) {
      setPageError(formatApiErrorMessage(err))
    }
  }

  const handleResendInvite = async (targetUser: UserDoc) => {
    setPageError(null)
    try {
      await resendUserInvite(apiBase, targetUser.id)
      setPageSuccess(`Invitation email resent to ${targetUser.email}.`)
    } catch (err) {
      setPageError(formatApiErrorMessage(err))
    }
  }

  const handleDeleteUser = async () => {
    if (!deletingUser) return
    setPageError(null)
    try {
      await deleteUser(apiBase, deletingUser.id)
      setPageSuccess(`User ${deletingUser.email} was successfully deleted.`)
      setDeletingUser(null)
      refreshUsers()
    } catch (err) {
      setPageError(formatApiErrorMessage(err))
    }
  }

  const handleToggleSuspend = (targetUser: UserDoc) => {
    if (targetUser.banned) {
      void handleEnableUser(targetUser)
    } else {
      setDisablingUser(targetUser)
    }
  }

  const handleModalSuccess = (message: string, shouldRefresh = false) => {
    setPageSuccess(message)
    if (shouldRefresh) {
      refreshUsers()
    }
  }

  const columns = useUsersColumns({
    adminRole,
    currentUserId: currentUser?.id,
    emailEnabled,
    onEdit: (u) => setEditingUser(u),
    onResetPassword: (u) => setResettingUser(u),
    onResendInvite: (u) => void handleResendInvite(u),
    onRevokeSessions: (u) => void handleRevokeSessions(u),
    onToggleSuspend: handleToggleSuspend,
    onDelete: (u) => setDeletingUser(u),
  })

  const table = useReactTable({
    data: data?.docs ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (!isAdmin) {
    return (
      <div>
        <ViewHeader title="Users" />
        <Alert variant="destructive">
          Access denied. You do not have permission to view or manage users.
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <ViewHeader
        title="Users"
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="lt:gap-1.5">
            <Plus className="lt:size-4" />
            New user
          </Button>
        }
      >
        <ViewSubtitle>Manage team members, roles, and administrative access.</ViewSubtitle>
      </ViewHeader>

      <UsersNotifications error={pageError} success={pageSuccess} />

      <UsersFilterBar
        search={search}
        onSearchChange={(val) => {
          setSearch(val)
          setPage(1)
        }}
        roleFilter={roleFilter}
        onRoleFilterChange={(val) => {
          setRoleFilter(val)
          setPage(1)
        }}
        roles={roles}
      />

      <UsersTable table={table} isLoading={isLoading} columnsCount={columns.length} />

      <UsersPagination
        data={data}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />

      <UsersModals
        apiBase={apiBase}
        roles={roles}
        defaultRole={defaultRole}
        emailEnabled={emailEnabled}
        currentUserId={currentUser?.id}
        isCreateOpen={isCreateOpen}
        onCloseCreate={() => setIsCreateOpen(false)}
        editingUser={editingUser}
        onCloseEdit={() => setEditingUser(null)}
        resettingUser={resettingUser}
        onCloseReset={() => setResettingUser(null)}
        disablingUser={disablingUser}
        onCloseDisable={() => setDisablingUser(null)}
        deletingUser={deletingUser}
        onCloseDelete={() => setDeletingUser(null)}
        onConfirmDelete={() => void handleDeleteUser()}
        onSuccess={handleModalSuccess}
      />
    </div>
  )
}
