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
  migrate:create   Generate a new SQL migration from config
  migrate          Run pending migrations against the database
  generate:types   Generate TypeScript types from config (--output <path>)
  create-user      Create a new user with --email, --password, and --name

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

function parseMigrateCreateArgs(argv: string[]): { name?: string } {
  let name: string | undefined
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue

    if (arg === '--name' && argv[i + 1]) {
      name = argv[++i]
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length)
    }
  }
  return { name }
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

export interface GlobalCliOptions {
  envFile?: string
}

type CommandHandler = (argv: string[], globalOpts?: GlobalCliOptions) => Promise<void>

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  'migrate:create': async (argv, globalOpts) => {
    const opts = parseMigrateCreateArgs(argv)
    await migrateCreate({ ...opts, envFile: globalOpts?.envFile })
  },
  migrate: async (_argv, globalOpts) => {
    await migrate({ envFile: globalOpts?.envFile })
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
