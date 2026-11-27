import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTable,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core'
import {
  isLayoutField,
  type ArrayField,
  type BlocksField,
  type CheckboxField,
  type CodeField,
  type CollapsibleField,
  type CollectionConfig,
  type DateField,
  type EmailField,
  type Field,
  type Fields,
  type GlobalConfig,
  type JoinField,
  type JsonField,
  type LocaleConfig,
  type LocalizationConfig,
  type NumberField,
  type RadioField,
  type RelationshipField,
  type RichTextField,
  type RowField,
  type SelectField,
  type SlugField,
  type TabsField,
  type TextareaField,
  type TextField,
  type UploadField,
} from '@lontar/core'

export function getLocaleCodes(
  localization?: LocalizationConfig | readonly string[],
): readonly string[] {
  if (!localization) return []
  if (Array.isArray(localization)) {
    return (localization as readonly string[]).map((code: string): string => code)
  }
  const config = localization as LocalizationConfig
  if (Array.isArray(config.locales)) {
    return config.locales.map((loc: LocaleConfig): string =>
      typeof loc === 'string' ? loc : loc.code,
    )
  }
  return []
}

function isColumnRequired(field: Field): boolean {
  return Boolean(field.required && !field.admin?.condition && !field.localized)
}

function textToColumn(name: string, field: TextField) {
  if (field.hasMany) {
    const base = jsonb(name)
    const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
    return isColumnRequired(field) ? withDefault.notNull() : withDefault
  }
  const base = varchar(name, { length: field.maxLength ?? 255 })
  const defaultVal = typeof field.defaultValue === 'string' ? field.defaultValue : undefined
  const withDefault = defaultVal !== undefined ? base.default(defaultVal) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function numberToColumn(name: string, field: NumberField) {
  if (field.hasMany) {
    const base = jsonb(name)
    const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
    return isColumnRequired(field) ? withDefault.notNull() : withDefault
  }
  const base = field.integer ? integer(name) : doublePrecision(name)
  const defaultVal = typeof field.defaultValue === 'number' ? field.defaultValue : undefined
  const withDefault = defaultVal !== undefined ? base.default(defaultVal) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function textareaToColumn(name: string, field: TextareaField) {
  const base = text(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function codeToColumn(name: string, field: CodeField) {
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

function selectToColumn(name: string, field: SelectField | RadioField) {
  const base = varchar(name, { length: 120 })
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function dateToColumn(name: string, field: DateField) {
  const base = timestamp(name, { precision: 3, withTimezone: true, mode: 'date' })
  const withDefault =
    field.defaultValue !== undefined ? base.default(new Date(field.defaultValue)) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function richTextToColumn(name: string, field: RichTextField) {
  const base = jsonb(name)
  const withDefault = field.defaultValue !== undefined ? base.default(field.defaultValue) : base
  return isColumnRequired(field) ? withDefault.notNull() : withDefault
}

function relationshipToColumn(name: string, field: RelationshipField) {
  const base = integer(name)
  return isColumnRequired(field) ? base.notNull() : base
}

function uploadToColumn(name: string, field: UploadField) {
  const base = integer(name)
  return isColumnRequired(field) ? base.notNull() : base
}

function jsonFieldToColumn(name: string, field: ArrayField | BlocksField | JsonField) {
  const base = jsonb(name)
  return isColumnRequired(field) ? base.notNull() : base
}

function basicFieldToColumn(name: string, field: Field) {
  if (field.type === 'text') return textToColumn(name, field)
  if (field.type === 'number') return numberToColumn(name, field)
  if (field.type === 'textarea') return textareaToColumn(name, field)
  if (field.type === 'code') return codeToColumn(name, field)
  if (field.type === 'email') return emailToColumn(name, field)
  if (field.type === 'slug') return slugToColumn(name, field)
  return null
}

function advancedFieldToColumn(name: string, field: Field) {
  if (field.type === 'relationship') return relationshipToColumn(name, field)
  if (field.type === 'upload') return uploadToColumn(name, field)
  if (field.type === 'array' || field.type === 'blocks' || field.type === 'json') {
    return jsonFieldToColumn(name, field)
  }
  return null
}

function fieldToColumn(name: string, field: Field) {
  const basic = basicFieldToColumn(name, field)
  if (basic) return basic

  const advanced = advancedFieldToColumn(name, field)
  if (advanced) return advanced

  if (field.type === 'checkbox') return checkboxToColumn(name, field)
  if (field.type === 'select' || field.type === 'radio') return selectToColumn(name, field)
  if (field.type === 'date') return dateToColumn(name, field)
  if (field.type === 'richText') return richTextToColumn(name, field)
  if (field.type === 'point') return doublePrecision(name)
  throw new Error(`Unsupported field type: ${(field as Field).type}`)
}

export type DynamicTable = PgTable & {
  id: AnyPgColumn
  createdAt: AnyPgColumn
  updatedAt: AnyPgColumn
  [field: string]: AnyPgColumn
}

export type JunctionTable = PgTable & {
  id: AnyPgColumn
  parentId: AnyPgColumn
  relationTo?: AnyPgColumn
  targetId: AnyPgColumn
  order: AnyPgColumn
  _locale?: AnyPgColumn
}

export function getJunctionTableName(collectionSlug: string, fieldName: string): string {
  return `${collectionSlug}_${fieldName}`
}

export function getJunctionParentLocaleOrderIndexName(tableName: string): string {
  const baseName = `${tableName}_parent_locale_order_idx`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 50)}_${hash}_idx`
}

export function getJunctionParentLocaleTargetUniqueName(tableName: string): string {
  const baseName = `${tableName}_parent_locale_target_unique`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 47)}_${hash}_unique`
}

export function getVersionsTableName(collectionSlug: string): string {
  return `${collectionSlug}_versions`
}

export function getVersionsParentForeignKeyName(slug: string): string {
  const baseName = `${slug}_versions_parent_id_${slug}_id_fk`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 51)}_${hash}_fk`
}

export function getVersionsParentVersionUniqueName(slug: string): string {
  const baseName = `${slug}_versions_parent_version_unique`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 47)}_${hash}_unique`
}

export function getVersionsParentIdIndexName(slug: string): string {
  const baseName = `${slug}_versions_parent_id_idx`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 50)}_${hash}_idx`
}

export function getVersionsParentStatusIndexName(slug: string): string {
  const baseName = `${slug}_versions_parent_status_idx`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 50)}_${hash}_idx`
}

export function getVersionsFilenameIndexName(slug: string): string {
  const baseName = `${slug}_versions_filename_idx`
  if (baseName.length <= 63) {
    return baseName
  }
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, 8)
  return `${baseName.slice(0, 50)}_${hash}_idx`
}

export type VersionsTable = PgTable & {
  id: AnyPgColumn
  parentId: AnyPgColumn
  versionNumber: AnyPgColumn
  snapshot: AnyPgColumn
  _status: AnyPgColumn
  autosave: AnyPgColumn
  createdAt: AnyPgColumn
  createdBy: AnyPgColumn
}

export function createVersionsTable(
  collectionSlug: string,
  parentTable?: DynamicTable,
  isUpload = false,
): VersionsTable {
  const tableName = getVersionsTableName(collectionSlug)
  const fkName = getVersionsParentForeignKeyName(collectionSlug)
  const uniqueName = getVersionsParentVersionUniqueName(collectionSlug)
  const parentIdIdxName = getVersionsParentIdIndexName(collectionSlug)
  const parentStatusIdxName = getVersionsParentStatusIndexName(collectionSlug)
  const filenameIdxName = getVersionsFilenameIndexName(collectionSlug)

  const columns = {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    _status: varchar('_status', { length: 20 }).default('draft').notNull(),
    autosave: boolean('autosave').default(false).notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    createdBy: varchar('created_by', { length: 36 }),
  }

  return pgTable(tableName, columns, (t) => {
    const extra: PgTableExtraConfigValue[] = [
      index(parentIdIdxName).on(t.parentId, t.id),
      index(parentStatusIdxName).on(t.parentId, t._status),
      unique(uniqueName).on(t.parentId, t.versionNumber),
    ]
    if (isUpload) {
      extra.push(index(filenameIdxName).on(sql`(${t.snapshot}->>'filename')`))
    }
    if (parentTable) {
      extra.push(
        foreignKey({
          name: fkName,
          columns: [t.parentId] as [AnyPgColumn],
          foreignColumns: [parentTable.id] as [AnyPgColumn],
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
  return createVersionsTable(collection.slug, parentTable, Boolean(collection.upload))
}

export function getGlobalVersionsTable(
  global: GlobalConfig,
  parentTable?: DynamicTable,
): VersionsTable | null {
  if (!global.versions) return null
  return createVersionsTable(global.slug, parentTable)
}

function createLocalizedJunctionTable(tableName: string, isPolymorphic: boolean): JunctionTable {
  const parentLocaleOrderIdx = getJunctionParentLocaleOrderIndexName(tableName)
  const targetIdx = `${tableName}_target_idx`
  const parentLocaleTargetUnique = getJunctionParentLocaleTargetUniqueName(tableName)
  if (isPolymorphic) {
    return pgTable(
      tableName,
      {
        id: serial('id').primaryKey(),
        parentId: integer('parent_id').notNull(),
        relationTo: varchar('relation_to', { length: 255 }).notNull(),
        targetId: integer('target_id').notNull(),
        _locale: varchar('_locale', { length: 10 }).notNull(),
        order: integer('order').default(0).notNull(),
      },
      (t) => [
        index(parentLocaleOrderIdx).on(t.parentId, t._locale, t.order),
        index(targetIdx).on(t.relationTo, t.targetId),
        unique(parentLocaleTargetUnique).on(t.parentId, t._locale, t.relationTo, t.targetId),
      ],
    )
  }
  return pgTable(
    tableName,
    {
      id: serial('id').primaryKey(),
      parentId: integer('parent_id').notNull(),
      targetId: integer('target_id').notNull(),
      _locale: varchar('_locale', { length: 10 }).notNull(),
      order: integer('order').default(0).notNull(),
    },
    (t) => [
      index(parentLocaleOrderIdx).on(t.parentId, t._locale, t.order),
      index(targetIdx).on(t.targetId),
      unique(parentLocaleTargetUnique).on(t.parentId, t._locale, t.targetId),
    ],
  )
}

function createStandardJunctionTable(tableName: string, isPolymorphic: boolean): JunctionTable {
  if (isPolymorphic) {
    return pgTable(
      tableName,
      {
        id: serial('id').primaryKey(),
        parentId: integer('parent_id').notNull(),
        relationTo: varchar('relation_to', { length: 255 }).notNull(),
        targetId: integer('target_id').notNull(),
        order: integer('order').default(0).notNull(),
      },
      (t) => [
        index(`${tableName}_parent_idx`).on(t.parentId),
        index(`${tableName}_target_idx`).on(t.relationTo, t.targetId),
        unique(`${tableName}_parent_target_unique`).on(t.parentId, t.relationTo, t.targetId),
      ],
    )
  }
  return pgTable(
    tableName,
    {
      id: serial('id').primaryKey(),
      parentId: integer('parent_id').notNull(),
      targetId: integer('target_id').notNull(),
      order: integer('order').default(0).notNull(),
    },
    (t) => [
      index(`${tableName}_parent_idx`).on(t.parentId),
      index(`${tableName}_target_idx`).on(t.targetId),
      unique(`${tableName}_parent_target_unique`).on(t.parentId, t.targetId),
    ],
  )
}

export function createJunctionTable(
  tableName: string,
  isLocalized = false,
  isPolymorphic = false,
): JunctionTable {
  if (isLocalized) {
    return createLocalizedJunctionTable(tableName, isPolymorphic)
  }
  return createStandardJunctionTable(tableName, isPolymorphic)
}

export interface FlattenedColumnField {
  name: string
  path: string[]
  field: Field
}

function resolveFlattenedField(field: Field, isConditional: boolean, isLocalized: boolean): Field {
  if (isLayoutField(field) || field.type === 'join') return field
  let resolved: Exclude<Field, TabsField | RowField | CollapsibleField | JoinField> = field
  if (isConditional && !resolved.admin?.condition) {
    resolved = { ...resolved, admin: { ...resolved.admin, condition: {} } }
  }
  if (isLocalized && !resolved.localized) {
    resolved = { ...resolved, localized: true }
  }
  return resolved
}

function flattenLayoutColumnFields(
  field: TabsField | RowField | CollapsibleField,
  prefix: string,
  pathPrefix: string[],
  isConditional: boolean,
  isLocalized: boolean,
): FlattenedColumnField[] {
  if (field.type === 'tabs') {
    const result: FlattenedColumnField[] = []
    for (const tab of field.tabs) {
      const tabConditional = isConditional || Boolean(tab.admin?.condition)
      result.push(
        ...flattenGroupFields(tab.fields, prefix, pathPrefix, tabConditional, isLocalized),
      )
    }
    return result
  }
  return flattenGroupFields(field.fields, prefix, pathPrefix, isConditional, isLocalized)
}

function expandPointColumns(
  colName: string,
  currentPath: string[],
  field: Field & { type: 'point' },
  isLocalized: boolean,
): FlattenedColumnField[] {
  return [
    {
      name: `${colName}__lng`,
      path: [...currentPath, 'lng'],
      field: {
        type: 'number',
        name: `${colName}__lng`,
        required: isColumnRequired(field),
        defaultValue: field.defaultValue ? field.defaultValue[0] : undefined,
        admin: field.admin,
        localized: isLocalized,
      } as unknown as Field,
    },
    {
      name: `${colName}__lat`,
      path: [...currentPath, 'lat'],
      field: {
        type: 'number',
        name: `${colName}__lat`,
        required: isColumnRequired(field),
        defaultValue: field.defaultValue ? field.defaultValue[1] : undefined,
        admin: field.admin,
        localized: isLocalized,
      } as unknown as Field,
    },
  ]
}

function expandPolymorphicColumns(
  colName: string,
  currentPath: string[],
  field: Field,
  isLocalized: boolean,
): FlattenedColumnField[] {
  return [
    {
      name: `${colName}__relation_to`,
      path: [...currentPath, 'relationTo'],
      field: {
        type: 'text',
        maxLength: 255,
        required: isColumnRequired(field),
        admin: field.admin,
        localized: isLocalized,
      } as unknown as Field,
    },
    {
      name: `${colName}__id`,
      path: [...currentPath, 'value'],
      field: {
        type: 'number',
        integer: true,
        required: isColumnRequired(field),
        admin: field.admin,
        localized: isLocalized,
      } as unknown as Field,
    },
  ]
}

function isSinglePolymorphicField(field: Field): boolean {
  return field.type === 'relationship' && !field.hasMany && Array.isArray(field.relationTo)
}

function flattenFieldEntry(
  name: string,
  field: Field,
  prefix: string,
  pathPrefix: string[],
  parentConditional: boolean,
  parentLocalized: boolean,
): FlattenedColumnField[] {
  const colName = prefix ? `${prefix}__${name}` : name
  const currentPath = [...pathPrefix, name]
  const isConditional = parentConditional || Boolean(field.admin?.condition)
  const isLocalized = parentLocalized || Boolean(field.localized)
  if (isLayoutField(field)) {
    return flattenLayoutColumnFields(field, prefix, pathPrefix, isConditional, isLocalized)
  }
  if (field.type === 'join') {
    return []
  }
  if (field.type === 'group') {
    return flattenGroupFields(field.fields, colName, currentPath, isConditional, isLocalized)
  }
  if (field.type === 'point') {
    return expandPointColumns(colName, currentPath, field, isLocalized)
  }
  if (isSinglePolymorphicField(field)) {
    return expandPolymorphicColumns(colName, currentPath, field, isLocalized)
  }
  return [
    {
      name: colName,
      path: currentPath,
      field: resolveFlattenedField(field, isConditional, isLocalized),
    },
  ]
}

export function flattenGroupFields(
  fields: Fields,
  prefix = '',
  pathPrefix: string[] = [],
  parentConditional = false,
  parentLocalized = false,
): FlattenedColumnField[] {
  const result: FlattenedColumnField[] = []
  for (const [name, field] of Object.entries(fields)) {
    result.push(
      ...flattenFieldEntry(name, field, prefix, pathPrefix, parentConditional, parentLocalized),
    )
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
      tables[name] = createJunctionTable(
        tableName,
        Boolean(field.localized),
        Array.isArray(field.relationTo),
      )
    }
  }
  return tables
}

function addUploadColumns(columns: Record<string, PgColumnBuilderBase>): void {
  columns.filename = varchar('filename', { length: 255 }).notNull()
  columns.url = varchar('url', { length: 1024 }).notNull()
  columns.mimeType = varchar('mimeType', { length: 255 }).notNull()
  columns.filesize = integer('filesize').notNull()
  columns.width = integer('width')
  columns.height = integer('height')
  columns.sizes = jsonb('sizes')
}

function addFieldColumns(
  columns: Record<string, PgColumnBuilderBase>,
  fields: Fields,
  localeCodes: readonly string[],
): void {
  const flatFields = flattenGroupFields(fields)
  for (const { name, field } of flatFields) {
    if (field.type === 'relationship' && field.hasMany) {
      continue
    }
    if (field.localized && localeCodes.length > 0) {
      const colField = { ...field, required: false }
      for (const locale of localeCodes) {
        const colName = `${name}_${locale}`
        columns[colName] = fieldToColumn(colName, colField)
      }
    } else {
      columns[name] = fieldToColumn(name, field)
    }
  }
}

function createTable(
  slug: string,
  fields: Fields,
  isUpload = false,
  hasDrafts = false,
  localization?: LocalizationConfig | readonly string[],
): DynamicTable {
  const columns: Record<string, PgColumnBuilderBase> = {
    id: serial('id').primaryKey(),
  }

  if (hasDrafts) {
    columns._status = varchar('_status', { length: 20 }).default('draft').notNull()
  }

  if (isUpload) {
    addUploadColumns(columns)
  }

  const localeCodes = getLocaleCodes(localization)
  addFieldColumns(columns, fields, localeCodes)

  columns.createdAt = timestamp('createdAt', { precision: 3, withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull()
  columns.updatedAt = timestamp('updatedAt', { precision: 3, withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull()

  if (hasDrafts) {
    return pgTable(slug, columns, (t) => [
      index(`${slug}__status_idx`).on(t._status as AnyPgColumn),
    ]) as unknown as DynamicTable
  }

  return pgTable(slug, columns) as unknown as DynamicTable
}

export function collectionToTable(
  collection: CollectionConfig,
  localization?: LocalizationConfig | readonly string[],
): DynamicTable {
  return createTable(
    collection.slug,
    collection.fields,
    Boolean(collection.upload),
    Boolean(collection.versions?.drafts),
    localization,
  )
}

export function globalToTable(
  global: GlobalConfig,
  localization?: LocalizationConfig | readonly string[],
): DynamicTable {
  return createTable(
    global.slug,
    global.fields,
    false,
    Boolean(global.versions?.drafts),
    localization,
  )
}
