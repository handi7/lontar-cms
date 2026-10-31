import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config'

export interface MigrateOptions {
  cwd?: string
}

interface Closable {
  close(): Promise<void>
}

function isClosable(db: unknown): db is Closable {
  return typeof db === 'object' && db !== null && 'close' in db && typeof db.close === 'function'
}

export async function migrate(options: MigrateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd)
  const migrationsDir = path.resolve(cwd, 'migrations')

  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found. Run `lontar migrate:create` first.')
    return
  }

  await config.db.migrate({ migrationsDir })

  if (isClosable(config.db)) {
    await config.db.close()
  }

  console.log('Migrations applied successfully.')
}
