import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CLIENT_CONFIG_VERSION, type ClientConfig } from '@lontar/core/client'
import { AdminContext } from '../context/AdminContext'
import { AcceptInviteView } from './AcceptInviteView'
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
    resetPassword: vi.fn(),
  }
})

describe('AcceptInviteView (#344)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchStr = ''
  })

  afterEach(cleanup)

  function renderAcceptInviteView(search = '') {
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
        <AcceptInviteView />
      </AdminContext.Provider>,
    )
  }

  it('renders invalid token alert when token param is missing', () => {
    renderAcceptInviteView('')

    expect(
      screen.getByText(
        /Invalid or missing invitation token. Please ask your administrator to send a new invite link./i,
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText(/Choose password/i)).toBeNull()
  })

  it('validates password length and matching confirmation', async () => {
    renderAcceptInviteView('?token=test-invite-token')

    expect(screen.getByText('Welcome to Lontar CMS')).toBeTruthy()

    const passwordInput = screen.getByLabelText(/^Choose password$/i)
    const confirmInput = screen.getByLabelText(/^Confirm password$/i)
    const submitBtn = screen.getByRole('button', { name: /Activate account/i })

    // Too short
    fireEvent.change(passwordInput, { target: { value: 'short' } })
    fireEvent.change(confirmInput, { target: { value: 'short' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/Password must be at least 8 characters long/i)).toBeTruthy()
    expect(client.resetPassword).not.toHaveBeenCalled()

    // Too long (#378)
    fireEvent.change(passwordInput, { target: { value: 'a'.repeat(129) } })
    fireEvent.change(confirmInput, { target: { value: 'a'.repeat(129) } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/Password cannot exceed 128 characters/i)).toBeTruthy()
    expect(client.resetPassword).not.toHaveBeenCalled()

    // Does not match
    fireEvent.change(passwordInput, { target: { value: 'password123' } })
    fireEvent.change(confirmInput, { target: { value: 'different123' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/Passwords do not match/i)).toBeTruthy()
    expect(client.resetPassword).not.toHaveBeenCalled()
  })

  it('submits valid activation form and shows success', async () => {
    vi.mocked(client.resetPassword).mockResolvedValue({
      status: true,
    })

    renderAcceptInviteView('?token=valid-invite-456')

    const passwordInput = screen.getByLabelText(/^Choose password$/i)
    const confirmInput = screen.getByLabelText(/^Confirm password$/i)
    const submitBtn = screen.getByRole('button', { name: /Activate account/i })

    fireEvent.change(passwordInput, { target: { value: 'validPassword123' } })
    fireEvent.change(confirmInput, { target: { value: 'validPassword123' } })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(client.resetPassword).toHaveBeenCalledWith('/api', {
        token: 'valid-invite-456',
        newPassword: 'validPassword123',
      })
    })

    expect(await screen.findByText(/Your account has been activated successfully!/i)).toBeTruthy()
    expect(screen.getByText(/Sign in to Admin/i)).toBeTruthy()
  })

  it('shows error message if activation API fails', async () => {
    vi.mocked(client.resetPassword).mockRejectedValue(new Error('Invitation token has expired'))

    renderAcceptInviteView('?token=expired-invite')

    const passwordInput = screen.getByLabelText(/^Choose password$/i)
    const confirmInput = screen.getByLabelText(/^Confirm password$/i)
    const submitBtn = screen.getByRole('button', { name: /Activate account/i })

    fireEvent.change(passwordInput, { target: { value: 'validPassword123' } })
    fireEvent.change(confirmInput, { target: { value: 'validPassword123' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText('Invitation token has expired')).toBeTruthy()
  })
})
