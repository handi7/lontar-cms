import fs from 'node:fs'
import path from 'node:path'

export interface DatabaseAdapterMeta {
  name: string
  dialect?: string
}

/**
 * Resolves the migrations directory to use.
 *
 * 1. If explicitDir is provided, uses that (resolved against cwd).
 * 2. If a subdirectory matching db.name exists under migrations/, uses that (e.g. migrations/mysql, migrations/postgres).
 * 3. If a subdirectory matching db.dialect exists under migrations/, uses that (e.g. migrations/postgresql).
 * 4. Otherwise, defaults to cwd/migrations.
 */
export function resolveMigrationsDir(
  cwd: string,
  db: DatabaseAdapterMeta,
  explicitDir?: string,
): string {
  if (explicitDir) {
    return path.resolve(cwd, explicitDir)
  }

  const nameSubdir = path.resolve(cwd, 'migrations', db.name)
  if (fs.existsSync(nameSubdir)) {
    return nameSubdir
  }

  if (db.dialect) {
    const dialectSubdir = path.resolve(cwd, 'migrations', db.dialect)
    if (fs.existsSync(dialectSubdir)) {
      return dialectSubdir
    }
  }

  return path.resolve(cwd, 'migrations')
}
