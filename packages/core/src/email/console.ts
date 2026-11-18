import type { EmailAdapter, EmailMessage } from './types'

export interface ConsoleEmailAdapterOptions {
  log?: (message: string) => void
}

let hasWarnedProduction = false

export function resetConsoleEmailAdapterWarning(): void {
  hasWarnedProduction = false
}

function checkProductionWarning(): void {
  if (process.env.NODE_ENV === 'production' && !hasWarnedProduction) {
    hasWarnedProduction = true
    console.warn(
      '[Lontar] WARNING: consoleEmailAdapter is intended for development only. Auth tokens and reset links will be logged to stdout in production.',
    )
  }
}

export function consoleEmailAdapter(options: ConsoleEmailAdapterOptions = {}): EmailAdapter {
  checkProductionWarning()
  const logger = options.log ?? console.log
  return {
    sendEmail(message: EmailMessage): void {
      checkProductionWarning()
      logger(
        `[Lontar Email] To: ${message.to} | Subject: ${message.subject}${
          message.from ? ` | From: ${message.from}` : ''
        }\nText: ${message.text ?? '(none)'}\n`,
      )
    },
  }
}
