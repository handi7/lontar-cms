import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from '@lontar/core'
import { loadConfig } from '../config'
import { findDrizzleKitBin } from '../utils/drizzle-kit'
import { resolveMigrationsDir } from '../utils/migrations-dir'
import {
  applyLocalizationMigrationStatements,
  detectLocalizationTransitions,
  getLatestSnapshotPath,
  inspectRemovedLocales,
  patchSnapshotForTransitions,
  type DrizzleSnapshot,
  type LocalizationTransitions,
} from './migrate-localization'

export interface MigrateCreateOptions {
  cwd?: string
  name?: string
  envFile?: string
  migrationsDir?: string
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

export function applyRoleBackfill(
  sql: string,
  dialect?: string,
  options?: { adminRole?: string; defaultRole?: string },
): { sql: string; applied: boolean } {
  const adminRole = options?.adminRole ?? 'admin'
  const defaultRole = options?.defaultRole ?? 'editor'

  const hasAddRole =
    /ALTER\s+TABLE\s+(?:[`"]user[`"]|user)\s+ADD(?:\s+COLUMN)?\s+[`"]?role[`"]?/i.test(sql)
  if (!hasAddRole) {
    return { sql, applied: false }
  }

  const hasBackfill = new RegExp(
    `UPDATE\\s+[\`"]?user[\`"]?\\s+SET\\s+[\`"]?role[\`"]?\\s*=\\s*['"]${escapeRegex(adminRole)}['"]`,
    'i',
  ).test(sql)
  if (hasBackfill) {
    return { sql, applied: false }
  }

  const isPostgres = dialect === 'postgresql'
  const backfillStatements = isPostgres
    ? [
        `UPDATE "user" SET "role" = '${defaultRole}';`,
        `UPDATE "user" SET "role" = '${adminRole}' WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1);`,
      ].join('\n--> statement-breakpoint\n')
    : [
        `UPDATE \`user\` SET \`role\` = '${defaultRole}';`,
        `UPDATE \`user\` SET \`role\` = '${adminRole}' ORDER BY \`created_at\` ASC LIMIT 1;`,
      ].join('\n--> statement-breakpoint\n')

  const trimmed = sql.trimEnd()
  const updatedSql = `${trimmed}\n--> statement-breakpoint\n${backfillStatements}\n`
  return { sql: updatedSql, applied: true }
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

function processSingleMigrationFile(
  fullPath: string,
  prevMtime: number | undefined,
  dialect?: string,
  rolesConfig?: { adminRole?: string; defaultRole?: string },
  transitions?: LocalizationTransitions | null,
): void {
  const curMtime = fs.statSync(fullPath).mtimeMs
  if (prevMtime !== undefined && curMtime <= prevMtime) return

  let sql = fs.readFileSync(fullPath, 'utf-8')
  if (transitions) {
    const { sql: locSql, applied: locApplied } = applyLocalizationMigrationStatements(
      sql,
      transitions,
      dialect,
    )
    if (locApplied) {
      fs.writeFileSync(fullPath, locSql, 'utf-8')
      sql = locSql
    }
    const locWarnings = inspectRemovedLocales(transitions)
    for (const warn of locWarnings) {
      console.warn(`[lontar:migrate] Warning: ${warn}`)
    }
  }

  const { sql: updatedSql, applied } = applyRoleBackfill(sql, dialect, rolesConfig)
  if (applied) {
    fs.writeFileSync(fullPath, updatedSql, 'utf-8')
    sql = updatedSql
  }
  const warnings = inspectMigrationForStatusBackfills(sql, dialect)
  for (const warn of warnings) {
    console.warn(`[lontar:migrate] Warning: ${warn}`)
  }
}

function processMigrationFiles(
  migrationsDir: string,
  beforeFiles: Map<string, number>,
  dialect?: string,
  rolesConfig?: { adminRole?: string; defaultRole?: string },
  transitions?: LocalizationTransitions | null,
): void {
  if (!fs.existsSync(migrationsDir)) return
  for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      const fullPath = path.join(migrationsDir, entry.name)
      processSingleMigrationFile(
        fullPath,
        beforeFiles.get(fullPath),
        dialect,
        rolesConfig,
        transitions,
      )
    }
  }
}

interface PreparedSnapshot {
  snapshotPath: string | null
  originalContent: string | null
  transitions: LocalizationTransitions | null
}

function prepareSnapshotForGenerate(migrationsDir: string, config: Config): PreparedSnapshot {
  const snapshotPath = getLatestSnapshotPath(migrationsDir)
  if (!snapshotPath) {
    return { snapshotPath: null, originalContent: null, transitions: null }
  }

  try {
    const originalContent = fs.readFileSync(snapshotPath, 'utf-8')
    const snapshot = JSON.parse(originalContent) as DrizzleSnapshot
    const transitions = detectLocalizationTransitions(snapshot, config)
    const hasTransitions =
      transitions.columnTransitions.length > 0 || transitions.junctionTransitions.length > 0
    if (hasTransitions) {
      patchSnapshotForTransitions(snapshot, transitions)
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8')
    }
    return { snapshotPath, originalContent, transitions }
  } catch {
    return { snapshotPath: null, originalContent: null, transitions: null }
  }
}

function executeDrizzleKit(bin: string, args: string[], cwd: string): void {
  if (bin.endsWith('.cjs') || bin.endsWith('.js')) {
    execFileSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' })
  } else {
    execFileSync(bin, args, { cwd, stdio: 'inherit' })
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

  const migrationsDir = resolveMigrationsDir(cwd, config.db, options.migrationsDir)
  fs.mkdirSync(migrationsDir, { recursive: true })
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
  const prep = prepareSnapshotForGenerate(migrationsDir, config)

  try {
    executeDrizzleKit(bin, args, cwd)
  } finally {
    if (prep.snapshotPath && prep.originalContent !== null) {
      fs.writeFileSync(prep.snapshotPath, prep.originalContent, 'utf-8')
    }
  }

  processMigrationFiles(migrationsDir, beforeFiles, dialect, config.auth, prep.transitions)
}
