import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config'
import { findDrizzleKitBin } from '../utils/drizzle-kit'

export interface MigrateCreateOptions {
  cwd?: string
  name?: string
  envFile?: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inspectAddStatus(sql: string, dialect?: string): string[] {
  const warnings: string[] = []
  const addStatusMatches = sql.matchAll(
    /ALTER\s+TABLE\s+(?:[`"]([^`"]+)[`"]|([^\s`";]+))\s+ADD(?:\s+COLUMN)?\s+[`"]?_status[`"]?/gi,
  )
  for (const match of addStatusMatches) {
    const table = match[1] ?? match[2]
    if (!table) continue
    const hasBackfill = new RegExp(
      `UPDATE\\s+[\`"]?${escapeRegex(table)}[\`"]?\\s+SET\\s+[\`"]?_status[\`"]?\\s*=\\s*['"]published['"]`,
      'i',
    ).test(sql)
    if (!hasBackfill) {
      if (dialect === 'postgresql') {
        warnings.push(
          `Migration adds "_status" to table "${table}". Pre-existing rows will default to 'draft' and be hidden from public queries. If existing rows should remain published, add: UPDATE "${table}" SET "_status" = 'published';`,
        )
      } else {
        warnings.push(
          `Migration adds \`_status\` to table "${table}". Pre-existing rows will default to 'draft' and be hidden from public queries. If existing rows should remain published, add: UPDATE \`${table}\` SET \`_status\` = 'published';`,
        )
      }
    }
  }
  return warnings
}

function inspectModifyStatus(sql: string, dialect?: string): string[] {
  const warnings: string[] = []
  const modifyStatusMatches = sql.matchAll(
    /ALTER\s+TABLE\s+(?:[`"]([^`"]+)[`"]|([^\s`";]+))\s+(?:MODIFY(?:\s+COLUMN)?\s+[`"]?_status[`"]?[^;]*NOT\s+NULL|ALTER(?:\s+COLUMN)?\s+[`"]?_status[`"]?\s+SET\s+NOT\s+NULL)/gi,
  )
  for (const match of modifyStatusMatches) {
    const table = match[1] ?? match[2]
    if (!table) continue
    const hasNullCheck = new RegExp(
      `UPDATE\\s+[\`"]?${escapeRegex(table)}[\`"]?\\s+SET\\s+[\`"]?_status[\`"]?[^;]*WHERE\\s+[\`"]?_status[\`"]?\\s+IS\\s+NULL`,
      'i',
    ).test(sql)
    if (!hasNullCheck) {
      if (dialect === 'postgresql') {
        warnings.push(
          `Migration modifies "_status" to NOT NULL on table "${table}". If existing rows contain NULL values, the NOT NULL constraint will fail. Add a backfill before applying NOT NULL: UPDATE "${table}" SET "_status" = 'draft' WHERE "_status" IS NULL;`,
        )
      } else {
        warnings.push(
          `Migration modifies \`_status\` to NOT NULL on table "${table}". If existing rows contain NULL values, MySQL strict mode will fail. Add a backfill before MODIFY: UPDATE \`${table}\` SET \`_status\` = 'draft' WHERE \`_status\` IS NULL;`,
        )
      }
    }
  }
  return warnings
}

export function inspectMigrationForStatusBackfills(sql: string, dialect?: string): string[] {
  return [...inspectAddStatus(sql, dialect), ...inspectModifyStatus(sql, dialect)]
}

function getMigrationSqlFiles(migrationsDir: string): Map<string, number> {
  const map = new Map<string, number>()
  if (!fs.existsSync(migrationsDir)) return map
  for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      const fullPath = path.join(migrationsDir, entry.name)
      map.set(fullPath, fs.statSync(fullPath).mtimeMs)
    }
  }
  return map
}

function warnOnMissingStatusBackfills(
  migrationsDir: string,
  beforeFiles: Map<string, number>,
  dialect?: string,
): void {
  if (!fs.existsSync(migrationsDir)) return
  for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      const fullPath = path.join(migrationsDir, entry.name)
      const prevMtime = beforeFiles.get(fullPath)
      const curMtime = fs.statSync(fullPath).mtimeMs
      if (prevMtime === undefined || curMtime > prevMtime) {
        const sql = fs.readFileSync(fullPath, 'utf-8')
        const warnings = inspectMigrationForStatusBackfills(sql, dialect)
        for (const warn of warnings) {
          console.warn(`[lontar:migrate] Warning: ${warn}`)
        }
      }
    }
  }
}

export async function migrateCreate(options: MigrateCreateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd, { envFile: options.envFile })

  const schemaContent = config.db.toSchemaFile(config)
  const lontarDir = path.resolve(cwd, '.lontar')
  fs.mkdirSync(lontarDir, { recursive: true })

  const schemaPath = path.resolve(lontarDir, 'schema.ts')
  fs.writeFileSync(schemaPath, schemaContent, 'utf-8')

  const migrationsDir = path.resolve(cwd, 'migrations')
  const bin = findDrizzleKitBin(cwd)

  const outDir = path.relative(cwd, migrationsDir) || 'migrations'
  const schemaRel = path.relative(cwd, schemaPath)

  const dialect =
    config.db.dialect ?? (config.db.name === 'postgres' ? 'postgresql' : config.db.name)
  const args: string[] = ['generate', '--dialect', dialect, '--schema', schemaRel, '--out', outDir]
  if (options.name) {
    args.push('--name', options.name)
  }

  const beforeFiles = getMigrationSqlFiles(migrationsDir)

  if (bin.endsWith('.cjs') || bin.endsWith('.js')) {
    execFileSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' })
  } else {
    execFileSync(bin, args, { cwd, stdio: 'inherit' })
  }

  warnOnMissingStatusBackfills(migrationsDir, beforeFiles, dialect)
}
