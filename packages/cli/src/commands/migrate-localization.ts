import fs from 'node:fs'
import path from 'node:path'
import type { Config } from '@lontar/core'

export interface DrizzleSnapshotColumn {
  name: string
  type: string
  primaryKey: boolean
  notNull: boolean
  autoincrement?: boolean
  default?: unknown
}

export interface DrizzleSnapshotIndex {
  name: string
  columns: string[]
  isUnique: boolean
}

export interface DrizzleSnapshotTable {
  name: string
  columns: Record<string, DrizzleSnapshotColumn>
  indexes?: Record<string, DrizzleSnapshotIndex>
  foreignKeys?: Record<string, unknown>
  compositePrimaryKeys?: Record<string, unknown>
  uniqueConstraints?: Record<string, unknown>
}

export interface DrizzleSnapshot {
  version: string
  dialect: string
  id: string
  prevId: string
  tables: Record<string, DrizzleSnapshotTable>
}

export interface ColumnTransition {
  table: string
  fromColumn: string
  toColumn: string
  type: 'to-localized' | 'from-localized'
  columnType?: string
  wasNotNull?: boolean
}

export interface JunctionTransition {
  table: string
  junctionTable: string
  type: 'to-localized' | 'from-localized'
  defaultLocale: string
}

export interface LocalizationTransitions {
  columnTransitions: ColumnTransition[]
  junctionTransitions: JunctionTransition[]
  removedLocales: Array<{ locale: string; table: string; column: string }>
}

export interface FlattenedFieldInfo {
  name: string
  field: {
    type: string
    localized?: boolean
    required?: boolean
    hasMany?: boolean
    relationTo?: string | string[]
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toFlattenedField(
  rawField: unknown,
  colName: string,
  parentLocalized: boolean,
): FlattenedFieldInfo | null {
  if (!rawField || typeof rawField !== 'object') return null
  const field = rawField as {
    type?: string
    fields?: Record<string, unknown>
    localized?: boolean
    required?: boolean
    hasMany?: boolean
    relationTo?: string | string[]
  }
  if (field.type === 'group') return null
  return {
    name: colName,
    field: {
      type: field.type ?? 'text',
      localized: parentLocalized || Boolean(field.localized),
      required: Boolean(field.required),
      hasMany: Boolean(field.hasMany),
      relationTo: field.relationTo,
    },
  }
}

function flattenSingleField(
  name: string,
  rawField: unknown,
  prefix: string,
  parentLocalized: boolean,
): FlattenedFieldInfo[] {
  if (!rawField || typeof rawField !== 'object') return []
  const colName = prefix ? `${prefix}__${name}` : name
  const fieldObj = rawField as {
    type?: string
    fields?: Record<string, unknown>
    localized?: boolean
  }
  if (fieldObj.type === 'group' && fieldObj.fields) {
    const isLoc = parentLocalized || Boolean(fieldObj.localized)
    return flattenFields(fieldObj.fields, colName, isLoc)
  }
  const flat = toFlattenedField(rawField, colName, parentLocalized)
  return flat ? [flat] : []
}

export function flattenFields(
  fields: Record<string, unknown>,
  prefix = '',
  parentLocalized = false,
): FlattenedFieldInfo[] {
  const result: FlattenedFieldInfo[] = []
  for (const [name, rawField] of Object.entries(fields)) {
    result.push(...flattenSingleField(name, rawField, prefix, parentLocalized))
  }
  return result
}

export function findSnapshotTable(
  snapshot: DrizzleSnapshot,
  tableName: string,
): { key: string; table: DrizzleSnapshotTable } | undefined {
  const table = snapshot.tables[tableName]
  if (table) {
    return { key: tableName, table }
  }
  const pgKey = `public.${tableName}`
  const pgTable = snapshot.tables[pgKey]
  if (pgTable) {
    return { key: pgKey, table: pgTable }
  }
  const stripped = tableName.replace(/^public\./, '')
  const strippedTable = snapshot.tables[stripped]
  if (strippedTable) {
    return { key: stripped, table: strippedTable }
  }
  return undefined
}

export function getLatestSnapshotPath(migrationsDir: string): string | null {
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) return null

  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries?: Array<{ idx: number; tag: string }>
    }
    if (!journal.entries || journal.entries.length === 0) return null

    const lastEntry = journal.entries[journal.entries.length - 1]
    if (!lastEntry) return null

    const paddedIdx = String(lastEntry.idx).padStart(4, '0')
    const snapPath = path.join(migrationsDir, 'meta', `${paddedIdx}_snapshot.json`)
    return fs.existsSync(snapPath) ? snapPath : null
  } catch {
    return null
  }
}

function detectJunctionTransition(
  entitySlug: string,
  colName: string,
  field: FlattenedFieldInfo['field'],
  snapshot: DrizzleSnapshot,
  defaultLocale?: string,
): JunctionTransition | null {
  if (field.type !== 'relationship' || !field.hasMany) return null
  const junctionTableName = `${entitySlug}_${colName}`
  const jTableInfo = findSnapshotTable(snapshot, junctionTableName)
  if (!jTableInfo) return null

  const hasLocale = Boolean(jTableInfo.table.columns['_locale'])
  if (field.localized && !hasLocale && defaultLocale) {
    return {
      table: entitySlug,
      junctionTable: junctionTableName,
      type: 'to-localized',
      defaultLocale,
    }
  }
  if (!field.localized && hasLocale) {
    return {
      table: entitySlug,
      junctionTable: junctionTableName,
      type: 'from-localized',
      defaultLocale: defaultLocale ?? 'en',
    }
  }
  return null
}

const LOCALE_SUFFIX_REGEX = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/

/**
 * Columns of `table` that are per-locale variants of `colName` (`title_en` for `title`).
 * The part after `${colName}_` must be a locale code, so `title_tag` is not a variant of `title`.
 * With localization configured, the code must be a configured one; when it was removed
 * entirely there is nothing to compare with, so any well-formed locale code is accepted.
 */
function findLocaleVariantColumns(
  table: DrizzleSnapshotTable,
  colName: string,
  configuredLocales: readonly string[],
): string[] {
  const prefix = `${colName}_`
  return Object.keys(table.columns).filter((c) => {
    if (!c.startsWith(prefix)) return false
    const suffix = c.slice(prefix.length)
    return configuredLocales.length > 0
      ? configuredLocales.includes(suffix)
      : LOCALE_SUFFIX_REGEX.test(suffix)
  })
}

function detectToLocalizedColumn(
  entitySlug: string,
  colName: string,
  table: DrizzleSnapshotTable,
  defaultLocale: string,
): ColumnTransition | null {
  const unlocalizedCol = table.columns[colName]
  if (!unlocalizedCol) return null
  return {
    table: entitySlug,
    fromColumn: colName,
    toColumn: `${colName}_${defaultLocale}`,
    type: 'to-localized',
    columnType: unlocalizedCol.type,
    wasNotNull: unlocalizedCol.notNull,
  }
}

function detectFromLocalizedColumn(
  entitySlug: string,
  colName: string,
  table: DrizzleSnapshotTable,
  defaultLocale: string | undefined,
  configuredLocales: readonly string[],
  otherFieldNames: ReadonlySet<string>,
): ColumnTransition | null {
  // The column already exists unlocalized, so there is nothing to convert back.
  if (table.columns[colName]) return null

  const matchingCols = findLocaleVariantColumns(table, colName, configuredLocales).filter(
    (c) => !otherFieldNames.has(c),
  )
  if (matchingCols.length === 0) return null

  const defaultCol = defaultLocale ? `${colName}_${defaultLocale}` : ''
  const fromCol = defaultCol && table.columns[defaultCol] ? defaultCol : matchingCols[0]!

  return {
    table: entitySlug,
    fromColumn: fromCol,
    toColumn: colName,
    type: 'from-localized',
    columnType: table.columns[fromCol]?.type,
    wasNotNull: false,
  }
}

function detectColumnTransition(
  entitySlug: string,
  colName: string,
  field: FlattenedFieldInfo['field'],
  table: DrizzleSnapshotTable,
  defaultLocale?: string,
  configuredLocales: readonly string[] = [],
  otherFieldNames: ReadonlySet<string> = new Set(),
): ColumnTransition | null {
  if (field.localized && defaultLocale) {
    return detectToLocalizedColumn(entitySlug, colName, table, defaultLocale)
  }
  return detectFromLocalizedColumn(
    entitySlug,
    colName,
    table,
    defaultLocale,
    configuredLocales,
    otherFieldNames,
  )
}

function detectRemovedLocalesForTable(
  entitySlug: string,
  table: DrizzleSnapshotTable,
  flatFields: FlattenedFieldInfo[],
  configuredLocales: string[],
): Array<{ locale: string; table: string; column: string }> {
  if (configuredLocales.length === 0) return []
  const removed: Array<{ locale: string; table: string; column: string }> = []
  for (const colName of Object.keys(table.columns)) {
    const lastUnderscore = colName.lastIndexOf('_')
    if (lastUnderscore <= 0) continue
    const suffix = colName.slice(lastUnderscore + 1)
    const baseName = colName.slice(0, lastUnderscore)
    const matchedField = flatFields.find((f) => f.name === baseName)
    if (matchedField?.field.localized && !configuredLocales.includes(suffix)) {
      removed.push({ locale: suffix, table: entitySlug, column: colName })
    }
  }
  return removed
}

function detectEntityTransitions(
  entitySlug: string,
  table: DrizzleSnapshotTable,
  flat: FlattenedFieldInfo[],
  snapshot: DrizzleSnapshot,
  defaultLocale?: string,
  configuredLocales: readonly string[] = [],
): { column: ColumnTransition[]; junction: JunctionTransition[] } {
  const column: ColumnTransition[] = []
  const junction: JunctionTransition[] = []
  const fieldNames = new Set(flat.map((f) => f.name))

  for (const { name: colName, field } of flat) {
    const junc = detectJunctionTransition(entitySlug, colName, field, snapshot, defaultLocale)
    if (junc) {
      junction.push(junc)
      continue
    }
    if (field.type === 'relationship' && field.hasMany) continue

    const col = detectColumnTransition(
      entitySlug,
      colName,
      field,
      table,
      defaultLocale,
      configuredLocales,
      fieldNames,
    )
    if (col) {
      column.push(col)
    }
  }

  return { column, junction }
}

export function detectLocalizationTransitions(
  snapshot: DrizzleSnapshot,
  config: Config,
): LocalizationTransitions {
  const columnTransitions: ColumnTransition[] = []
  const junctionTransitions: JunctionTransition[] = []
  const removedLocales: Array<{ locale: string; table: string; column: string }> = []

  const defaultLocale = config.localization?.defaultLocale
  const configuredLocales =
    config.localization?.locales.map((l) => (typeof l === 'string' ? l : l.code)) ?? []

  const entities: Array<{ slug: string; fields: Record<string, unknown> }> = [
    ...(config.collections ?? []),
    ...(config.globals ?? []),
  ]

  for (const entity of entities) {
    const tableInfo = findSnapshotTable(snapshot, entity.slug)
    if (!tableInfo) continue

    const flat = flattenFields(entity.fields)
    const entityTrans = detectEntityTransitions(
      entity.slug,
      tableInfo.table,
      flat,
      snapshot,
      defaultLocale,
      configuredLocales,
    )
    columnTransitions.push(...entityTrans.column)
    junctionTransitions.push(...entityTrans.junction)

    removedLocales.push(
      ...detectRemovedLocalesForTable(entity.slug, tableInfo.table, flat, configuredLocales),
    )
  }

  return { columnTransitions, junctionTransitions, removedLocales }
}

export function patchSnapshotForTransitions(
  snapshot: DrizzleSnapshot,
  transitions: LocalizationTransitions,
): void {
  for (const trans of transitions.columnTransitions) {
    const tableInfo = findSnapshotTable(snapshot, trans.table)
    if (!tableInfo) continue

    const colObj = tableInfo.table.columns[trans.fromColumn]
    if (colObj) {
      tableInfo.table.columns[trans.toColumn] = {
        ...colObj,
        name: trans.toColumn,
        notNull: false,
      }
      delete tableInfo.table.columns[trans.fromColumn]
    }

    for (const idx of Object.values(tableInfo.table.indexes ?? {})) {
      if (idx.columns.includes(trans.fromColumn)) {
        idx.columns = idx.columns.map((c) => (c === trans.fromColumn ? trans.toColumn : c))
      }
    }
  }
}

function insertTableStatements(
  statements: string[],
  tableName: string,
  newStatements: string[],
): string[] {
  if (newStatements.length === 0) return statements

  const dropPattern = new RegExp(
    `ALTER\\s+TABLE\\s+[\`"]?(?:public\\.)?${escapeRegex(tableName)}[\`"]?\\s+DROP\\s+(?:INDEX|CONSTRAINT)`,
    'i',
  )
  const addPattern = new RegExp(
    `ALTER\\s+TABLE\\s+[\`"]?(?:public\\.)?${escapeRegex(tableName)}[\`"]?\\s+ADD`,
    'i',
  )
  const anyTablePattern = new RegExp(
    `ALTER\\s+TABLE\\s+[\`"]?(?:public\\.)?${escapeRegex(tableName)}[\`"]?`,
    'i',
  )

  let lastDropIdx = -1
  for (let i = 0; i < statements.length; i++) {
    if (dropPattern.test(statements[i]!)) {
      lastDropIdx = i
    }
  }

  if (lastDropIdx !== -1) {
    return [
      ...statements.slice(0, lastDropIdx + 1),
      ...newStatements,
      ...statements.slice(lastDropIdx + 1),
    ]
  }

  const firstAddIdx = statements.findIndex((s) => addPattern.test(s))
  if (firstAddIdx !== -1) {
    return [...statements.slice(0, firstAddIdx), ...newStatements, ...statements.slice(firstAddIdx)]
  }

  const firstTableIdx = statements.findIndex((s) => anyTablePattern.test(s))
  if (firstTableIdx !== -1) {
    return [
      ...statements.slice(0, firstTableIdx),
      ...newStatements,
      ...statements.slice(firstTableIdx),
    ]
  }

  return [...newStatements, ...statements]
}

function applyJunctionToLocalized(
  statements: string[],
  jt: JunctionTransition,
  isPostgres: boolean,
): string[] {
  const pattern = new RegExp(
    `ALTER\\s+TABLE\\s+[\`"]?(?:public\\.)?${escapeRegex(jt.junctionTable)}[\`"]?\\s+ADD(?:\\s+COLUMN)?\\s+[\`"]?_locale[\`"]?[^;]*NOT\\s+NULL;?`,
    'i',
  )
  const idx = statements.findIndex((s) => pattern.test(s))
  const safeStatements = isPostgres
    ? [
        `ALTER TABLE "${jt.junctionTable}" ADD COLUMN "_locale" varchar(10);`,
        `UPDATE "${jt.junctionTable}" SET "_locale" = '${jt.defaultLocale}' WHERE "_locale" IS NULL;`,
        `ALTER TABLE "${jt.junctionTable}" ALTER COLUMN "_locale" SET NOT NULL;`,
      ]
    : [
        `ALTER TABLE \`${jt.junctionTable}\` ADD \`_locale\` varchar(10);`,
        `UPDATE \`${jt.junctionTable}\` SET \`_locale\` = '${jt.defaultLocale}' WHERE \`_locale\` IS NULL;`,
        `ALTER TABLE \`${jt.junctionTable}\` MODIFY COLUMN \`_locale\` varchar(10) NOT NULL;`,
      ]

  if (idx !== -1) {
    const copy = [...statements]
    copy.splice(idx, 1, ...safeStatements)
    return copy
  }
  return [...safeStatements, ...statements]
}

function applyJunctionFromLocalized(
  statements: string[],
  jt: JunctionTransition,
  isPostgres: boolean,
): string[] {
  const pattern = new RegExp(
    `ALTER\\s+TABLE\\s+[\`"]?(?:public\\.)?${escapeRegex(jt.junctionTable)}[\`"]?\\s+DROP(?:\\s+COLUMN)?\\s+[\`"]?_locale[\`"]?;?`,
    'i',
  )
  const idx = statements.findIndex((s) => pattern.test(s))
  const cleanupStatement = isPostgres
    ? `DELETE FROM "${jt.junctionTable}" WHERE "_locale" != '${jt.defaultLocale}';`
    : `DELETE FROM \`${jt.junctionTable}\` WHERE \`_locale\` != '${jt.defaultLocale}';`

  const copy = [...statements]
  if (idx !== -1) {
    copy.splice(idx, 0, cleanupStatement)
  } else {
    copy.unshift(cleanupStatement)
  }
  return copy
}

function applyJunctionTransitions(
  statements: string[],
  transitions: JunctionTransition[],
  isPostgres: boolean,
): string[] {
  let result = statements
  for (const jt of transitions) {
    if (jt.type === 'to-localized') {
      result = applyJunctionToLocalized(result, jt, isPostgres)
    } else {
      result = applyJunctionFromLocalized(result, jt, isPostgres)
    }
  }
  return result
}

function buildColumnTransitionStatements(trans: ColumnTransition, isPostgres: boolean): string[] {
  const { table, fromColumn, toColumn, type, wasNotNull, columnType } = trans
  if (isPostgres) {
    const rename = `ALTER TABLE "${table}" RENAME COLUMN "${fromColumn}" TO "${toColumn}";`
    if (type === 'to-localized' && wasNotNull) {
      return [rename, `ALTER TABLE "${table}" ALTER COLUMN "${toColumn}" DROP NOT NULL;`]
    }
    return [rename]
  }

  const rename = `ALTER TABLE \`${table}\` RENAME COLUMN \`${fromColumn}\` TO \`${toColumn}\`;`
  if (type === 'to-localized' && wasNotNull && columnType) {
    return [rename, `ALTER TABLE \`${table}\` MODIFY COLUMN \`${toColumn}\` ${columnType} NULL;`]
  }
  return [rename]
}

export function applyLocalizationMigrationStatements(
  sql: string,
  transitions: LocalizationTransitions,
  dialect?: string,
): { sql: string; applied: boolean } {
  if (transitions.columnTransitions.length === 0 && transitions.junctionTransitions.length === 0) {
    return { sql, applied: false }
  }

  const isPostgres = dialect === 'postgresql'
  let statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)

  statements = applyJunctionTransitions(statements, transitions.junctionTransitions, isPostgres)

  const byTable = new Map<string, ColumnTransition[]>()
  for (const trans of transitions.columnTransitions) {
    const list = byTable.get(trans.table) ?? []
    list.push(trans)
    byTable.set(trans.table, list)
  }

  for (const [table, list] of byTable.entries()) {
    const tableStmts = list.flatMap((t) => buildColumnTransitionStatements(t, isPostgres))
    statements = insertTableStatements(statements, table, tableStmts)
  }

  const updatedSql = statements.join('\n--> statement-breakpoint\n') + '\n'
  return { sql: updatedSql, applied: true }
}

export function inspectRemovedLocales(transitions: LocalizationTransitions): string[] {
  const warnings: string[] = []
  const byLocale = new Map<string, string[]>()
  for (const rem of transitions.removedLocales) {
    const list = byLocale.get(rem.locale) ?? []
    list.push(`${rem.table}.${rem.column}`)
    byLocale.set(rem.locale, list)
  }

  for (const [loc, cols] of byLocale.entries()) {
    warnings.push(
      `Migration drops locale "${loc}". All localized data in columns (${cols.join(', ')}) will be permanently deleted.`,
    )
  }
  return warnings
}
