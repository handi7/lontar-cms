import {
  boolean,
  double,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  varchar,
  type AnyMySqlColumn,
  type MySqlColumnBuilder,
  type MySqlTable,
} from 'drizzle-orm/mysql-core'
import type {
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

function textToColumn(name: string, field: TextField) {
  const base = varchar(name, { length: field.maxLength ?? 255 })
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return field.required ? withDefault.notNull() : withDefault
}

function numberToColumn(name: string, field: NumberField) {
  const base = field.integer ? int(name) : double(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return field.required ? withDefault.notNull() : withDefault
}

function textareaToColumn(name: string, field: TextareaField) {
  const base = text(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return field.required ? withDefault.notNull() : withDefault
}

function emailToColumn(name: string, field: EmailField) {
  const base = varchar(name, { length: 255 })
  const withUnique = field.unique ? base.unique() : base
  const withDefault =
    field.defaultValue !== undefined ? withUnique.default(field.defaultValue) : withUnique
  return field.required ? withDefault.notNull() : withDefault
}

function slugToColumn(name: string, field: SlugField) {
  const base = varchar(name, { length: 255 })
  const withUnique = field.unique ? base.unique() : base
  const withDefault =
    field.defaultValue !== undefined ? withUnique.default(field.defaultValue) : withUnique
  return field.required ? withDefault.notNull() : withDefault
}

function checkboxToColumn(name: string, field: CheckboxField) {
  const base = boolean(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return field.required ? withDefault.notNull() : withDefault
}

function selectToColumn(name: string, field: SelectField) {
  const base = varchar(name, { length: 120 })
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return field.required ? withDefault.notNull() : withDefault
}

function dateToColumn(name: string, field: DateField) {
  const base = timestamp(name)
  const withDefault =
    field.defaultValue !== undefined ? base.default(new Date(field.defaultValue)) : base
  return field.required ? withDefault.notNull() : withDefault
}

function richTextToColumn(name: string, field: RichTextField) {
  const base = json(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return field.required ? withDefault.notNull() : withDefault
}

function relationshipToColumn(name: string, field: RelationshipField) {
  const base = int(name)
  return field.required ? base.notNull() : base
}

function uploadToColumn(name: string, field: UploadField) {
  const base = int(name)
  return field.required ? base.notNull() : base
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

export function createJunctionTable(tableName: string): JunctionTable {
  const columns = {
    id: int('id').autoincrement().primaryKey(),
    parentId: int('parent_id').notNull(),
    targetId: int('target_id').notNull(),
    order: int('order').default(0).notNull(),
  }
  return mysqlTable(tableName, columns)
}

export function getCollectionJunctionTables(
  collection: CollectionConfig,
): Record<string, JunctionTable> {
  const tables: Record<string, JunctionTable> = {}
  for (const [name, field] of Object.entries(collection.fields)) {
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

function createTable(slug: string, fields: Fields, isUpload = false): DynamicTable {
  const columns: Record<string, MySqlColumnBuilder> = {
    id: int('id').autoincrement().primaryKey(),
  }

  if (isUpload) {
    addUploadColumns(columns)
  }

  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'relationship' && field.hasMany) {
      continue
    }
    columns[name] = fieldToColumn(name, field)
  }

  columns.createdAt = timestamp('createdAt').defaultNow().notNull()
  columns.updatedAt = timestamp('updatedAt').defaultNow().onUpdateNow().notNull()

  return mysqlTable(slug, columns) as unknown as DynamicTable
}

export function collectionToTable(collection: CollectionConfig): DynamicTable {
  return createTable(collection.slug, collection.fields, Boolean(collection.upload))
}

export function globalToTable(global: GlobalConfig): DynamicTable {
  return createTable(global.slug, global.fields)
}
