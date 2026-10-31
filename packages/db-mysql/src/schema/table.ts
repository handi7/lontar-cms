import {
  double,
  int,
  mysqlTable,
  text,
  timestamp,
  varchar,
  type AnyMySqlColumn,
  type MySqlColumnBuilder,
  type MySqlTable,
} from 'drizzle-orm/mysql-core'
import type {
  CollectionConfig,
  EmailField,
  Field,
  NumberField,
  SlugField,
  TextareaField,
  TextField,
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

function fieldToColumn(name: string, field: Field) {
  if (field.type === 'text') return textToColumn(name, field)
  if (field.type === 'number') return numberToColumn(name, field)
  if (field.type === 'textarea') return textareaToColumn(name, field)
  if (field.type === 'email') return emailToColumn(name, field)
  if (field.type === 'slug') return slugToColumn(name, field)
  throw new Error(`Unsupported field type: ${(field as Field).type}`)
}

export type DynamicTable = MySqlTable & {
  id: AnyMySqlColumn
  createdAt: AnyMySqlColumn
  updatedAt: AnyMySqlColumn
  [field: string]: AnyMySqlColumn
}

export function collectionToTable(collection: CollectionConfig): DynamicTable {
  const columns: Record<string, MySqlColumnBuilder> = {
    id: int('id').autoincrement().primaryKey(),
  }

  for (const [name, field] of Object.entries(collection.fields)) {
    columns[name] = fieldToColumn(name, field)
  }

  columns.createdAt = timestamp('createdAt').defaultNow().notNull()
  columns.updatedAt = timestamp('updatedAt').defaultNow().onUpdateNow().notNull()

  return mysqlTable(collection.slug, columns) as unknown as DynamicTable
}
