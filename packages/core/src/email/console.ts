import type { EmailAdapter, EmailMessage } from './types'

export interface ConsoleEmailAdapterOptions {
  log?: (message: string) => void
}

export function consoleEmailAdapter(options: ConsoleEmailAdapterOptions = {}): EmailAdapter {
  const logger = options.log ?? console.log
  return {
    sendEmail(message: EmailMessage): void {
      logger(
        `[Lontar Email] To: ${message.to} | Subject: ${message.subject}${
          message.from ? ` | From: ${message.from}` : ''
        }\nText: ${message.text ?? '(none)'}\n`,
      )
    },
  }
}
