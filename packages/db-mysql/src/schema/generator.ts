import type {
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
} from '@lontar/core'
import { getJunctionTableName } from './table'

export function slugToIdentifier(slug: string): string {
  return slug.replace(/[-_]([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function renderTextField(name: string, field: TextField): string {
  const length = field.maxLength ?? 255
  let code = `varchar('${name}', { length: ${length} })`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderNumberField(name: string, field: NumberField): string {
  let code = field.integer ? `int('${name}')` : `double('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${field.defaultValue})`
  }
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderTextareaField(name: string, field: TextareaField): string {
  let code = `text('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (field.required) {
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
  if (field.required) {
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
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderCheckboxField(name: string, field: CheckboxField): string {
  let code = `boolean('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${field.defaultValue})`
  }
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderSelectField(name: string, field: SelectField): string {
  let code = `varchar('${name}', { length: 120 })`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderDateField(name: string, field: DateField): string {
  let code = `timestamp('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(new Date(${JSON.stringify(field.defaultValue)}))`
  }
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderRichTextField(name: string, field: RichTextField): string {
  let code = `json('${name}')`
  if (field.defaultValue !== undefined) {
    code += `.default(${JSON.stringify(field.defaultValue)})`
  }
  if (field.required) {
    code += '.notNull()'
  }
  return code
}

function renderRelationshipField(name: string, field: RelationshipField): string {
  let code = `int('${name}')`
  if (field.required) {
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
  richText: 'json',
  relationship: 'int',
}

function collectFieldImports(field: Field, imports: Set<string>): void {
  const imp = FIELD_TYPE_IMPORTS[field.type]
  if (imp) {
    imports.add(imp)
  }
  if (field.type === 'number' && !field.integer) {
    imports.add('double')
  }
}

const AUTH_BASE_IMPORTS = [
  'boolean',
  'index',
  'int',
  'mysqlTable',
  'text',
  'timestamp',
  'varchar',
] as const

function collectImports(
  collections: readonly CollectionConfig[],
  globals: readonly GlobalConfig[] = [],
): string[] {
  const imports = new Set<string>(AUTH_BASE_IMPORTS)
  for (const collection of collections) {
    for (const field of Object.values(collection.fields)) {
      collectFieldImports(field, imports)
    }
  }
  for (const global of globals) {
    for (const field of Object.values(global.fields)) {
      collectFieldImports(field, imports)
    }
  }
  return Array.from(imports).sort()
}

function renderTableDefinition(slug: string, fields: Record<string, Field>): string {
  const identifier = slugToIdentifier(slug)
  const lines: string[] = ["  id: int('id').autoincrement().primaryKey(),"]

  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'relationship' && field.hasMany) {
      continue
    }
    lines.push(`  ${name}: ${renderField(name, field)},`)
  }

  lines.push("  createdAt: timestamp('createdAt').defaultNow().notNull(),")
  lines.push("  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),")

  return `export const ${identifier} = mysqlTable('${slug}', {\n${lines.join('\n')}\n})`
}

function renderCollection(collection: CollectionConfig): string {
  return renderTableDefinition(collection.slug, collection.fields)
}

function renderGlobal(global: GlobalConfig): string {
  return renderTableDefinition(global.slug, global.fields)
}

function renderAuthTables(): string {
  return `export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
})

export const session = mysqlTable(
  'session',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = mysqlTable(
  'account',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = mysqlTable(
  'verification',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)`
}

function renderJunctionTable(tableName: string): string {
  const identifier = slugToIdentifier(tableName)
  return `export const ${identifier} = mysqlTable('${tableName}', {
  id: int('id').autoincrement().primaryKey(),
  parentId: int('parent_id').notNull(),
  targetId: int('target_id').notNull(),
  order: int('order').default(0).notNull(),
})`
}

function findJunctionTableNames(collections: readonly CollectionConfig[]): string[] {
  const names: string[] = []
  for (const col of collections) {
    for (const [name, field] of Object.entries(col.fields)) {
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

export function generateSchemaFile(config: Config): string {
  const globals = config.globals ?? []
  const imports = collectImports(config.collections, globals)
  const header = `// Generated by @lontar/db-mysql. Do not edit directly.\nimport { ${imports.join(', ')} } from 'drizzle-orm/mysql-core'\n`
  const authSection = renderAuthTables()
  const collectionSection = config.collections.map(renderCollection).join('\n\n')
  const globalSection = globals.map(renderGlobal).join('\n\n')
  const junctionSection = renderJunctionTables(config.collections)
  const sections = [authSection, collectionSection, globalSection, junctionSection].filter(Boolean)
  return `${header}\n${sections.join('\n\n')}\n`
}
