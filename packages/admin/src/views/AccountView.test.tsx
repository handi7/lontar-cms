import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { PortalContainerProvider } from '../context/PortalContainer'
import { AdminContext } from '../context/AdminContext'
import { AuthContext, type AuthContextValue } from '../context/AuthContext'
import { AccountView } from './AccountView'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    updateMe: vi.fn(),
    changeMyPassword: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  }
})

describe('AccountView (#343)', () => {
  let queryClient: QueryClient
  const mockSignOut = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.listApiKeys).mockResolvedValue([])
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(cleanup)

  function renderWithProviders(userOverrides?: Partial<client.AdminUser>) {
    const adminConfig: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
        emailEnabled: false,
      },
      collections: [],
      globals: [],
    }

    const authValue: AuthContextValue = {
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: 'Handi User',
        role: 'editor',
        ...userOverrides,
      },
      session: { id: 'sess-12345678', userId: 'u1', expiresAt: new Date(Date.now() + 86400000) },
      isLoading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
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
                <AccountView />
              </AuthContext.Provider>
            </AdminContext.Provider>
          </QueryClientProvider>
        </PortalContainerProvider>
      </div>,
    )
  }

  it('renders user information, email, role, and current name', async () => {
    renderWithProviders()

    expect(await screen.findByDisplayValue('Handi User')).toBeTruthy()
    expect(screen.getByDisplayValue('user@example.com')).toBeTruthy()
    expect(screen.getByText('editor')).toBeTruthy()
  })

  it('updates profile display name successfully', async () => {
    vi.mocked(client.updateMe).mockResolvedValue({
      id: 'u1',
      name: 'Handi Updated',
      email: 'user@example.com',
      role: 'editor',
      banned: false,
    })

    renderWithProviders()

    const nameInput = screen.getByLabelText(/Display name/i)
    fireEvent.change(nameInput, { target: { value: 'Handi Updated' } })

    const saveBtn = screen.getByRole('button', { name: /Save profile/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(client.updateMe).toHaveBeenCalledWith('/api', { name: 'Handi Updated' })
    })

    expect(await screen.findByText(/Profile name updated successfully/i)).toBeTruthy()
  })

  it('validates new password length on change password (#378)', async () => {
    renderWithProviders()

    fireEvent.change(screen.getByLabelText(/^Current password$/i), {
      target: { value: 'current123' },
    })
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'a'.repeat(129) },
    })
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: 'a'.repeat(129) },
    })

    const updatePasswordBtn = screen.getByRole('button', { name: /Update password/i })
    fireEvent.click(updatePasswordBtn)

    expect(await screen.findByText(/New password cannot exceed 128 characters/i)).toBeTruthy()
    expect(client.changeMyPassword).not.toHaveBeenCalled()
  })

  it('validates password mismatch on change password', async () => {
    renderWithProviders()

    fireEvent.change(screen.getByLabelText(/^Current password$/i), {
      target: { value: 'current123' },
    })
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'newpassword1' },
    })
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: 'newpassword2' },
    })

    const updatePasswordBtn = screen.getByRole('button', { name: /Update password/i })
    fireEvent.click(updatePasswordBtn)

    expect(await screen.findByText(/New passwords do not match/i)).toBeTruthy()
    expect(client.changeMyPassword).not.toHaveBeenCalled()
  })

  it('changes password successfully when inputs are valid', async () => {
    vi.mocked(client.changeMyPassword).mockResolvedValue({
      message: 'Password changed successfully',
    })

    renderWithProviders()

    fireEvent.change(screen.getByLabelText(/^Current password$/i), {
      target: { value: 'currentpassword' },
    })
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'validnewpass123' },
    })
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: 'validnewpass123' },
    })

    const updatePasswordBtn = screen.getByRole('button', { name: /Update password/i })
    fireEvent.click(updatePasswordBtn)

    await waitFor(() => {
      expect(client.changeMyPassword).toHaveBeenCalledWith('/api', {
        currentPassword: 'currentpassword',
        newPassword: 'validnewpass123',
      })
    })

    expect(await screen.findByText(/Password changed successfully/i)).toBeTruthy()
  })

  it('shows error when server rejects password change', async () => {
    vi.mocked(client.changeMyPassword).mockRejectedValue(new Error('Current password is incorrect'))

    renderWithProviders()

    fireEvent.change(screen.getByLabelText(/^Current password$/i), {
      target: { value: 'wrongpassword' },
    })
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'validnewpass123' },
    })
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: 'validnewpass123' },
    })

    const updatePasswordBtn = screen.getByRole('button', { name: /Update password/i })
    fireEvent.click(updatePasswordBtn)

    expect(await screen.findByText('Current password is incorrect')).toBeTruthy()
  })

  it('invokes signOut when sign out button is clicked', () => {
    renderWithProviders()

    const signOutBtn = screen.getByRole('button', { name: /Sign out/i })
    fireEvent.click(signOutBtn)

    expect(mockSignOut).toHaveBeenCalled()
  })

  it('renders API keys list and allows creating a new key', async () => {
    vi.mocked(client.listApiKeys).mockResolvedValue([
      {
        id: 'k1',
        name: 'Deployment Key',
        start: 'lt_dep123...',
        userId: 'u1',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        lastUsedAt: null,
      },
    ])

    vi.mocked(client.createApiKey).mockResolvedValue({
      id: 'k2',
      name: 'Backup Script',
      start: 'lt_bak456...',
      key: 'lt_bak45678901234567890',
      userId: 'u1',
      createdAt: '2026-01-02T00:00:00.000Z',
      expiresAt: null,
      lastUsedAt: null,
    })

    renderWithProviders()

    expect(await screen.findByText('Deployment Key')).toBeTruthy()
    expect(screen.getByText('lt_dep123...')).toBeTruthy()

    // Open create key dialog
    const createBtn = screen.getByRole('button', { name: /Create API key/i })
    fireEvent.click(createBtn)

    expect(await screen.findByLabelText(/^Name$/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Name$/i), {
      target: { value: 'Backup Script' },
    })

    const submitBtn = screen.getByRole('button', { name: /^Create key$/i })
    fireEvent.click(submitBtn)

    expect(await screen.findByText('API Key Created')).toBeTruthy()
    expect(screen.getByDisplayValue('lt_bak45678901234567890')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Copy$/i })).toBeTruthy()

    const doneBtn = screen.getByRole('button', { name: /^Done$/i })
    fireEvent.click(doneBtn)

    await waitFor(() => {
      expect(screen.queryByText('API Key Created')).toBeNull()
    })
  })

  it('allows revoking an existing API key', async () => {
    vi.mocked(client.listApiKeys).mockResolvedValue([
      {
        id: 'k1',
        name: 'Key To Revoke',
        start: 'lt_rev123...',
        userId: 'u1',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        lastUsedAt: null,
      },
    ])
    vi.mocked(client.revokeApiKey).mockResolvedValue({ success: true })

    renderWithProviders()

    expect(await screen.findByText('Key To Revoke')).toBeTruthy()

    const revokeBtn = screen.getByRole('button', { name: /^Revoke$/i })
    fireEvent.click(revokeBtn)

    await waitFor(() => {
      expect(client.revokeApiKey).toHaveBeenCalledWith('/api', 'k1')
    })
  })
})
