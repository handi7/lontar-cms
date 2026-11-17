import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { VerifyEmailView } from './VerifyEmailView'
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
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    verifyEmail: vi.fn(),
  }
})

describe('VerifyEmailView (#368)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchStr = ''
  })

  afterEach(cleanup)

  function renderVerifyEmailView(search = '') {
    mockSearchStr = search

    const config: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      auth: {
        roles: ['admin', 'editor'],
        defaultRole: 'editor',
        adminRole: 'admin',
        emailEnabled: true,
      },
      collections: [],
      globals: [],
    }

    return render(
      <AdminContext.Provider
        value={{
          config,
          apiBase: '/api',
          basePath: '/admin',
        }}
      >
        <VerifyEmailView />
      </AdminContext.Provider>,
    )
  }

  it('renders invalid token alert when token param is missing', () => {
    renderVerifyEmailView('')

    expect(
      screen.getByText(
        /Invalid or missing verification token. Please sign in or contact an administrator to request a new verification email./i,
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /Go to Sign In/i })).toBeTruthy()
  })

  it('renders error alert when error query param is present', () => {
    renderVerifyEmailView('?error=token_expired')

    expect(screen.getByText(/Email verification link is invalid or has expired./i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Go to Sign In/i })).toBeTruthy()
  })

  it('successfully verifies email and renders success alert', async () => {
    vi.mocked(client.verifyEmail).mockResolvedValueOnce({ status: true })

    renderVerifyEmailView('?token=valid-verify-token')

    expect(screen.getByText(/Verifying your email address.../i)).toBeTruthy()

    await waitFor(() => {
      expect(client.verifyEmail).toHaveBeenCalledWith('/api', 'valid-verify-token')
    })

    await waitFor(() => {
      expect(screen.getByText(/Your email address has been verified successfully!/i)).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: /Sign in to Admin/i })).toBeTruthy()
  })

  it('renders error alert when verification fails', async () => {
    vi.mocked(client.verifyEmail).mockRejectedValueOnce(new Error('Invalid token'))

    renderVerifyEmailView('?token=expired-verify-token')

    await waitFor(() => {
      expect(screen.getByText(/Invalid token/i)).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: /Go to Sign In/i })).toBeTruthy()
  })
})
