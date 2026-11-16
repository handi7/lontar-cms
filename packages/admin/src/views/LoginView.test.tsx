import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { AuthContext, type AuthContextValue } from '../context/AuthContext'
import { LoginView } from './LoginView'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'

let mockSearchStr = ''

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    state: {
      location: {
        searchStr: mockSearchStr,
      },
    },
  }),
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
  }
})

describe('LoginView (#344)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchStr = ''
  })

  afterEach(cleanup)

  function renderLoginView(options?: { emailEnabled?: boolean; user?: client.AdminUser }) {
    const config: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
        emailEnabled: Boolean(options?.emailEnabled),
      },
      collections: [],
      globals: [],
    }

    const signInMock = vi.fn().mockResolvedValue(undefined)
    const authValue: AuthContextValue = {
      user: options?.user ?? null,
      session: null,
      isLoading: false,
      signIn: signInMock,
      signOut: vi.fn(),
    }

    const renderResult = render(
      <AdminContext.Provider
        value={{
          config,
          apiBase: '/api',
          basePath: '/admin',
        }}
      >
        <AuthContext.Provider value={authValue}>
          <LoginView />
        </AuthContext.Provider>
      </AdminContext.Provider>,
    )

    return { ...renderResult, signInMock }
  }

  it('hides "Forgot password?" when emailEnabled is false', () => {
    renderLoginView({ emailEnabled: false })

    expect(screen.getByText('Sign in to Admin')).toBeTruthy()
    expect(screen.queryByText(/Forgot password\?/i)).toBeNull()
  })

  it('shows "Forgot password?" when emailEnabled is true', () => {
    renderLoginView({ emailEnabled: true })

    expect(screen.getByText(/Forgot password\?/i)).toBeTruthy()
  })

  it('switches to forgot password form and requests password reset', async () => {
    vi.mocked(client.requestPasswordReset).mockResolvedValue({
      status: true,
      message: 'Reset email sent',
    })

    renderLoginView({ emailEnabled: true })

    const forgotBtn = screen.getByText(/Forgot password\?/i)
    fireEvent.click(forgotBtn)

    expect(screen.getByText('Reset password')).toBeTruthy()
    expect(screen.getByText(/Enter your email and we will send you a reset link/i)).toBeTruthy()

    const emailInput = screen.getByLabelText(/^Email$/i)
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } })

    const submitBtn = screen.getByRole('button', { name: /Send reset link/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(client.requestPasswordReset).toHaveBeenCalledWith('/api', 'alice@example.com')
    })

    expect(
      await screen.findByText(
        /If an account with that email exists, we have sent a password reset link/i,
      ),
    ).toBeTruthy()

    // Can go back to sign in
    const backBtn = screen.getByRole('button', { name: /Back to Sign In/i })
    fireEvent.click(backBtn)

    expect(screen.getByText('Sign in to Admin')).toBeTruthy()
  })

  it('submits sign in form with credentials', async () => {
    const { signInMock } = renderLoginView({ emailEnabled: false })

    fireEvent.change(screen.getByLabelText(/^Email$/i), {
      target: { value: 'user@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'secret123' },
    })

    const submitBtn = screen.getByRole('button', { name: /Sign In/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'secret123',
      })
    })
  })
})
