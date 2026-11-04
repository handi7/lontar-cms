import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config'
import { closeDb } from '../utils/db'

export interface MigrateOptions {
  cwd?: string
}

export async function migrate(options: MigrateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd)
  const migrationsDir = path.resolve(cwd, 'migrations')

  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found. Run `lontar migrate:create` first.')
    return
  }

  try {
    await config.db.migrate({ migrationsDir })
    console.log('Migrations applied successfully.')
  } finally {
    await closeDb(config.db)
  }
}
