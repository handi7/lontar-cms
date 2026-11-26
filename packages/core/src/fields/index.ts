import type {
  ArrayField,
  Block,
  BlockConfig,
  BlocksField,
  CheckboxField,
  CodeField,
  CollapsibleField,
  DateField,
  EmailField,
  GroupField,
  JsonField,
  NumberField,
  PointField,
  RadioField,
  RelationshipField,
  RichTextField,
  RowField,
  SelectField,
  SlugField,
  Tab,
  TabsField,
  TextareaField,
  TextField,
  UploadField,
} from './types'

type Options<F> = Omit<F, 'type'>

/*
 * `const` keeps options like `required: true` as literal types, which is what
 * lets InferDoc tell a required field from a nullable one.
 */
function text<const O extends Options<TextField>>(options?: O): O & { type: 'text' } {
  return { ...(options as O), type: 'text' }
}

function number<const O extends Options<NumberField>>(options?: O): O & { type: 'number' } {
  return { ...(options as O), type: 'number' }
}

function textarea<const O extends Options<TextareaField>>(options?: O): O & { type: 'textarea' } {
  return { ...(options as O), type: 'textarea' }
}

function code<const O extends Options<CodeField>>(options?: O): O & { type: 'code' } {
  return { ...(options as O), type: 'code' }
}

function json<const O extends Options<JsonField>>(options?: O): O & { type: 'json' } {
  return { ...(options as O), type: 'json' }
}

function point<const O extends Options<PointField>>(options?: O): O & { type: 'point' } {
  return { ...(options as O), type: 'point' }
}

function email<const O extends Options<EmailField>>(options?: O): O & { type: 'email' } {
  return { ...(options as O), type: 'email' }
}

function slug<const O extends Options<SlugField>>(options?: O): O & { type: 'slug' } {
  return { ...(options as O), type: 'slug' }
}

function checkbox<const O extends Options<CheckboxField>>(options?: O): O & { type: 'checkbox' } {
  return { ...(options as O), type: 'checkbox' }
}

function select<const O extends Options<SelectField>>(options: O): O & { type: 'select' } {
  return { ...options, type: 'select' }
}

function radio<const O extends Options<RadioField>>(options: O): O & { type: 'radio' } {
  return { ...options, type: 'radio' }
}

function date<const O extends Options<DateField>>(options?: O): O & { type: 'date' } {
  return { ...(options as O), type: 'date' }
}

function richText<const O extends Options<RichTextField>>(options?: O): O & { type: 'richText' } {
  return { ...(options as O), type: 'richText' }
}

function relationship<const O extends Options<RelationshipField>>(
  options: O,
): O & { type: 'relationship' } {
  if (!options?.relationTo) {
    throw new Error('Relationship field requires a "relationTo" collection slug')
  }
  return { ...options, type: 'relationship' }
}

function upload<const O extends Options<UploadField>>(options: O): O & { type: 'upload' } {
  if (!options?.relationTo) {
    throw new Error('Upload field requires a "relationTo" collection slug')
  }
  return { ...options, type: 'upload' }
}

function group<const O extends Options<GroupField>>(options: O): O & { type: 'group' } {
  if (!options || typeof options.fields !== 'object' || options.fields === null) {
    throw new Error('Group field requires a "fields" object')
  }
  return { ...options, type: 'group' }
}

function validateMinRowOption(minRows?: number): void {
  if (minRows !== undefined && (!Number.isInteger(minRows) || minRows < 0)) {
    throw new Error('Array minRows must be a non-negative integer')
  }
}

function validateMaxRowOption(maxRows?: number): void {
  if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows <= 0)) {
    throw new Error('Array maxRows must be a positive integer')
  }
  if (maxRows !== undefined && maxRows > 500) {
    throw new Error('Array maxRows cannot exceed 500')
  }
}

function validateArrayRows(minRows?: number, maxRows?: number): void {
  validateMinRowOption(minRows)
  validateMaxRowOption(maxRows)
  if (minRows !== undefined && maxRows !== undefined && minRows > maxRows) {
    throw new Error('Array minRows cannot be greater than maxRows')
  }
}

function array<const O extends Options<ArrayField>>(options: O): O & { type: 'array' } {
  if (!options || typeof options.fields !== 'object' || options.fields === null) {
    throw new Error('Array field requires a "fields" object')
  }
  if ('id' in options.fields) {
    throw new Error('Array subfields cannot include reserved name "id"')
  }
  validateArrayRows(options.minRows, options.maxRows)
  return { ...options, type: 'array' }
}

export function block<const T extends BlockConfig>(config: T): T {
  if (!config || typeof config !== 'object') {
    throw new Error('Block requires a configuration object')
  }
  if (!config.slug || typeof config.slug !== 'string') {
    throw new Error('Block requires a string slug')
  }
  if (!config.fields || typeof config.fields !== 'object') {
    throw new Error(`Block "${config.slug}" requires a "fields" object`)
  }
  if ('id' in config.fields) {
    throw new Error(`Block "${config.slug}" subfields cannot include reserved name "id"`)
  }
  if ('blockType' in config.fields) {
    throw new Error(`Block "${config.slug}" subfields cannot include reserved name "blockType"`)
  }
  return config
}

function validateBlocksList(blocks: unknown): void {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('Blocks field requires a non-empty "blocks" array')
  }
  const seenSlugs = new Set<string>()
  for (const b of blocks as Block[]) {
    if (!b || typeof b !== 'object' || !b.slug) {
      throw new Error('Each block in blocks field must have a valid slug')
    }
    if (seenSlugs.has(b.slug)) {
      throw new Error(`Duplicate block slug "${b.slug}" in blocks field`)
    }
    seenSlugs.add(b.slug)
  }
}

function blocks<const O extends Options<BlocksField>>(options: O): O & { type: 'blocks' } {
  if (!options || typeof options !== 'object') {
    throw new Error('Blocks field requires an options object')
  }
  validateBlocksList(options.blocks)
  validateArrayRows(options.minRows, options.maxRows)
  return { ...options, type: 'blocks' }
}

function validateTabsList(tabs: unknown): void {
  if (!Array.isArray(tabs)) {
    throw new Error('Tabs field requires a "tabs" array')
  }
  for (const t of tabs as Tab[]) {
    if (!t || typeof t !== 'object') {
      throw new Error('Each tab in tabs field must be an object')
    }
    if (typeof t.label !== 'string') {
      throw new Error('Each tab in tabs field must have a string "label"')
    }
    if (!t.fields || typeof t.fields !== 'object') {
      throw new Error(`Tab "${t.label}" requires a "fields" object`)
    }
  }
}

function tabs<const O extends Options<TabsField>>(options: O): O & { type: 'tabs' } {
  if (!options || typeof options !== 'object') {
    throw new Error('Tabs field requires an options object')
  }
  validateTabsList(options.tabs)
  return { ...options, type: 'tabs' }
}

function row<const O extends Options<RowField>>(options: O): O & { type: 'row' } {
  if (!options || typeof options.fields !== 'object' || options.fields === null) {
    throw new Error('Row field requires a "fields" object')
  }
  return { ...options, type: 'row' }
}

function collapsible<const O extends Options<CollapsibleField>>(
  options: O,
): O & { type: 'collapsible' } {
  if (!options || typeof options !== 'object') {
    throw new Error('Collapsible field requires an options object')
  }
  if (!options.label || typeof options.label !== 'string') {
    throw new Error('Collapsible field requires a string "label"')
  }
  if (!options.fields || typeof options.fields !== 'object' || options.fields === null) {
    throw new Error('Collapsible field requires a "fields" object')
  }
  return { ...options, type: 'collapsible' }
}

export const fields = {
  text,
  number,
  textarea,
  code,
  json,
  point,
  email,
  slug,
  checkbox,
  select,
  radio,
  date,
  richText,
  relationship,
  upload,
  group,
  array,
  blocks,
  tabs,
  row,
  collapsible,
}

export { flattenFields, isLayoutField } from './flatten'
