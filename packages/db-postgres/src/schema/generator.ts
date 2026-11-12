import { createRequire } from 'node:module'
import type {
  ArrayField,
  BlocksField,
  CheckboxField,
  CollectionConfig,
  Config,
  DateField,
  EmailField,
  Field,
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
import {
  flattenGroupFields,
  getJunctionTableName,
  getVersionsParentForeignKeyName,
  getVersionsParentIdIndexName,
  getVersionsParentStatusIndexName,
  getVersionsParentVersionUniqueName,
} from './table'

export function resolveDrizzleOrmPgCore(): string {
  try {
    const req = createRequire(import.meta.url)
    return req.resolve('drizzle-orm/pg-core').replace(/\\/g, '/')
  } catch {
    return 'drizzle-orm/pg-core'
  }
}

export function slugToIdentifier(slug: string): string {
  return slug.replace(/[-_]([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function isColumnRequired(field: Field): boolean {
  return Boolean(field.required && !field.admin?.condition)
}

function renderTextField(name: string, field: TextField): string {
  const length = field.maxLength ?? 255
  let code = `varchar('${name}', { length: ${length} })`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderNumberField(name: string, field: NumberField): string {
  let code = field.integer ? `integer('${name}')` : `doublePrecision('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${field.defaultValue})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderTextareaField(name: string, field: TextareaField): string {
  let code = `text('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderEmailField(name: string, field: EmailField): string {
  let code = `varchar('${name}', { length: 255 })`
  if (field.unique) {
    code += '.unique()'
  }
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderSlugField(name: string, field: SlugField): string {
  let code = `varchar('${name}', { length: 255 })`
  if (field.unique) {
    code += '.unique()'
  }
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderCheckboxField(name: string, field: CheckboxField): string {
  let code = `boolean('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${field.defaultValue})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderSelectField(name: string, field: SelectField): string {
  let code = `varchar('${name}', { length: 120 })`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderDateField(name: string, field: DateField): string {
  let code = `timestamp('${name}', { precision: 3, withTimezone: true, mode: 'date' })`
  if (field.defaultValue !== undefined) {
    code += `.default(new Date(${JSON.stringify(field.defaultValue)}))`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderRichTextField(name: string, field: RichTextField): string {
  let code = `jsonb('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderRelationshipField(name: string, field: RelationshipField): string {
  let code = `integer('${name}')`
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderUploadField(name: string, field: UploadField): string {
  let code = `integer('${name}')`
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderArrayField(name: string, field: ArrayField | BlocksField): string {
  let code = `jsonb('${name}')`
  if (isColumnRequired(field)) {
    code += '.notNull()'
  }
  return code
}

function renderBasicField(name: string, field: Field): string | null {
  if (field.type === 'text') return renderTextField(name, field)
  if (field.type === 'number') return renderNumberField(name, field)
  if (field.type === 'textarea') return renderTextareaField(name, field)
  if (field.type === 'email') return renderEmailField(name, field)
  if (field.type === 'slug') return renderSlugField(name, field)
  return null
}

function renderField(name: string, field: Field): string {
  const basic = renderBasicField(name, field)
  if (basic) return basic

  if (field.type === 'checkbox') return renderCheckboxField(name, field)
  if (field.type === 'select') return renderSelectField(name, field)
  if (field.type === 'date') return renderDateField(name, field)
  if (field.type === 'richText') return renderRichTextField(name, field)
  if (field.type === 'relationship') return renderRelationshipField(name, field)
  if (field.type === 'upload') return renderUploadField(name, field)
  if (field.type === 'array' || field.type === 'blocks') return renderArrayField(name, field)
  throw new Error(`Unsupported field type: ${(field as Field).type}`)
}

const FIELD_TYPE_IMPORTS: Record<string, string> = {
  text: 'varchar',
  email: 'varchar',
  slug: 'varchar',
  select: 'varchar',
  textarea: 'text',
  checkbox: 'boolean',
  date: 'timestamp',
  richText: 'jsonb',
  relationship: 'integer',
  upload: 'integer',
  array: 'jsonb',
  blocks: 'jsonb',
}

function collectFieldImports(field: Field, imports: Set<string>): void {
  if (field.type === 'group') {
    for (const subField of Object.values(field.fields)) {
      collectFieldImports(subField, imports)
    }
    return
  }
  const imp = FIELD_TYPE_IMPORTS[field.type]
  if (imp) {
    imports.add(imp)
  }
  if (field.type === 'number') {
    imports.add(field.integer ? 'integer' : 'doublePrecision')
  }
}

const AUTH_BASE_IMPORTS = [
  'boolean',
  'index',
  'integer',
  'pgTable',
  'serial',
  'text',
  'timestamp',
  'varchar',
] as const

function collectEntityImports(entity: CollectionConfig | GlobalConfig, imports: Set<string>): void {
  const isUpload = 'upload' in entity && Boolean(entity.upload)
  if (isUpload || entity.versions) {
    imports.add('jsonb')
  }
  if (entity.versions) {
    imports.add('foreignKey')
    imports.add('unique')
  }
  for (const field of Object.values(entity.fields)) {
    collectFieldImports(field, imports)
  }
}

function collectImports(
  collections: readonly CollectionConfig[],
  globals: readonly GlobalConfig[] = [],
): string[] {
  const imports = new Set<string>(AUTH_BASE_IMPORTS)
  if (findJunctionTableNames(collections).length > 0) {
    imports.add('unique')
  }
  for (const collection of collections) {
    collectEntityImports(collection, imports)
  }
  for (const global of globals) {
    collectEntityImports(global, imports)
  }
  return Array.from(imports).sort()
}

function renderTableDefinition(
  slug: string,
  fields: Record<string, Field>,
  isUpload = false,
  hasDrafts = false,
): string {
  const identifier = slugToIdentifier(slug)
  const lines: string[] = ["  id: serial('id').primaryKey(),"]

  if (hasDrafts) {
    lines.push("  _status: varchar('_status', { length: 20 }).default('draft').notNull(),")
  }

  if (isUpload) {
    lines.push("  filename: varchar('filename', { length: 255 }).notNull(),")
    lines.push("  url: varchar('url', { length: 1024 }).notNull(),")
    lines.push("  mimeType: varchar('mimeType', { length: 255 }).notNull(),")
    lines.push("  filesize: integer('filesize').notNull(),")
    lines.push("  width: integer('width'),")
    lines.push("  height: integer('height'),")
    lines.push("  sizes: jsonb('sizes'),")
  }

  const flatFields = flattenGroupFields(fields)
  for (const { name, field } of flatFields) {
    if (field.type === 'relationship' && field.hasMany) {
      continue
    }
    lines.push(`  ${name}: ${renderField(name, field)},`)
  }

  lines.push(
    "  createdAt: timestamp('createdAt', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),",
  )
  lines.push(
    "  updatedAt: timestamp('updatedAt', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),",
  )

  if (hasDrafts) {
    return `export const ${identifier} = pgTable(\n  '${slug}',\n  {\n${lines.join('\n')}\n  },\n  (t) => [index('${slug}__status_idx').on(t._status)],\n)`
  }

  return `export const ${identifier} = pgTable('${slug}', {\n${lines.join('\n')}\n})`
}

function renderCollection(collection: CollectionConfig): string {
  return renderTableDefinition(
    collection.slug,
    collection.fields,
    Boolean(collection.upload),
    Boolean(collection.versions?.drafts),
  )
}

function renderGlobal(global: GlobalConfig): string {
  return renderTableDefinition(global.slug, global.fields, false, Boolean(global.versions?.drafts))
}

function renderAuthTables(): string {
  return `export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { precision: 3, withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      precision: 3,
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      precision: 3,
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { precision: 3, withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)`
}

function renderJunctionTable(tableName: string): string {
  const identifier = slugToIdentifier(tableName)
  return `export const ${identifier} = pgTable(
  '${tableName}',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').notNull(),
    targetId: integer('target_id').notNull(),
    order: integer('order').default(0).notNull(),
  },
  (table) => [
    index('${tableName}_parent_idx').on(table.parentId),
    index('${tableName}_target_idx').on(table.targetId),
    unique('${tableName}_parent_target_unique').on(table.parentId, table.targetId),
  ],
)`
}

function findJunctionTableNames(collections: readonly CollectionConfig[]): string[] {
  const names: string[] = []
  for (const col of collections) {
    for (const { name, field } of flattenGroupFields(col.fields)) {
      if (field.type === 'relationship' && field.hasMany) {
        names.push(getJunctionTableName(col.slug, name))
      }
    }
  }
  return names
}

function renderJunctionTables(collections: readonly CollectionConfig[]): string {
  return findJunctionTableNames(collections).map(renderJunctionTable).join('\n\n')
}

function renderVersionsTable(entity: CollectionConfig | GlobalConfig): string {
  const identifier = slugToIdentifier(entity.slug)
  const versionsIdentifier = `${identifier}Versions`
  const tableName = `${entity.slug}_versions`
  const fkName = getVersionsParentForeignKeyName(entity.slug)
  const uniqueName = getVersionsParentVersionUniqueName(entity.slug)
  const parentIdIdxName = getVersionsParentIdIndexName(entity.slug)
  const parentStatusIdxName = getVersionsParentStatusIndexName(entity.slug)

  return `export const ${versionsIdentifier} = pgTable(
  '${tableName}',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    _status: varchar('_status', { length: 20 }).default('draft').notNull(),
    autosave: boolean('autosave').default(false).notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    createdBy: varchar('created_by', { length: 36 }),
  },
  (t) => [
    index('${parentIdIdxName}').on(t.parentId, t.id),
    index('${parentStatusIdxName}').on(t.parentId, t._status),
    unique('${uniqueName}').on(t.parentId, t.versionNumber),
    foreignKey({
      name: '${fkName}',
      columns: [t.parentId],
      foreignColumns: [${identifier}.id],
    }).onDelete('cascade'),
  ],
)`
}

function renderVersionsTables(
  collections: readonly CollectionConfig[],
  globals: readonly GlobalConfig[] = [],
): string {
  const versionedEntities: Array<CollectionConfig | GlobalConfig> = [
    ...collections.filter((col) => Boolean(col.versions)),
    ...globals.filter((g) => Boolean(g.versions)),
  ]
  return versionedEntities.map(renderVersionsTable).join('\n\n')
}

export function generateSchemaFile(config: Config): string {
  const globals = config.globals ?? []
  const imports = collectImports(config.collections, globals)
  const ormModule = resolveDrizzleOrmPgCore()
  const header = `// Generated by @lontar/db-postgres. Do not edit directly.\nimport { ${imports.join(', ')} } from '${ormModule}'\n`
  const authSection = renderAuthTables()
  const collectionSection = config.collections.map(renderCollection).join('\n\n')
  const versionsSection = renderVersionsTables(config.collections, globals)
  const globalSection = globals.map(renderGlobal).join('\n\n')
  const junctionSection = renderJunctionTables(config.collections)
  const sections = [
    authSection,
    collectionSection,
    versionsSection,
    globalSection,
    junctionSection,
  ].filter(Boolean)
  return `${header}\n${sections.join('\n\n')}\n`
}
