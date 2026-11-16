export interface EmailMessageContent {
  subject: string
  html?: string
  text?: string
}

export interface EmailMessage extends EmailMessageContent {
  to: string
  from?: string
}

export interface EmailAdapter {
  sendEmail: (message: EmailMessage) => Promise<void> | void
}

export interface EmailTemplateData {
  user: {
    id: string
    email: string
    name?: string
  }
  url: string
  token: string
}

export interface EmailTemplates {
  resetPassword?: (data: EmailTemplateData) => EmailMessageContent
  invite?: (data: EmailTemplateData) => EmailMessageContent
  verifyEmail?: (data: EmailTemplateData) => EmailMessageContent
}

export interface EmailConfig {
  adapter: EmailAdapter
  from?: string
  templates?: EmailTemplates
}
