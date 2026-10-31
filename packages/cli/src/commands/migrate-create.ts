import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config'
import { findDrizzleKitBin } from '../utils/drizzle-kit'

export interface MigrateCreateOptions {
  cwd?: string
  name?: string
}

export async function migrateCreate(options: MigrateCreateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd)

  const schemaContent = config.db.toSchemaFile(config)
  const lontarDir = path.resolve(cwd, '.lontar')
  fs.mkdirSync(lontarDir, { recursive: true })

  const schemaPath = path.resolve(lontarDir, 'schema.ts')
  fs.writeFileSync(schemaPath, schemaContent, 'utf-8')

  const migrationsDir = path.resolve(cwd, 'migrations')
  const bin = findDrizzleKitBin(cwd)

  const args: string[] = [
    'generate',
    '--dialect',
    config.db.name,
    '--schema',
    schemaPath,
    '--out',
    migrationsDir,
  ]
  if (options.name) {
    args.push('--name', options.name)
  }

  if (bin.endsWith('.cjs') || bin.endsWith('.js')) {
    execFileSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' })
  } else {
    execFileSync(bin, args, { cwd, stdio: 'inherit' })
  }
}
