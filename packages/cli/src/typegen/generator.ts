import type {
  ArrayField,
  Block,
  BlocksField,
  CollectionConfig,
  Config,
  Field,
  GlobalConfig,
  GroupField,
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

function renderGroupType(
  field: GroupField,
  collectionMap: Map<string, string>,
  parentPrefix: string,
  indent: number,
  parentConditional = false,
): string {
  const pad = ' '.repeat(indent)
  const lines: string[] = ['{']
  const isConditional = parentConditional || Boolean(field.admin?.condition)
  for (const [subName, subField] of Object.entries(field.fields)) {
    lines.push(
      renderFieldLine(subName, subField, collectionMap, parentPrefix, indent + 2, isConditional),
    )
  }
  lines.push(`${pad}}`)
  return lines.join('\n')
}

function renderArrayType(
  field: ArrayField,
  collectionMap: Map<string, string>,
  parentPrefix: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent)
  const lines: string[] = ['Array<{', `${pad}  id: string`]
  for (const [subName, subField] of Object.entries(field.fields)) {
    lines.push(renderFieldLine(subName, subField, collectionMap, parentPrefix, indent + 2))
  }
  lines.push(`${pad}}>`)
  return lines.join('\n')
}

function resolveBlocksUnionTypeName(parentPrefix: string, fieldName: string): string {
  return `${parentPrefix}${toPascalCase(fieldName)}Block`
}

function resolveBlockInterfaceName(
  parentPrefix: string,
  fieldName: string,
  blockSlug: string,
): string {
  return `${parentPrefix}${toPascalCase(fieldName)}${toPascalCase(blockSlug)}Block`
}

function renderBlockInterface(
  block: Block,
  blockInterfaceName: string,
  collectionMap: Map<string, string>,
): string {
  const lines: string[] = [
    `export interface ${blockInterfaceName} {`,
    '  id: string',
    `  blockType: '${block.slug}'`,
  ]
  for (const [subName, subField] of Object.entries(block.fields)) {
    lines.push(renderFieldLine(subName, subField, collectionMap, blockInterfaceName, 2))
  }
  lines.push('}')
  return lines.join('\n')
}

function renderBlocksFieldDefinitions(
  fieldName: string,
  field: BlocksField,
  parentPrefix: string,
  collectionMap: Map<string, string>,
): string[] {
  const defs: string[] = []
  const blockNames: string[] = []
  for (const block of field.blocks) {
    const blockInterfaceName = resolveBlockInterfaceName(parentPrefix, fieldName, block.slug)
    blockNames.push(blockInterfaceName)
    defs.push(renderBlockInterface(block, blockInterfaceName, collectionMap))
  }
  const unionName = resolveBlocksUnionTypeName(parentPrefix, fieldName)
  const unionTypes = blockNames.length > 0 ? blockNames.join(' | ') : 'never'
  defs.push(`export type ${unionName} = ${unionTypes}`)
  return defs
}

function collectBlockDefinitions(
  fields: Record<string, Field>,
  parentPrefix: string,
  collectionMap: Map<string, string>,
): string[] {
  const defs: string[] = []
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'blocks') {
      defs.push(...renderBlocksFieldDefinitions(name, field, parentPrefix, collectionMap))
    } else if (field.type === 'group') {
      defs.push(
        ...collectBlockDefinitions(
          field.fields,
          `${parentPrefix}${toPascalCase(name)}`,
          collectionMap,
        ),
      )
    }
  }
  return defs
}

function renderContainerFieldType(
  name: string,
  field: Field,
  collectionMap: Map<string, string>,
  parentPrefix: string,
  indent: number,
  parentConditional: boolean,
): string | null {
  if (field.type === 'group') {
    return renderGroupType(
      field,
      collectionMap,
      `${parentPrefix}${toPascalCase(name)}`,
      indent,
      parentConditional,
    )
  }
  if (field.type === 'array') {
    return renderArrayType(field, collectionMap, `${parentPrefix}${toPascalCase(name)}`, indent)
  }
  if (field.type === 'blocks') {
    const unionName = resolveBlocksUnionTypeName(parentPrefix, name)
    return `Array<${unionName}>`
  }
  return null
}

function renderFieldType(
  name: string,
  field: Field,
  collectionMap: Map<string, string>,
  parentPrefix = '',
  indent = 2,
  parentConditional = false,
): string {
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
  const container = renderContainerFieldType(
    name,
    field,
    collectionMap,
    parentPrefix,
    indent,
    parentConditional,
  )
  if (container) {
    return container
  }
  return 'unknown'
}

function renderFieldLine(
  name: string,
  field: Field,
  collectionMap: Map<string, string>,
  parentPrefix = '',
  indent = 2,
  parentConditional = false,
): string {
  const pad = ' '.repeat(indent)
  const prop = formatFieldName(name)
  const isConditional = parentConditional || Boolean(field.admin?.condition)
  const typeStr = renderFieldType(name, field, collectionMap, parentPrefix, indent, isConditional)
  if (field.required && !isConditional) {
    return `${pad}${prop}: ${typeStr}`
  }
  return `${pad}${prop}?: ${typeStr} | null`
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
    lines.push(renderFieldLine(name, field, collectionMap, interfaceName))
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
    lines.push(renderFieldLine(name, field, collectionMap, interfaceName))
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

function buildEntityNameMap<T extends { slug: string }>(
  items: readonly T[],
  resolver: (item: T) => string,
  suffix: string,
  usedNames: Set<string>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of items) {
    let name = resolver(item)
    while (usedNames.has(name)) {
      name = `${name}${suffix}`
    }
    usedNames.add(name)
    map.set(item.slug, name)
  }
  return map
}

export function generateTypes(config: Config): string {
  const collections = config.collections ?? []
  const globals = config.globals ?? []

  const usedNames = new Set<string>(['Config', 'LontarCollections', 'LontarGlobals'])
  const collectionMap = buildEntityNameMap(
    collections,
    resolveCollectionInterfaceName,
    'Doc',
    usedNames,
  )
  const globalMap = buildEntityNameMap(globals, resolveGlobalInterfaceName, 'Global', usedNames)

  const sections: string[] = [
    '/* eslint-disable */\n// Generated by @lontar/cli. Do not edit directly.',
  ]

  for (const col of collections) {
    const ifaceName = collectionMap.get(col.slug)!
    sections.push(...collectBlockDefinitions(col.fields, ifaceName, collectionMap))
    sections.push(renderCollectionInterface(col, ifaceName, collectionMap))
  }

  for (const glob of globals) {
    const ifaceName = globalMap.get(glob.slug)!
    sections.push(...collectBlockDefinitions(glob.fields, ifaceName, collectionMap))
    sections.push(renderGlobalInterface(glob, ifaceName, collectionMap))
  }

  sections.push(renderConfigInterface(collections, globals, collectionMap, globalMap))
  sections.push(renderModuleAugmentation(collections, globals, collectionMap, globalMap))

  return sections.join('\n\n') + '\n'
}
