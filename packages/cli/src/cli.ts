#!/usr/bin/env node
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

Options:
  -h, --help       Show help
  -v, --version    Show version
`)
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
