#!/usr/bin/env node
import { createUser } from './commands/create-user'
import { generateTypesCommand } from './commands/generate-types'
import { migrate } from './commands/migrate'
import { migrateCreate } from './commands/migrate-create'

export const VERSION = '0.0.0'
export { generateTypes } from './typegen/generator'
export { generateTypesCommand, type GenerateTypesOptions } from './commands/generate-types'

function printHelp(): void {
  console.log(`
Lontar CLI

Usage:
  lontar <command> [options]

Commands:
  migrate:create   Generate a new SQL migration from config
  migrate          Run pending migrations against the database
  generate:types   Generate TypeScript types from config (--output <path>)
  create-user      Create a new user with --email, --password, and --name

Options:
  -h, --help       Show help
  -v, --version    Show version
`)
}

function parseGenerateTypesArgs(argv: string[]): { output?: string } {
  let output: string | undefined
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
      output = argv[++i]
    }
  }
  return { output }
}

function parseCreateUserArgs(argv: string[]): {
  email?: string
  password?: string
  name?: string
} {
  let email: string | undefined
  let password: string | undefined
  let name: string | undefined

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--email' && argv[i + 1]) {
      email = argv[++i]
    } else if (arg === '--password' && argv[i + 1]) {
      password = argv[++i]
    } else if (arg === '--name' && argv[i + 1]) {
      name = argv[++i]
    }
  }

  return { email, password, name }
}

type CommandHandler = (argv: string[]) => Promise<void>

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  'migrate:create': async () => {
    await migrateCreate()
  },
  migrate: async () => {
    await migrate()
  },
  'generate:types': async (argv) => {
    const opts = parseGenerateTypesArgs(argv)
    await generateTypesCommand(opts)
  },
  'create-user': async (argv) => {
    const opts = parseCreateUserArgs(argv)
    await createUser(opts)
  },
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0]

  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === '--version' || command === '-v') {
    console.log(`v${VERSION}`)
    return
  }

  const handler = COMMAND_HANDLERS[command]
  if (handler) {
    await handler(argv)
    return
  }

  console.error(`Unknown command: ${command}\n`)
  printHelp()
  process.exitCode = 1
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/cli.js') ||
    process.argv[1].endsWith('/cli.ts') ||
    process.argv[1].endsWith('/lontar') ||
    process.argv[1].endsWith('/lontar.js'))

if (isMain) {
  run().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
