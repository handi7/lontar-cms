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
  }
})

describe('AccountView (#343)', () => {
  let queryClient: QueryClient
  const mockSignOut = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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
})
