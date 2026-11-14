import fs from 'node:fs'
import { loadConfig } from '../config'
import { closeDb } from '../utils/db'
import { resolveMigrationsDir } from '../utils/migrations-dir'

export interface MigrateOptions {
  cwd?: string
  envFile?: string
  migrationsDir?: string
}

export async function migrate(options: MigrateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd, { envFile: options.envFile })
  const migrationsDir = resolveMigrationsDir(cwd, config.db, options.migrationsDir)

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
