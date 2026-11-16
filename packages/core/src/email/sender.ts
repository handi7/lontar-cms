import type {
  EmailAdapter,
  EmailConfig,
  EmailMessage,
  EmailTemplateData,
  EmailTemplates,
} from './types'
import {
  defaultInviteTemplate,
  defaultResetPasswordTemplate,
  defaultVerifyEmailTemplate,
} from './templates'

export interface ResolvedEmailConfig {
  adapter: EmailAdapter
  from: string
  templates: Required<EmailTemplates>
}

function isEmailAdapter(email: EmailAdapter | EmailConfig): email is EmailAdapter {
  return typeof (email as EmailAdapter).sendEmail === 'function'
}

function resolveTemplates(custom?: EmailTemplates): Required<EmailTemplates> {
  return {
    resetPassword: custom?.resetPassword ?? defaultResetPasswordTemplate,
    invite: custom?.invite ?? defaultInviteTemplate,
    verifyEmail: custom?.verifyEmail ?? defaultVerifyEmailTemplate,
  }
}

export function resolveEmailConfig(email?: EmailAdapter | EmailConfig): ResolvedEmailConfig | null {
  if (!email) return null

  if (isEmailAdapter(email)) {
    return {
      adapter: email,
      from: 'Lontar CMS <no-reply@lontar.dev>',
      templates: resolveTemplates(),
    }
  }

  return {
    adapter: email.adapter,
    from: email.from ?? 'Lontar CMS <no-reply@lontar.dev>',
    templates: resolveTemplates(email.templates),
  }
}

export async function sendEmailWithTemplate(
  resolved: ResolvedEmailConfig,
  type: keyof EmailTemplates,
  data: EmailTemplateData,
): Promise<void> {
  const templateFn = resolved.templates[type]
  const content = templateFn(data)
  const message: EmailMessage = {
    to: data.user.email,
    from: resolved.from,
    subject: content.subject,
    html: content.html,
    text: content.text,
  }
  await resolved.adapter.sendEmail(message)
}
