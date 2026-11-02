#!/usr/bin/env node
import { createUser } from './commands/create-user'
import { migrate } from './commands/migrate'
import { migrateCreate } from './commands/migrate-create'

export const VERSION = '0.0.0'

function printHelp(): void {
  console.log(`
Lontar CLI

Usage:
  lontar <command> [options]

Commands:
  migrate:create   Generate a new SQL migration from config
  migrate          Run pending migrations against the database
  create-user      Create a new user with --email, --password, and --name

Options:
  -h, --help       Show help
  -v, --version    Show version
`)
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

  if (command === 'migrate:create') {
    await migrateCreate()
    return
  }

  if (command === 'migrate') {
    await migrate()
    return
  }

  if (command === 'create-user') {
    const opts = parseCreateUserArgs(argv)
    await createUser(opts)
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
