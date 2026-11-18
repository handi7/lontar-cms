import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleEmailAdapter, resetConsoleEmailAdapterWarning } from './console'
import { resolveEmailConfig, sendEmailWithTemplate } from './sender'
import {
  defaultInviteTemplate,
  defaultResetPasswordTemplate,
  defaultVerifyEmailTemplate,
  escapeHtml,
} from './templates'
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

  describe('HTML escaping and security in email templates (#382)', () => {
    it('escapes user.name and url in reset password, invite, and verify email templates', () => {
      const maliciousName = '<script>alert("xss")</script> & "quotes" \''
      const maliciousUrl = "https://example.com/reset?token=abc\"&foo='bar'><script>"

      const data = {
        user: { id: 'u1', email: 'victim@example.com', name: maliciousName },
        url: maliciousUrl,
        token: 'tok123',
      }

      const expectedSafeName =
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;'
      const expectedSafeUrl =
        'https://example.com/reset?token=abc&quot;&amp;foo=&#39;bar&#39;&gt;&lt;script&gt;'

      const templates = [
        defaultResetPasswordTemplate(data),
        defaultInviteTemplate(data),
        defaultVerifyEmailTemplate(data),
      ]

      for (const t of templates) {
        expect(t.html).toBeDefined()
        // Must contain escaped greeting and url
        expect(t.html).toContain(expectedSafeName)
        expect(t.html).toContain(`href="${expectedSafeUrl}"`)
        // Must NOT contain raw unescaped script tag or unescaped quotes in attributes
        expect(t.html).not.toContain('<script>')
        expect(t.html).not.toContain('alert("xss")')
        // Text version retains original unescaped strings
        expect(t.text).toContain(maliciousName)
        expect(t.text).toContain(maliciousUrl)
      }
    })

    it('escapeHtml escapes &, <, >, ", and \'', () => {
      expect(escapeHtml('Hello & <world> "test" \'quote\'')).toBe(
        'Hello &amp; &lt;world&gt; &quot;test&quot; &#39;quote&#39;',
      )
    })
  })

  describe('consoleEmailAdapter production warning (#382)', () => {
    const originalEnv = process.env.NODE_ENV

    beforeEach(() => {
      resetConsoleEmailAdapterWarning()
      vi.restoreAllMocks()
    })

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
      resetConsoleEmailAdapterWarning()
    })

    it('logs a one-time warning in production mode when adapter is created or used', async () => {
      process.env.NODE_ENV = 'production'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const adapter = consoleEmailAdapter({ log: vi.fn() })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('consoleEmailAdapter is intended for development only'),
      )

      // Calling sendEmail should not warn a second time (one-time warning)
      await adapter.sendEmail({
        to: 'test@example.com',
        subject: 'Hi',
        text: 'msg',
      })
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // Creating a second adapter should also not re-warn
      consoleEmailAdapter({ log: vi.fn() })
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('does not warn in development or test mode', async () => {
      process.env.NODE_ENV = 'development'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const adapter = consoleEmailAdapter({ log: vi.fn() })
      await adapter.sendEmail({
        to: 'test@example.com',
        subject: 'Hi',
        text: 'msg',
      })

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
