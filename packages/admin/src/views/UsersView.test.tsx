import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import { AdminContext } from '../context/AdminContext'
import { AuthContext, type AuthContextValue } from '../context/AuthContext'
import { chooseDropdownMenuItem } from '../test/radix'
import { UsersView } from './UsersView'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    fetchUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    disableUser: vi.fn(),
    enableUser: vi.fn(),
    revokeUserSessions: vi.fn(),
    adminSetUserPassword: vi.fn(),
    deleteUser: vi.fn(),
    resendUserInvite: vi.fn(),
  }
})

describe('UsersView (#343)', () => {
  let queryClient: QueryClient

  const mockUsers: client.UserDoc[] = [
    {
      id: 'u1',
      name: 'Admin Handi',
      email: 'admin@example.com',
      role: 'admin',
      banned: false,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 'u2',
      name: 'Editor Bob',
      email: 'bob@example.com',
      role: 'editor',
      banned: true,
      banReason: 'Test suspension',
      createdAt: '2026-11-02T00:00:00.000Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    vi.mocked(client.fetchUsers).mockResolvedValue({
      docs: mockUsers,
      totalDocs: 2,
      limit: 10,
      page: 1,
      totalPages: 1,
      pagingCounter: 1,
      hasNextPage: false,
      hasPrevPage: false,
      prevPage: null,
      nextPage: null,
    })
  })

  afterEach(cleanup)

  function renderWithProviders(currentUserRole = 'admin', emailEnabled = false) {
    const adminConfig: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      auth: {
        roles: ['admin', 'editor', 'author'],
        defaultRole: 'editor',
        adminRole: 'admin',
        emailEnabled,
      },
      collections: [],
      globals: [],
    }

    const authValue: AuthContextValue = {
      user: {
        id: 'u1',
        email: 'admin@example.com',
        name: 'Admin Handi',
        role: currentUserRole,
      },
      session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 86400000) },
      isLoading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    }

    return render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <QueryClientProvider client={queryClient}>
            <AdminContext.Provider
              value={{
                config: adminConfig,
                apiBase: '/api',
                basePath: '/admin',
              }}
            >
              <AuthContext.Provider value={authValue}>
                <UsersView />
              </AuthContext.Provider>
            </AdminContext.Provider>
          </QueryClientProvider>
        </PortalContainerProvider>
      </div>,
    )
  }

  it('displays access denied for non-admin users', async () => {
    renderWithProviders('editor')

    expect(await screen.findByText(/Access denied/i)).toBeTruthy()
    expect(client.fetchUsers).not.toHaveBeenCalled()
  })

  it('renders users table and search input for admin users', async () => {
    renderWithProviders('admin')

    expect(await screen.findByText('Admin Handi')).toBeTruthy()
    expect(screen.getByText('admin@example.com')).toBeTruthy()
    expect(screen.getByText('Editor Bob')).toBeTruthy()
    expect(screen.getByText('bob@example.com')).toBeTruthy()

    // Status badges
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Suspended')).toBeTruthy()

    expect(client.fetchUsers).toHaveBeenCalledWith(
      '/api',
      expect.objectContaining({ page: 1, limit: 10 }),
    )
  })

  it('filters users by search query', async () => {
    renderWithProviders('admin')

    const searchInput = await screen.findByPlaceholderText(/Search by name or email/i)
    fireEvent.change(searchInput, { target: { value: 'Bob' } })

    await waitFor(() => {
      expect(client.fetchUsers).toHaveBeenCalledWith(
        '/api',
        expect.objectContaining({ search: 'Bob' }),
      )
    })
  })

  it('opens create user dialog and creates a user successfully', async () => {
    vi.mocked(client.createUser).mockResolvedValue({
      id: 'u3',
      name: 'Charlie New',
      email: 'charlie@example.com',
      role: 'editor',
      banned: false,
    })

    renderWithProviders('admin')

    const newUserButton = await screen.findByRole('button', { name: /New user/i })
    fireEvent.click(newUserButton)

    expect(await screen.findByText('Create new user')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Charlie New' } })
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'charlie@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'password123' },
    })

    const submitBtn = screen.getByRole('button', { name: /^Create user$/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(client.createUser).toHaveBeenCalledWith('/api', {
        name: 'Charlie New',
        email: 'charlie@example.com',
        password: 'password123',
        role: 'editor',
      })
    })

    expect(await screen.findByText(/User created successfully/i)).toBeTruthy()
  })

  it('shows validation error when password is too short in create user dialog', async () => {
    renderWithProviders('admin')

    const newUserButton = await screen.findByRole('button', { name: /New user/i })
    fireEvent.click(newUserButton)

    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Shorty' } })
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'shorty@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'short' } })

    const submitBtn = screen.getByRole('button', { name: /^Create user$/i })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/Password must be at least 8 characters long/i)).toBeTruthy()
    expect(client.createUser).not.toHaveBeenCalled()
  })

  it('shows error banner when action fails with API error message', async () => {
    vi.mocked(client.enableUser).mockRejectedValue(new Error('Cannot perform this operation'))

    renderWithProviders('admin')

    expect(await screen.findByText('Editor Bob')).toBeTruthy()

    const actionButton = screen.getByRole('button', { name: /Actions for Editor Bob/i })
    chooseDropdownMenuItem(actionButton, /Reactivate account/i)

    await waitFor(() => {
      expect(screen.getByText('Cannot perform this operation')).toBeTruthy()
    })
  })

  it('supports sending invitation email when emailEnabled is true', async () => {
    vi.mocked(client.createUser).mockResolvedValue({
      id: 'u4',
      name: 'Dave Invited',
      email: 'dave@example.com',
      role: 'editor',
      banned: false,
    })

    renderWithProviders('admin', true)

    const newUserButton = await screen.findByRole('button', { name: /New user/i })
    fireEvent.click(newUserButton)

    expect(await screen.findByText('Create new user')).toBeTruthy()
    expect(screen.getByText(/Send invitation email/i)).toBeTruthy()

    // Check the invite checkbox
    const inviteCheckbox = screen.getByRole('checkbox')
    fireEvent.click(inviteCheckbox)
    expect(screen.queryByLabelText(/^Password$/i)).toBeNull()

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Dave Invited' } })
    fireEvent.change(screen.getByLabelText(/^Email$/i), {
      target: { value: 'dave@example.com' },
    })

    const submitBtn = screen.getByRole('button', { name: /Send invitation/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(client.createUser).toHaveBeenCalledWith('/api', {
        name: 'Dave Invited',
        email: 'dave@example.com',
        role: 'editor',
        invite: true,
        password: undefined,
      })
    })

    expect(await screen.findByText(/User created successfully/i)).toBeTruthy()
  })

  it('allows resending invitation when emailEnabled is true', async () => {
    vi.mocked(client.resendUserInvite).mockResolvedValue({
      success: true,
      message: 'Invitation sent',
    })

    renderWithProviders('admin', true)

    expect(await screen.findByText('Editor Bob')).toBeTruthy()

    const actionButton = screen.getByRole('button', { name: /Actions for Editor Bob/i })
    chooseDropdownMenuItem(actionButton, /Resend invitation/i)

    await waitFor(() => {
      expect(client.resendUserInvite).toHaveBeenCalledWith('/api', 'u2')
    })
    expect(await screen.findByText(/Invitation email resent to bob@example.com/i)).toBeTruthy()
  })
})
