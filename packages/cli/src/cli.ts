#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createUser } from './commands/create-user'
import { generateTypesCommand } from './commands/generate-types'
import { migrate } from './commands/migrate'
import { migrateCreate } from './commands/migrate-create'

// Read at runtime so `lontar --version` always matches the installed package.
// '../package.json' resolves the same from src/ (tests) and dist/ (published build).
export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version
export { generateTypes } from './typegen/generator'
export { generateTypesCommand, type GenerateTypesOptions } from './commands/generate-types'

function printHelp(): void {
  console.log(`
Lontar CLI

Usage:
  lontar <command> [options]

Commands:
  migrate:create   Generate a new SQL migration from config (--name <name>, --migrations-dir <path>)
  migrate          Run pending migrations against the database (--migrations-dir <path>)
  generate:types   Generate TypeScript types from config (--output <path>)
  create-user      Create a new user with --email, --password, --name, and optional --role

Options:
  --env-file <path>   Load environment variables from specified file
  -h, --help          Show help
  -v, --version       Show version
`)
}

export function parseGlobalFlags(argv: string[]): {
  envFile?: string
  cleanArgv: string[]
} {
  let envFile: string | undefined
  const cleanArgv: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue

    if (arg === '--env-file') {
      if (i + 1 >= argv.length) {
        throw new Error('A path argument is required for --env-file')
      }
      envFile = argv[++i]
    } else if (arg.startsWith('--env-file=')) {
      const val = arg.slice('--env-file='.length)
      if (!val) {
        throw new Error('A path argument is required for --env-file')
      }
      envFile = val
    } else {
      cleanArgv.push(arg)
    }
  }

  return { envFile, cleanArgv }
}

function parseNamedOption(
  argv: string[],
  index: number,
  names: string[],
): { value?: string; consumedNext: boolean } {
  const arg = argv[index]
  if (!arg) return { consumedNext: false }
  for (const name of names) {
    if (arg === name && argv[index + 1]) {
      return { value: argv[index + 1], consumedNext: true }
    }
    if (arg.startsWith(`${name}=`)) {
      return { value: arg.slice(name.length + 1), consumedNext: false }
    }
  }
  return { consumedNext: false }
}

function parseMigrateCreateArgs(argv: string[]): { name?: string; migrationsDir?: string } {
  let name: string | undefined
  let migrationsDir: string | undefined
  for (let i = 1; i < argv.length; i++) {
    const nameMatch = parseNamedOption(argv, i, ['--name'])
    if (nameMatch.value !== undefined) {
      name = nameMatch.value
      if (nameMatch.consumedNext) i++
      continue
    }

    const dirMatch = parseNamedOption(argv, i, ['--migrations-dir', '--out'])
    if (dirMatch.value !== undefined) {
      migrationsDir = dirMatch.value
      if (dirMatch.consumedNext) i++
    }
  }
  return { name, migrationsDir }
}

function parseMigrateArgs(argv: string[]): { migrationsDir?: string } {
  let migrationsDir: string | undefined
  for (let i = 1; i < argv.length; i++) {
    const dirMatch = parseNamedOption(argv, i, ['--migrations-dir', '--out'])
    if (dirMatch.value !== undefined) {
      migrationsDir = dirMatch.value
      if (dirMatch.consumedNext) i++
    }
  }
  return { migrationsDir }
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

const CREATE_USER_KEYS = ['email', 'password', 'name', 'role'] as const
type CreateUserKey = (typeof CREATE_USER_KEYS)[number]

function matchCreateUserOption(
  argv: string[],
  i: number,
): { key: CreateUserKey; value: string; consumedNext: boolean } | null {
  for (const key of CREATE_USER_KEYS) {
    const match = parseNamedOption(argv, i, [`--${key}`])
    if (match.value !== undefined) {
      return { key, value: match.value, consumedNext: match.consumedNext }
    }
  }
  return null
}

function parseCreateUserArgs(argv: string[]): {
  email?: string
  password?: string
  name?: string
  role?: string
} {
  const result: Record<string, string | undefined> = {}
  for (let i = 1; i < argv.length; i++) {
    const matched = matchCreateUserOption(argv, i)
    if (matched) {
      result[matched.key] = matched.value
      if (matched.consumedNext) i++
    }
  }
  return result
}

export interface GlobalCliOptions {
  envFile?: string
}

type CommandHandler = (argv: string[], globalOpts?: GlobalCliOptions) => Promise<void>

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  'migrate:create': async (argv, globalOpts) => {
    const opts = parseMigrateCreateArgs(argv)
    await migrateCreate({ ...opts, envFile: globalOpts?.envFile })
  },
  migrate: async (argv, globalOpts) => {
    const opts = parseMigrateArgs(argv)
    await migrate({ ...opts, envFile: globalOpts?.envFile })
  },
  'generate:types': async (argv, globalOpts) => {
    const opts = parseGenerateTypesArgs(argv)
    await generateTypesCommand({ ...opts, envFile: globalOpts?.envFile })
  },
  'create-user': async (argv, globalOpts) => {
    const opts = parseCreateUserArgs(argv)
    await createUser({ ...opts, envFile: globalOpts?.envFile })
  },
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { envFile, cleanArgv } = parseGlobalFlags(argv)
  const command = cleanArgv[0]

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
    await handler(cleanArgv, { envFile })
    return
  }

  console.error(`Unknown command: ${command}\n`)
  printHelp()
  process.exitCode = 1
}

export function isMainModule(argv1 = process.argv[1], metaUrl = import.meta.url): boolean {
  if (!argv1) return false
  if (pathToFileURL(argv1).href === metaUrl) return true
  const normalized = argv1.replace(/\\/g, '/')
  return normalized.endsWith('/cli.js') || normalized.endsWith('/cli.ts')
}

if (isMainModule()) {
  run().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
