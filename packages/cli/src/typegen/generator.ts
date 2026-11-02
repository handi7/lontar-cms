import type {
  CollectionConfig,
  Config,
  Field,
  GlobalConfig,
  RelationshipField,
  SelectField,
  UploadConfig,
  UploadField,
} from '@lontar/core'

const UNCOUNTABLE_WORDS = new Set(['media', 'news', 'series', 'species'])

function isPluralSuffix(lower: string): boolean {
  return (
    lower.endsWith('sses') ||
    lower.endsWith('shes') ||
    lower.endsWith('ches') ||
    lower.endsWith('xes') ||
    lower.endsWith('zes')
  )
}

function isImmutableEnding(lower: string): boolean {
  return UNCOUNTABLE_WORDS.has(lower) || lower.endsWith('us') || lower.endsWith('is')
}

export function singularize(word: string): string {
  const lower = word.toLowerCase()
  if (isImmutableEnding(lower)) {
    return word
  }
  if (lower.endsWith('ies') && lower.length > 4) {
    return word.slice(0, -3) + 'y'
  }
  if (isPluralSuffix(lower)) {
    return word.slice(0, -2)
  }
  if (lower.endsWith('s') && !lower.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

export function toPascalCase(str: string): string {
  const parts = str.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) return 'Document'
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

export function resolveCollectionInterfaceName(col: CollectionConfig): string {
  if (col.labels?.singular) {
    return toPascalCase(col.labels.singular)
  }
  return toPascalCase(singularize(col.slug))
}

export function resolveGlobalInterfaceName(glob: GlobalConfig): string {
  if (glob.label) {
    return toPascalCase(glob.label)
  }
  return toPascalCase(glob.slug)
}

function formatFieldName(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

function buildSelectType(field: SelectField): string {
  if (!field.options || field.options.length === 0) {
    return 'string'
  }
  return field.options
    .map((opt) => {
      const val = typeof opt === 'string' ? opt : opt.value
      return JSON.stringify(val)
    })
    .join(' | ')
}

function buildRelationshipType(
  field: RelationshipField,
  collectionMap: Map<string, string>,
): string {
  const target = collectionMap.get(field.relationTo) ?? 'Record<string, unknown>'
  return field.hasMany ? `(number | ${target})[]` : `number | ${target}`
}

function buildUploadFieldType(field: UploadField, collectionMap: Map<string, string>): string {
  const target = collectionMap.get(field.relationTo) ?? 'Record<string, unknown>'
  return `number | ${target}`
}

function renderPrimitiveFieldType(type: string): string | null {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'slug':
    case 'date':
      return 'string'
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'richText':
      return 'Record<string, unknown>'
    default:
      return null
  }
}

function renderFieldType(field: Field, collectionMap: Map<string, string>): string {
  const primitive = renderPrimitiveFieldType(field.type)
  if (primitive) {
    return primitive
  }
  if (field.type === 'select') {
    return buildSelectType(field)
  }
  if (field.type === 'relationship') {
    return buildRelationshipType(field, collectionMap)
  }
  if (field.type === 'upload') {
    return buildUploadFieldType(field, collectionMap)
  }
  return 'unknown'
}

function renderFieldLine(name: string, field: Field, collectionMap: Map<string, string>): string {
  const prop = formatFieldName(name)
  const typeStr = renderFieldType(field, collectionMap)
  if (field.required) {
    return `  ${prop}: ${typeStr}`
  }
  return `  ${prop}?: ${typeStr} | null`
}

function renderUploadPreset(sizeKey: string): string {
  const prop = formatFieldName(sizeKey)
  return (
    `    ${prop}?: {\n` +
    `      filename: string\n` +
    `      url: string\n` +
    `      width: number\n` +
    `      height: number\n` +
    `      mimeType: string\n` +
    `      filesize: number\n` +
    `    }`
  )
}

function renderUploadSizes(upload: boolean | UploadConfig | undefined): string {
  if (typeof upload === 'object' && upload !== null && upload.sizes) {
    const keys = Object.keys(upload.sizes)
    if (keys.length > 0) {
      const sizeFields = keys.map(renderUploadPreset).join('\n')
      return `  sizes?: {\n${sizeFields}\n  } | null`
    }
  }
  return `  sizes?: Record<\n    string,\n    {\n      filename: string\n      url: string\n      width: number\n      height: number\n      mimeType: string\n      filesize: number\n    }\n  > | null`
}

function renderCollectionInterface(
  col: CollectionConfig,
  interfaceName: string,
  collectionMap: Map<string, string>,
): string {
  const lines: string[] = [
    `export interface ${interfaceName} {`,
    '  id: number',
    '  createdAt: string',
    '  updatedAt: string',
  ]

  if (col.upload) {
    lines.push(
      '  filename: string',
      '  url: string',
      '  mimeType: string',
      '  filesize: number',
      '  width?: number | null',
      '  height?: number | null',
      renderUploadSizes(col.upload),
    )
  }

  for (const [name, field] of Object.entries(col.fields)) {
    lines.push(renderFieldLine(name, field, collectionMap))
  }

  lines.push('}')
  return lines.join('\n')
}

function renderGlobalInterface(
  glob: GlobalConfig,
  interfaceName: string,
  collectionMap: Map<string, string>,
): string {
  const lines: string[] = [
    `export interface ${interfaceName} {`,
    '  id: number',
    '  createdAt: string',
    '  updatedAt: string',
  ]

  for (const [name, field] of Object.entries(glob.fields)) {
    lines.push(renderFieldLine(name, field, collectionMap))
  }

  lines.push('}')
  return lines.join('\n')
}

function renderConfigInterface(
  collections: readonly CollectionConfig[],
  globals: readonly GlobalConfig[],
  collectionMap: Map<string, string>,
  globalMap: Map<string, string>,
): string {
  const colLines = collections.map(
    (c) => `    ${formatFieldName(c.slug)}: ${collectionMap.get(c.slug)!}`,
  )
  const globLines = globals.map((g) => `    ${formatFieldName(g.slug)}: ${globalMap.get(g.slug)!}`)

  return `export interface Config {\n  collections: {\n${colLines.join('\n')}\n  }\n  globals: {\n${globLines.join('\n')}\n  }\n}`
}

function renderModuleAugmentation(
  collections: readonly CollectionConfig[],
  globals: readonly GlobalConfig[],
  collectionMap: Map<string, string>,
  globalMap: Map<string, string>,
): string {
  const colLines = collections.map(
    (c) => `    ${formatFieldName(c.slug)}: ${collectionMap.get(c.slug)!}`,
  )
  const globLines = globals.map((g) => `    ${formatFieldName(g.slug)}: ${globalMap.get(g.slug)!}`)

  return `declare module '@lontar/core' {\n  interface LontarCollections {\n${colLines.join('\n')}\n  }\n  interface LontarGlobals {\n${globLines.join('\n')}\n  }\n}`
}

export function generateTypes(config: Config): string {
  const collections = config.collections ?? []
  const globals = config.globals ?? []

  const collectionMap = new Map<string, string>()
  const globalMap = new Map<string, string>()
  const usedNames = new Set<string>(['Config', 'LontarCollections', 'LontarGlobals'])

  for (const col of collections) {
    let name = resolveCollectionInterfaceName(col)
    while (usedNames.has(name)) {
      name = `${name}Doc`
    }
    usedNames.add(name)
    collectionMap.set(col.slug, name)
  }

  for (const glob of globals) {
    let name = resolveGlobalInterfaceName(glob)
    while (usedNames.has(name)) {
      name = `${name}Global`
    }
    usedNames.add(name)
    globalMap.set(glob.slug, name)
  }

  const sections: string[] = [
    '/* eslint-disable */\n// Generated by @lontar/cli. Do not edit directly.',
  ]

  for (const col of collections) {
    sections.push(renderCollectionInterface(col, collectionMap.get(col.slug)!, collectionMap))
  }

  for (const glob of globals) {
    sections.push(renderGlobalInterface(glob, globalMap.get(glob.slug)!, collectionMap))
  }

  sections.push(renderConfigInterface(collections, globals, collectionMap, globalMap))
  sections.push(renderModuleAugmentation(collections, globals, collectionMap, globalMap))

  return sections.join('\n\n') + '\n'
}
