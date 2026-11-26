import { createRequire } from 'node:module'
import {
  flattenFields,
  slugToIdentifier,
  type ArrayField,
  type BlocksField,
  type CheckboxField,
  type CodeField,
  type CollectionConfig,
  type Config,
  type DateField,
  type EmailField,
  type Field,
  type GlobalConfig,
  type JsonField,
  type NumberField,
  type RadioField,
  type RelationshipField,
  type RichTextField,
  type SelectField,
  type SlugField,
  type TextareaField,
  type TextField,
  type UploadField,
} from '@lontar/core'
import {
  flattenGroupFields,
  getJunctionParentLocaleOrderIndexName,
  getJunctionParentLocaleTargetUniqueName,
  getJunctionTableName,
  getLocaleCodes,
  getVersionsFilenameIndexName,
  getVersionsParentForeignKeyName,
  getVersionsParentIdIndexName,
  getVersionsParentStatusIndexName,
  getVersionsParentVersionUniqueName,
} from './table'

export function resolveDrizzleOrm(): string {
  try {
    const req = createRequire(import.meta.url)
    return req.resolve('drizzle-orm').replace(/\\/g, '/')
  } catch {
    return 'drizzle-orm'
  }
}

export function resolveDrizzleOrmPgCore(): string {
  try {
    const req = createRequire(import.meta.url)
    return req.resolve('drizzle-orm/pg-core').replace(/\\/g, '/')
  } catch {
    return 'drizzle-orm/pg-core'
  }
}

export { slugToIdentifier }

function isColumnRequired(field: Field): boolean {
  return Boolean(field.required && !field.admin?.condition && !field.localized)
}

function renderTextField(name: string, field: TextField): string {
  if (field.hasMany) {
    let code = `jsonb('${name}')`
    if (field.defaultValue !== undefined) {
      code += `.default(${JSON.stringify(field.defaultValue)})`
    }
    if (isColumnRequired(field)) {
      code += '.notNull()'
    }
    return code
  }
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
  if (field.hasMany) {
    let code = `jsonb('${name}')`
    if (field.defaultValue !== undefined) {
      code += `.default(${JSON.stringify(field.defaultValue)})`
    }
    if (isColumnRequired(field)) {
      code += '.notNull()'
    }
    return code
  }
  let code = field.integer ? `integer('${name}')` : `doublePrecision('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
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

function renderCodeField(name: string, field: CodeField): string {
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

function renderSelectField(name: string, field: SelectField | RadioField): string {
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

function renderArrayField(name: string, field: ArrayField | BlocksField | JsonField): string {
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
  if (field.type === 'code') return renderCodeField(name, field)
  if (field.type === 'email') return renderEmailField(name, field)
  if (field.type === 'slug') return renderSlugField(name, field)
  return null
}

function renderAdvancedField(name: string, field: Field): string | null {
  if (field.type === 'relationship') return renderRelationshipField(name, field)
  if (field.type === 'upload') return renderUploadField(name, field)
  if (field.type === 'array' || field.type === 'blocks' || field.type === 'json') {
    return renderArrayField(name, field)
  }
  return null
}

function renderField(name: string, field: Field): string {
  const basic = renderBasicField(name, field)
  if (basic) return basic

  const advanced = renderAdvancedField(name, field)
  if (advanced) return advanced

  if (field.type === 'checkbox') return renderCheckboxField(name, field)
  if (field.type === 'select' || field.type === 'radio') return renderSelectField(name, field)
  if (field.type === 'date') return renderDateField(name, field)
  if (field.type === 'richText') return renderRichTextField(name, field)
  if (field.type === 'point') return `doublePrecision('${name}')`
  throw new Error(`Unsupported field type: ${(field as Field).type}`)
}

const FIELD_TYPE_IMPORTS: Record<string, string> = {
  text: 'varchar',
  email: 'varchar',
  slug: 'varchar',
  select: 'varchar',
  radio: 'varchar',
  textarea: 'text',
  code: 'text',
  json: 'jsonb',
  checkbox: 'boolean',
  date: 'timestamp',
  richText: 'jsonb',
  point: 'doublePrecision',
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
  if ((field.type === 'text' || field.type === 'number') && field.hasMany) {
    imports.add('jsonb')
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
  'bigint',
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
  for (const field of Object.values(flattenFields(entity.fields))) {
    collectFieldImports(field, imports)
  }
}

function collectImports(
  collections: readonly CollectionConfig[],
  globals: readonly GlobalConfig[] = [],
): string[] {
  const imports = new Set<string>(AUTH_BASE_IMPORTS)
  if (findJunctionTables(collections).length > 0) {
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

// Locale codes such as `en-US` make a column name like `title_en-US`, which is not a valid
// bare object key in the generated schema file.
function toObjectKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

function renderTableFieldLines(
  fields: Record<string, Field>,
  localeCodes: readonly string[],
): string[] {
  const lines: string[] = []
  const flatFields = flattenGroupFields(fields)
  for (const { name, field } of flatFields) {
    if (field.type === 'relationship' && field.hasMany) {
      continue
    }
    if (field.localized && localeCodes.length > 0) {
      const colField = { ...field, required: false }
      for (const locale of localeCodes) {
        const colName = `${name}_${locale}`
        lines.push(`  ${toObjectKey(colName)}: ${renderField(colName, colField)},`)
      }
    } else {
      lines.push(`  ${name}: ${renderField(name, field)},`)
    }
  }
  return lines
}

function renderTableDefinition(
  slug: string,
  fields: Record<string, Field>,
  isUpload = false,
  hasDrafts = false,
  localeCodes: readonly string[] = [],
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

  lines.push(...renderTableFieldLines(fields, localeCodes))

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

function renderCollection(
  collection: CollectionConfig,
  localeCodes: readonly string[] = [],
): string {
  return renderTableDefinition(
    collection.slug,
    collection.fields,
    Boolean(collection.upload),
    Boolean(collection.versions?.drafts),
    localeCodes,
  )
}

function renderGlobal(global: GlobalConfig, localeCodes: readonly string[] = []): string {
  return renderTableDefinition(
    global.slug,
    global.fields,
    false,
    Boolean(global.versions?.drafts),
    localeCodes,
  )
}

function renderAuthTables(defaultRole = 'editor'): string {
  return `export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    role: text('role').default('${defaultRole}').notNull(),
    banned: boolean('banned').default(false).notNull(),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { precision: 3, withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('user_role_idx').on(table.role)],
)

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
    impersonatedBy: text('impersonated_by'),
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
)

export const apikey = pgTable(
  'apikey',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    start: text('start').notNull(),
    key: text('key').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { precision: 3, withTimezone: true, mode: 'date' }),
    lastUsedAt: timestamp('last_used_at', { precision: 3, withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('apikey_userId_idx').on(table.userId),
    index('apikey_key_idx').on(table.key),
  ],
)

export const rateLimit = pgTable(
  'rateLimit',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [index('rateLimit_key_idx').on(table.key)],
)`
}

function renderJunctionTable(tableName: string, isLocalized = false): string {
  const identifier = slugToIdentifier(tableName)
  if (isLocalized) {
    const parentLocaleOrderIdx = getJunctionParentLocaleOrderIndexName(tableName)
    const parentLocaleTargetUnique = getJunctionParentLocaleTargetUniqueName(tableName)
    return `export const ${identifier} = pgTable(
  '${tableName}',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').notNull(),
    targetId: integer('target_id').notNull(),
    _locale: varchar('_locale', { length: 10 }).notNull(),
    order: integer('order').default(0).notNull(),
  },
  (table) => [
    index('${parentLocaleOrderIdx}').on(table.parentId, table._locale, table.order),
    index('${tableName}_target_idx').on(table.targetId),
    unique('${parentLocaleTargetUnique}').on(table.parentId, table._locale, table.targetId),
  ],
)`
  }
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

interface JunctionTableSpec {
  tableName: string
  isLocalized: boolean
}

function findJunctionTables(collections: readonly CollectionConfig[]): JunctionTableSpec[] {
  const specs: JunctionTableSpec[] = []
  for (const col of collections) {
    for (const { name, field } of flattenGroupFields(col.fields)) {
      if (field.type === 'relationship' && field.hasMany) {
        specs.push({
          tableName: getJunctionTableName(col.slug, name),
          isLocalized: Boolean(field.localized),
        })
      }
    }
  }
  return specs
}

function renderJunctionTables(collections: readonly CollectionConfig[]): string {
  return findJunctionTables(collections)
    .map((s) => renderJunctionTable(s.tableName, s.isLocalized))
    .join('\n\n')
}

function renderVersionsTable(entity: CollectionConfig | GlobalConfig): string {
  const isUpload = 'upload' in entity && Boolean(entity.upload)
  const identifier = slugToIdentifier(entity.slug)
  const versionsIdentifier = `${identifier}Versions`
  const tableName = `${entity.slug}_versions`
  const fkName = getVersionsParentForeignKeyName(entity.slug)
  const uniqueName = getVersionsParentVersionUniqueName(entity.slug)
  const parentIdIdxName = getVersionsParentIdIndexName(entity.slug)
  const parentStatusIdxName = getVersionsParentStatusIndexName(entity.slug)
  const filenameIdxName = getVersionsFilenameIndexName(entity.slug)

  const filenameIndexLine = isUpload
    ? `\n    index('${filenameIdxName}').on(sql\`(\${t.snapshot}->>'filename')\`),`
    : ''

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
    index('${parentStatusIdxName}').on(t.parentId, t._status),${filenameIndexLine}
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
  const localeCodes = getLocaleCodes(config.localization)
  const imports = collectImports(config.collections, globals)
  const ormModule = resolveDrizzleOrmPgCore()
  const hasUploadVersions = config.collections.some(
    (col) => Boolean(col.upload) && Boolean(col.versions),
  )
  const sqlImport = hasUploadVersions ? `import { sql } from '${resolveDrizzleOrm()}'\n` : ''
  const header = `// Generated by @lontar/db-postgres. Do not edit directly.\n${sqlImport}import { ${imports.join(', ')} } from '${ormModule}'\n`
  const defaultRole = config.auth?.defaultRole ?? 'editor'
  const authSection = renderAuthTables(defaultRole)
  const collectionSection = config.collections
    .map((col) => renderCollection(col, localeCodes))
    .join('\n\n')
  const versionsSection = renderVersionsTables(config.collections, globals)
  const globalSection = globals.map((g) => renderGlobal(g, localeCodes)).join('\n\n')
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
