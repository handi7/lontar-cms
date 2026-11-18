import type { EmailMessageContent, EmailTemplateData } from './types'

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatGreeting(user: { name?: string }, escape = false): string {
  if (!user.name) return 'Hello'
  const name = escape ? escapeHtml(user.name) : user.name
  return `Hello ${name}`
}

export function defaultResetPasswordTemplate(data: EmailTemplateData): EmailMessageContent {
  const { user, url } = data
  const greeting = formatGreeting(user)
  const safeGreeting = formatGreeting(user, true)
  const safeUrl = escapeHtml(url)
  const subject = 'Reset your password'
  const text = `${greeting},\n\nYou recently requested to reset your password for Lontar CMS. Follow the link below to set a new password:\n\n${url}\n\nIf you did not request a password reset, you can safely ignore this email.\n`
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #111827; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
    <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">Reset your password</h2>
    <p style="margin-bottom: 24px; color: #4b5563;">${safeGreeting},</p>
    <p style="margin-bottom: 24px; color: #4b5563;">You recently requested to reset your password for Lontar CMS. Click the button below to set a new password:</p>
    <div style="margin-bottom: 24px;">
      <a href="${safeUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px;">Reset password</a>
    </div>
    <p style="margin-bottom: 24px; font-size: 13px; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${safeUrl}" style="color: #2563eb; word-break: break-all;">${safeUrl}</a></p>
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="margin: 0; font-size: 12px; color: #9ca3af;">If you did not request a password reset, you can safely ignore this email.</p>
  </div>
</body>
</html>`
  return { subject, text, html }
}

export function defaultInviteTemplate(data: EmailTemplateData): EmailMessageContent {
  const { user, url } = data
  const greeting = formatGreeting(user)
  const safeGreeting = formatGreeting(user, true)
  const safeUrl = escapeHtml(url)
  const subject = "You've been invited to Lontar CMS"
  const text = `${greeting},\n\nYou have been invited to join Lontar CMS. Follow the link below to set your password and activate your account:\n\n${url}\n\nThis invitation link will expire in 7 days.\n`
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invitation to Lontar CMS</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #111827; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
    <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">Welcome to Lontar CMS</h2>
    <p style="margin-bottom: 24px; color: #4b5563;">${safeGreeting},</p>
    <p style="margin-bottom: 24px; color: #4b5563;">You have been invited to join Lontar CMS. Click the button below to set your password and activate your account:</p>
    <div style="margin-bottom: 24px;">
      <a href="${safeUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px;">Accept invitation</a>
    </div>
    <p style="margin-bottom: 24px; font-size: 13px; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${safeUrl}" style="color: #2563eb; word-break: break-all;">${safeUrl}</a></p>
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="margin: 0; font-size: 12px; color: #9ca3af;">This invitation link will expire in 7 days.</p>
  </div>
</body>
</html>`
  return { subject, text, html }
}

export function defaultVerifyEmailTemplate(data: EmailTemplateData): EmailMessageContent {
  const { user, url } = data
  const greeting = formatGreeting(user)
  const safeGreeting = formatGreeting(user, true)
  const safeUrl = escapeHtml(url)
  const subject = 'Verify your email address'
  const text = `${greeting},\n\nPlease verify your email address for Lontar CMS by following the link below:\n\n${url}\n`
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Verify your email address</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #111827; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
    <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">Verify your email address</h2>
    <p style="margin-bottom: 24px; color: #4b5563;">${safeGreeting},</p>
    <p style="margin-bottom: 24px; color: #4b5563;">Please click the button below to verify your email address for Lontar CMS:</p>
    <div style="margin-bottom: 24px;">
      <a href="${safeUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px;">Verify email</a>
    </div>
    <p style="margin-bottom: 24px; font-size: 13px; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${safeUrl}" style="color: #2563eb; word-break: break-all;">${safeUrl}</a></p>
  </div>
</body>
</html>`
  return { subject, text, html }
}
