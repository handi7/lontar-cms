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

const PRIMITIVE_FIELD_TYPES: Readonly<Record<string, string>> = {
  text: 'string',
  textarea: 'string',
  code: 'string',
  email: 'string',
  slug: 'string',
  date: 'string',
  number: 'number',
  checkbox: 'boolean',
  richText: 'Record<string, unknown>',
  json: 'Record<string, unknown> | unknown[] | string | number | boolean | null',
}

function renderPrimitiveFieldType(type: string): string | null {
  return PRIMITIVE_FIELD_TYPES[type] ?? null
}

interface FieldRenderContext {
  collectionMap: Map<string, string>
  parentPrefix?: string
  indent?: number
  parentConditional?: boolean
  allLocales?: boolean
  parentLocalized?: boolean
}

function renderGroupType(field: GroupField, name: string, ctx: FieldRenderContext): string {
  const pad = ' '.repeat(ctx.indent ?? 2)
  const lines: string[] = ['{']
  const isConditional = ctx.parentConditional || Boolean(field.admin?.condition)
  const isLocalized = ctx.parentLocalized || Boolean(field.localized)
  const childCtx: FieldRenderContext = {
    ...ctx,
    parentPrefix: `${ctx.parentPrefix ?? ''}${toPascalCase(name)}`,
    indent: (ctx.indent ?? 2) + 2,
    parentConditional: isConditional,
    parentLocalized: isLocalized,
  }
  for (const [subName, subField] of Object.entries(field.fields)) {
    lines.push(renderFieldLine(subName, subField, childCtx))
  }
  lines.push(`${pad}}`)
  return lines.join('\n')
}

function renderArrayType(field: ArrayField, name: string, ctx: FieldRenderContext): string {
  const indent = ctx.indent ?? 2
  const pad = ' '.repeat(indent)
  const isContainerLocalized = Boolean(field.localized)
  const subfieldAllLocales = Boolean(ctx.allLocales) && !isContainerLocalized
  const childCtx: FieldRenderContext = {
    ...ctx,
    parentPrefix: `${ctx.parentPrefix ?? ''}${toPascalCase(name)}`,
    indent: indent + 2,
    allLocales: subfieldAllLocales,
    parentLocalized: false,
  }
  const lines: string[] = ['Array<{', `${pad}  id: string`]
  for (const [subName, subField] of Object.entries(field.fields)) {
    lines.push(renderFieldLine(subName, subField, childCtx))
  }
  lines.push(`${pad}}>`)
  const arrayType = lines.join('\n')
  if (ctx.allLocales && isContainerLocalized) {
    return `Record<Locale, ${arrayType}>`
  }
  return arrayType
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
  allLocales = false,
  baseBlockName = blockInterfaceName,
): string {
  const lines: string[] = [
    `export interface ${blockInterfaceName} {`,
    '  id: string',
    `  blockType: '${block.slug}'`,
  ]
  const ctx: FieldRenderContext = {
    collectionMap,
    parentPrefix: baseBlockName,
    indent: 2,
    allLocales,
  }
  for (const [subName, subField] of Object.entries(block.fields)) {
    lines.push(renderFieldLine(subName, subField, ctx))
  }
  lines.push('}')
  return lines.join('\n')
}

function renderBlocksFieldDefinitions(
  fieldName: string,
  field: BlocksField,
  parentPrefix: string,
  collectionMap: Map<string, string>,
  allLocales = false,
): string[] {
  const defs: string[] = []
  const blockNames: string[] = []
  const suffix = allLocales ? 'AllLocales' : ''
  for (const block of field.blocks) {
    const baseBlockName = resolveBlockInterfaceName(parentPrefix, fieldName, block.slug)
    const blockInterfaceName = `${baseBlockName}${suffix}`
    blockNames.push(blockInterfaceName)
    defs.push(
      renderBlockInterface(block, blockInterfaceName, collectionMap, allLocales, baseBlockName),
    )
  }
  const baseUnionName = resolveBlocksUnionTypeName(parentPrefix, fieldName)
  const unionName = `${baseUnionName}${suffix}`
  const unionTypes = blockNames.length > 0 ? blockNames.join(' | ') : 'never'
  defs.push(`export type ${unionName} = ${unionTypes}`)
  return defs
}

function collectBlockDefinitions(
  fields: Record<string, Field>,
  parentPrefix: string,
  collectionMap: Map<string, string>,
  allLocales = false,
): string[] {
  const defs: string[] = []
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'blocks') {
      if (allLocales && field.localized) {
        continue
      }
      defs.push(
        ...renderBlocksFieldDefinitions(name, field, parentPrefix, collectionMap, allLocales),
      )
    } else if (field.type === 'group') {
      defs.push(
        ...collectBlockDefinitions(
          field.fields,
          `${parentPrefix}${toPascalCase(name)}`,
          collectionMap,
          allLocales,
        ),
      )
    }
  }
  return defs
}

function renderBlocksType(name: string, field: BlocksField, ctx: FieldRenderContext): string {
  const prefix = ctx.parentPrefix ?? ''
  if (ctx.allLocales && field.localized) {
    const unionName = resolveBlocksUnionTypeName(prefix, name)
    return `Record<Locale, Array<${unionName}>>`
  }
  const unionSuffix = ctx.allLocales ? 'AllLocales' : ''
  const unionName = `${resolveBlocksUnionTypeName(prefix, name)}${unionSuffix}`
  return `Array<${unionName}>`
}

function renderContainerFieldType(
  name: string,
  field: Field,
  ctx: FieldRenderContext,
): string | null {
  if (field.type === 'group') {
    return renderGroupType(field, name, ctx)
  }
  if (field.type === 'array') {
    return renderArrayType(field, name, ctx)
  }
  if (field.type === 'blocks') {
    return renderBlocksType(name, field, ctx)
  }
  return null
}

function renderLeafFieldType(field: Field, collectionMap: Map<string, string>): string | null {
  const primitive = renderPrimitiveFieldType(field.type)
  if (primitive) return primitive
  if (field.type === 'select') return buildSelectType(field)
  if (field.type === 'relationship') return buildRelationshipType(field, collectionMap)
  if (field.type === 'upload') return buildUploadFieldType(field, collectionMap)
  return null
}

function wrapLeafLocale(leaf: string, field: Field, ctx: FieldRenderContext): string {
  if (ctx.allLocales && (field.localized || ctx.parentLocalized)) {
    return `Record<Locale, ${leaf}>`
  }
  return leaf
}

function renderFieldType(name: string, field: Field, ctx: FieldRenderContext): string {
  const leaf = renderLeafFieldType(field, ctx.collectionMap)
  if (leaf) {
    return wrapLeafLocale(leaf, field, ctx)
  }
  return renderContainerFieldType(name, field, ctx) ?? 'unknown'
}

function renderFieldLine(name: string, field: Field, ctx: FieldRenderContext): string {
  const pad = ' '.repeat(ctx.indent ?? 2)
  const prop = formatFieldName(name)
  const isConditional = ctx.parentConditional || Boolean(field.admin?.condition)
  const typeStr = renderFieldType(name, field, { ...ctx, parentConditional: isConditional })
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

function extractLocaleCodes(config: Config): string[] {
  if (!config.localization || !config.localization.locales) {
    return []
  }
  return config.localization.locales.map((loc) => (typeof loc === 'string' ? loc : loc.code))
}

function renderLocaleType(localeCodes: readonly string[]): string {
  const union = localeCodes.map((code) => JSON.stringify(code)).join(' | ')
  return `export type Locale = ${union}`
}

function renderCollectionInterface(
  col: CollectionConfig,
  interfaceName: string,
  collectionMap: Map<string, string>,
  allLocales = false,
  basePrefix = interfaceName,
): string {
  const lines: string[] = [`export interface ${interfaceName} {`, '  id: number']

  if (col.versions?.drafts) {
    lines.push("  _status: 'draft' | 'published'")
  }

  lines.push('  createdAt: string', '  updatedAt: string')

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

  const ctx: FieldRenderContext = {
    collectionMap,
    parentPrefix: basePrefix,
    indent: 2,
    allLocales,
  }

  for (const [name, field] of Object.entries(col.fields)) {
    lines.push(renderFieldLine(name, field, ctx))
  }

  lines.push('}')
  return lines.join('\n')
}

function renderGlobalInterface(
  glob: GlobalConfig,
  interfaceName: string,
  collectionMap: Map<string, string>,
  allLocales = false,
  basePrefix = interfaceName,
): string {
  const lines: string[] = [`export interface ${interfaceName} {`, '  id: number']

  if (glob.versions?.drafts) {
    lines.push("  _status: 'draft' | 'published'")
  }

  lines.push('  createdAt: string', '  updatedAt: string')

  const ctx: FieldRenderContext = {
    collectionMap,
    parentPrefix: basePrefix,
    indent: 2,
    allLocales,
  }

  for (const [name, field] of Object.entries(glob.fields)) {
    lines.push(renderFieldLine(name, field, ctx))
  }

  lines.push('}')
  return lines.join('\n')
}

function renderUserRole(roles?: readonly string[]): string {
  const roleList = roles && roles.length > 0 ? roles : ['admin', 'editor']
  const union = roleList.map((r) => JSON.stringify(r)).join(' | ')
  return `export type UserRole = ${union}`
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
  hasLocalization = false,
): string {
  const colLines = collections.map(
    (c) => `    ${formatFieldName(c.slug)}: ${collectionMap.get(c.slug)!}`,
  )
  const globLines = globals.map((g) => `    ${formatFieldName(g.slug)}: ${globalMap.get(g.slug)!}`)

  if (!hasLocalization) {
    return `declare module '@lontar/core' {\n  interface UserRoleExtension {\n    role: UserRole\n  }\n  interface LontarCollections {\n${colLines.join('\n')}\n  }\n  interface LontarGlobals {\n${globLines.join('\n')}\n  }\n}`
  }

  const colAllLines = collections.map(
    (c) => `    ${formatFieldName(c.slug)}: ${collectionMap.get(c.slug)!}AllLocales`,
  )
  const globAllLines = globals.map(
    (g) => `    ${formatFieldName(g.slug)}: ${globalMap.get(g.slug)!}AllLocales`,
  )

  return `declare module '@lontar/core' {\n  interface UserRoleExtension {\n    role: UserRole\n  }\n  interface LontarLocaleExtension {\n    locale: Locale\n  }\n  interface LontarCollections {\n${colLines.join('\n')}\n  }\n  interface LontarCollectionsAll {\n${colAllLines.join('\n')}\n  }\n  interface LontarGlobals {\n${globLines.join('\n')}\n  }\n  interface LontarGlobalsAll {\n${globAllLines.join('\n')}\n  }\n}`
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
  const localeCodes = extractLocaleCodes(config)
  const hasLocalization = localeCodes.length > 0

  const usedNames = new Set<string>([
    'Config',
    'LontarCollections',
    'LontarCollectionsAll',
    'LontarGlobals',
    'LontarGlobalsAll',
    'LontarLocaleExtension',
    'Locale',
    'UserRole',
    'UserRoleExtension',
  ])
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

  if (hasLocalization) {
    sections.push(renderLocaleType(localeCodes))
  }

  for (const col of collections) {
    const ifaceName = collectionMap.get(col.slug)!
    sections.push(...collectBlockDefinitions(col.fields, ifaceName, collectionMap, false))
    sections.push(renderCollectionInterface(col, ifaceName, collectionMap, false))
    if (hasLocalization) {
      sections.push(...collectBlockDefinitions(col.fields, ifaceName, collectionMap, true))
      sections.push(
        renderCollectionInterface(col, `${ifaceName}AllLocales`, collectionMap, true, ifaceName),
      )
    }
  }

  for (const glob of globals) {
    const ifaceName = globalMap.get(glob.slug)!
    sections.push(...collectBlockDefinitions(glob.fields, ifaceName, collectionMap, false))
    sections.push(renderGlobalInterface(glob, ifaceName, collectionMap, false))
    if (hasLocalization) {
      sections.push(...collectBlockDefinitions(glob.fields, ifaceName, collectionMap, true))
      sections.push(
        renderGlobalInterface(glob, `${ifaceName}AllLocales`, collectionMap, true, ifaceName),
      )
    }
  }

  sections.push(renderUserRole(config.auth?.roles))
  sections.push(renderConfigInterface(collections, globals, collectionMap, globalMap))
  sections.push(
    renderModuleAugmentation(collections, globals, collectionMap, globalMap, hasLocalization),
  )

  return sections.join('\n\n') + '\n'
}
