export type {
  EmailAdapter,
  EmailConfig,
  EmailMessage,
  EmailMessageContent,
  EmailTemplateData,
  EmailTemplates,
} from './types'
export { consoleEmailAdapter, type ConsoleEmailAdapterOptions } from './console'
export {
  defaultInviteTemplate,
  defaultResetPasswordTemplate,
  defaultVerifyEmailTemplate,
} from './templates'
export { resolveEmailConfig, sendEmailWithTemplate, type ResolvedEmailConfig } from './sender'
