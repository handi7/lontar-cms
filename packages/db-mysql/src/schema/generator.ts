import type {
  CheckboxField,
  CollectionConfig,
  Config,
  DateField,
  EmailField,
  Field,
  NumberField,
  SelectField,
  SlugField,
  TextareaField,
  TextField,
} from '@lontar/core'

export function slugToIdentifier(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase())
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

function renderField(name: string, field: Field): string {
  if (field.type === 'text') return renderTextField(name, field)
  if (field.type === 'number') return renderNumberField(name, field)
  if (field.type === 'textarea') return renderTextareaField(name, field)
  if (field.type === 'email') return renderEmailField(name, field)
  if (field.type === 'slug') return renderSlugField(name, field)
  if (field.type === 'checkbox') return renderCheckboxField(name, field)
  if (field.type === 'select') return renderSelectField(name, field)
  if (field.type === 'date') return renderDateField(name, field)
  throw new Error(`Unsupported field type: ${(field as Field).type}`)
}

function collectFieldImports(field: Field, imports: Set<string>): void {
  switch (field.type) {
    case 'text':
    case 'email':
    case 'slug':
    case 'select':
      imports.add('varchar')
      break
    case 'textarea':
      imports.add('text')
      break
    case 'number':
      if (!field.integer) imports.add('double')
      break
    case 'checkbox':
      imports.add('boolean')
      break
    case 'date':
      imports.add('timestamp')
      break
  }
}

function collectImports(collections: readonly CollectionConfig[]): string[] {
  const imports = new Set<string>(['int', 'mysqlTable', 'timestamp'])
  for (const collection of collections) {
    for (const field of Object.values(collection.fields)) {
      collectFieldImports(field, imports)
    }
  }
  return Array.from(imports).sort()
}

function renderCollection(collection: CollectionConfig): string {
  const identifier = slugToIdentifier(collection.slug)
  const lines: string[] = ["  id: int('id').autoincrement().primaryKey(),"]

  for (const [name, field] of Object.entries(collection.fields)) {
    lines.push(`  ${name}: ${renderField(name, field)},`)
  }

  lines.push("  createdAt: timestamp('createdAt').defaultNow().notNull(),")
  lines.push("  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),")

  return `export const ${identifier} = mysqlTable('${collection.slug}', {\n${lines.join('\n')}\n})`
}

export function generateSchemaFile(config: Config): string {
  const imports = collectImports(config.collections)
  const header = `// Generated by @lontar/db-mysql. Do not edit directly.\nimport { ${imports.join(', ')} } from 'drizzle-orm/mysql-core'\n`
  const tables = config.collections.map(renderCollection).join('\n\n')
  return `${header}\n${tables}\n`
}
