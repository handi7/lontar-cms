import { describe, expect, it, vi } from 'vitest'
import { consoleEmailAdapter } from './console'
import { resolveEmailConfig, sendEmailWithTemplate } from './sender'
import type { EmailAdapter, EmailMessage } from './types'

describe('email transport and templates (#344)', () => {
  it('consoleEmailAdapter formats and logs message', async () => {
    const logSpy = vi.fn()
    const adapter = consoleEmailAdapter({ log: logSpy })

    await adapter.sendEmail({
      to: 'user@example.com',
      from: 'Lontar <no-reply@lontar.dev>',
      subject: 'Test Subject',
      text: 'Test body',
    })

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Lontar Email] To: user@example.com | Subject: Test Subject'),
    )
  })

  it('resolveEmailConfig returns null when email is undefined', () => {
    expect(resolveEmailConfig(undefined)).toBeNull()
  })

  it('resolveEmailConfig handles bare EmailAdapter', () => {
    const mockAdapter: EmailAdapter = { sendEmail: vi.fn() }
    const resolved = resolveEmailConfig(mockAdapter)

    expect(resolved).not.toBeNull()
    expect(resolved?.adapter).toBe(mockAdapter)
    expect(resolved?.from).toBe('Lontar CMS <no-reply@lontar.dev>')
    expect(resolved?.templates.resetPassword).toBeDefined()
    expect(resolved?.templates.invite).toBeDefined()
    expect(resolved?.templates.verifyEmail).toBeDefined()
  })

  it('sendEmailWithTemplate sends password reset email with default template', async () => {
    const sendEmail = vi.fn()
    const resolved = resolveEmailConfig({
      adapter: { sendEmail },
      from: 'Admin <admin@example.com>',
    })
    expect(resolved).not.toBeNull()

    await sendEmailWithTemplate(resolved!, 'resetPassword', {
      user: { id: 'u1', email: 'alice@example.com', name: 'Alice' },
      url: 'https://example.com/admin/reset-password?token=tok123',
      token: 'tok123',
    })

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        from: 'Admin <admin@example.com>',
        subject: 'Reset your password',
      }),
    )
  })

  it('sendEmailWithTemplate supports custom template overrides', async () => {
    const sendEmail = vi.fn()
    const resolved = resolveEmailConfig({
      adapter: { sendEmail },
      templates: {
        invite: ({ user, url }) => ({
          subject: `Custom invite for ${user.name}`,
          text: `Join us: ${url}`,
        }),
      },
    })
    expect(resolved).not.toBeNull()

    await sendEmailWithTemplate(resolved!, 'invite', {
      user: { id: 'u2', email: 'bob@example.com', name: 'Bob' },
      url: 'https://example.com/admin/accept-invite?token=inv456',
      token: 'inv456',
    })

    expect(sendEmail).toHaveBeenCalledWith<[EmailMessage]>({
      to: 'bob@example.com',
      from: 'Lontar CMS <no-reply@lontar.dev>',
      subject: 'Custom invite for Bob',
      text: 'Join us: https://example.com/admin/accept-invite?token=inv456',
      html: undefined,
    })
  })
})
