import { createHash } from 'node:crypto'
import {
  boolean,
  datetime,
  double,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
  type AnyMySqlColumn,
  type MySqlColumnBuilder,
  type MySqlTable,
  type MySqlTableExtraConfigValue,
} from 'drizzle-orm/mysql-core'
import type {
  ArrayField,
  BlocksField,
  CheckboxField,
  CollectionConfig,
  DateField,
  EmailField,
  Field,
  Fields,
  GlobalConfig,
  NumberField,
  RelationshipField,
  RichTextField,
  SelectField,
  SlugField,
  TextareaField,
  TextField,
  UploadField,
} from '@lontar/core'

function isColumnRequired(field: Field): boolean {
  return Boolean(field.required && !field.admin?.condition)
}

function textToColumn(name: string, field: TextField) {
  const base = varchar(name, { length: field.maxLength ?? 255 })
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function numberToColumn(name: string, field: NumberField) {
  const base = field.integer ? int(name) : double(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function textareaToColumn(name: string, field: TextareaField) {
  const base = text(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function emailToColumn(name: string, field: EmailField) {
  const base = varchar(name, { length: 255 })
  const withUnique = field.unique ? base.unique() : base
  const withDefault =
    field.defaultValue !== undefined ? withUnique.default(field.defaultValue) : withUnique
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function slugToColumn(name: string, field: SlugField) {
  const base = varchar(name, { length: 255 })
  const withUnique = field.unique ? base.unique() : base
  const withDefault =
    field.defaultValue !== undefined ? withUnique.default(field.defaultValue) : withUnique
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function checkboxToColumn(name: string, field: CheckboxField) {
  const base = boolean(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function selectToColumn(name: string, field: SelectField) {
  const base = varchar(name, { length: 120 })
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function dateToColumn(name: string, field: DateField) {
  const base = datetime(name, { mode: 'date', fsp: 3 })
  const withDefault =
    field.defaultValue !== undefined ? base.default(new Date(field.defaultValue)) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function richTextToColumn(name: string, field: RichTextField) {
  const base = json(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function relationshipToColumn(name: string, field: RelationshipField) {
  const base = int(name)
  return isColumnRequired(field) ? base.notNull() : base
}

function uploadToColumn(name: string, field: UploadField) {
  const base = int(name)
  return isColumnRequired(field) ? base.notNull() : base
}

function jsonFieldToColumn(name: string, field: ArrayField | BlocksField) {
  const base = json(name)
  return isColumnRequired(field) ? base.notNull() : base
}

function basicFieldToColumn(name: string, field: Field) {
  if (field.type === 'text') return textToColumn(name, field)
  if (field.type === 'number') return numberToColumn(name, field)
  if (field.type === 'textarea') return textareaToColumn(name, field)
  if (field.type === 'email') return emailToColumn(name, field)
  if (field.type === 'slug') return slugToColumn(name, field)
  return null
}

function fieldToColumn(name: string, field: Field) {
  const basic = basicFieldToColumn(name, field)
  if (basic) return basic

  if (field.type === 'checkbox') return checkboxToColumn(name, field)
  if (field.type === 'select') return selectToColumn(name, field)
  if (field.type === 'date') return dateToColumn(name, field)
  if (field.type === 'richText') return richTextToColumn(name, field)
  if (field.type === 'relationship') return relationshipToColumn(name, field)
  if (field.type === 'upload') return uploadToColumn(name, field)
  if (field.type === 'array' || field.type === 'blocks') return jsonFieldToColumn(name, field)
  throw new Error(`Unsupported field type: ${(field as Field).type}`)
}

export type DynamicTable = MySqlTable & {
  id: AnyMySqlColumn
  createdAt: AnyMySqlColumn
  updatedAt: AnyMySqlColumn
  [field: string]: AnyMySqlColumn
}

export type JunctionTable = MySqlTable & {
  id: AnyMySqlColumn
  parentId: AnyMySqlColumn
  targetId: AnyMySqlColumn
  order: AnyMySqlColumn
}

export function getJunctionTableName(collectionSlug: string, fieldName: string): string {
  return `${collectionSlug}_${fieldName}`
}

export function getVersionsTableName(collectionSlug: string): string {
  return `${collectionSlug}_versions`
}

export function getVersionsParentForeignKeyName(slug: string): string {
  const baseName = `${slug}_versions_parent_id_${slug}_id_fk`
  if (baseName.length <= 64) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 52)}_${hash}_fk`
}

export type VersionsTable = MySqlTable & {
  id: AnyMySqlColumn
  parentId: AnyMySqlColumn
  versionNumber: AnyMySqlColumn
  snapshot: AnyMySqlColumn
  _status: AnyMySqlColumn
  autosave: AnyMySqlColumn
  createdAt: AnyMySqlColumn
  createdBy: AnyMySqlColumn
}

export function createVersionsTable(
  collectionSlug: string,
  parentTable?: DynamicTable,
): VersionsTable {
  const tableName = getVersionsTableName(collectionSlug)
  const fkName = getVersionsParentForeignKeyName(collectionSlug)

  const columns = {
    id: int('id').autoincrement().primaryKey(),
    parentId: int('parent_id').notNull(),
    versionNumber: int('version_number').notNull(),
    snapshot: json('snapshot').notNull(),
    _status: varchar('_status', { length: 20 }).default('draft').notNull(),
    autosave: boolean('autosave').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdBy: varchar('created_by', { length: 36 }),
  }

  return mysqlTable(tableName, columns, (t) => {
    const extra: MySqlTableExtraConfigValue[] = [
      index(`${tableName}_parent_id_idx`).on(t.parentId, t.id),
      index(`${tableName}_parent_status_idx`).on(t.parentId, t._status),
    ]
    if (parentTable) {
      extra.push(
        foreignKey({
          name: fkName,
          columns: [t.parentId] as [AnyMySqlColumn],
          foreignColumns: [parentTable.id] as [AnyMySqlColumn],
        }).onDelete('cascade'),
      )
    }
    return extra
  })
}

export function getCollectionVersionsTable(
  collection: CollectionConfig,
  parentTable?: DynamicTable,
): VersionsTable | null {
  if (!collection.versions) return null
  return createVersionsTable(collection.slug, parentTable)
}

export function getGlobalVersionsTable(
  global: GlobalConfig,
  parentTable?: DynamicTable,
): VersionsTable | null {
  if (!global.versions) return null
  return createVersionsTable(global.slug, parentTable)
}

export function createJunctionTable(tableName: string): JunctionTable {
  const columns = {
    id: int('id').autoincrement().primaryKey(),
    parentId: int('parent_id').notNull(),
    targetId: int('target_id').notNull(),
    order: int('order').default(0).notNull(),
  }
  return mysqlTable(tableName, columns, (t) => [
    index(`${tableName}_parent_idx`).on(t.parentId),
    index(`${tableName}_target_idx`).on(t.targetId),
    unique(`${tableName}_parent_target_unique`).on(t.parentId, t.targetId),
  ])
}

export interface FlattenedColumnField {
  name: string
  path: string[]
  field: Field
}

function resolveFlattenedField(field: Field, isConditional: boolean): Field {
  if (isConditional && !field.admin?.condition) {
    return { ...field, admin: { ...field.admin, condition: {} } }
  }
  return field
}

export function flattenGroupFields(
  fields: Fields,
  prefix = '',
  pathPrefix: string[] = [],
  parentConditional = false,
): FlattenedColumnField[] {
  const result: FlattenedColumnField[] = []
  for (const [name, field] of Object.entries(fields)) {
    const colName = prefix ? `${prefix}__${name}` : name
    const currentPath = [...pathPrefix, name]
    const isConditional = parentConditional || Boolean(field.admin?.condition)
    if (field.type === 'group') {
      result.push(...flattenGroupFields(field.fields, colName, currentPath, isConditional))
    } else {
      result.push({
        name: colName,
        path: currentPath,
        field: resolveFlattenedField(field, isConditional),
      })
    }
  }
  return result
}

export function getCollectionJunctionTables(
  collection: CollectionConfig,
): Record<string, JunctionTable> {
  const tables: Record<string, JunctionTable> = {}
  for (const { name, field } of flattenGroupFields(collection.fields)) {
    if (field.type === 'relationship' && field.hasMany) {
      const tableName = getJunctionTableName(collection.slug, name)
      tables[name] = createJunctionTable(tableName)
    }
  }
  return tables
}

function addUploadColumns(columns: Record<string, MySqlColumnBuilder>): void {
  columns.filename = varchar('filename', { length: 255 }).notNull()
  columns.url = varchar('url', { length: 1024 }).notNull()
  columns.mimeType = varchar('mimeType', { length: 255 }).notNull()
  columns.filesize = int('filesize').notNull()
  columns.width = int('width')
  columns.height = int('height')
  columns.sizes = json('sizes')
}

function createTable(
  slug: string,
  fields: Fields,
  isUpload = false,
  hasDrafts = false,
): DynamicTable {
  const columns: Record<string, MySqlColumnBuilder> = {
    id: int('id').autoincrement().primaryKey(),
  }

  if (hasDrafts) {
    columns._status = varchar('_status', { length: 20 }).default('draft').notNull()
  }

  if (isUpload) {
    addUploadColumns(columns)
  }

  const flatFields = flattenGroupFields(fields)
  for (const { name, field } of flatFields) {
    if (field.type === 'relationship' && field.hasMany) {
      continue
    }
    columns[name] = fieldToColumn(name, field)
  }

  columns.createdAt = timestamp('createdAt').defaultNow().notNull()
  columns.updatedAt = timestamp('updatedAt').defaultNow().onUpdateNow().notNull()

  if (hasDrafts) {
    return mysqlTable(slug, columns, (t) => [
      index(`${slug}__status_idx`).on(t._status as AnyMySqlColumn),
    ]) as unknown as DynamicTable
  }

  return mysqlTable(slug, columns) as unknown as DynamicTable
}

export function collectionToTable(collection: CollectionConfig): DynamicTable {
  return createTable(
    collection.slug,
    collection.fields,
    Boolean(collection.upload),
    Boolean(collection.versions?.drafts),
  )
}

export function globalToTable(global: GlobalConfig): DynamicTable {
  return createTable(global.slug, global.fields, false, Boolean(global.versions?.drafts))
}
