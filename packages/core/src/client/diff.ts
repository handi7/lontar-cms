export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged'

export interface PrimitiveFieldDiff {
  type: 'primitive'
  change: ChangeType
  oldValue?: unknown
  value?: unknown
}

export interface GroupFieldDiff {
  type: 'group'
  fields: Record<string, FieldDiff>
  hasChanges: boolean
}

export interface ArrayItemDiff {
  id: string
  blockType?: string
  change: ChangeType
  orderChanged?: boolean
  oldIndex?: number
  newIndex?: number
  diffs?: Record<string, FieldDiff>
}

export interface ArrayFieldDiff {
  type: 'array'
  items: ArrayItemDiff[]
  hasChanges: boolean
}

export interface BlocksFieldDiff {
  type: 'blocks'
  items: ArrayItemDiff[]
  hasChanges: boolean
}

export type FieldDiff = PrimitiveFieldDiff | GroupFieldDiff | ArrayFieldDiff | BlocksFieldDiff

export interface DocumentDiff {
  fields: Record<string, FieldDiff>
  hasChanges: boolean
}

export interface DiffableFieldItem {
  name?: string
  type: string
  fields?: unknown
  blocks?: unknown
  tabs?: unknown
  localized?: boolean
}

export interface DiffOptions {
  locale?: string
}

export type DiffableFields = readonly DiffableFieldItem[] | Record<string, DiffableFieldItem>

export interface DiffableCollection {
  fields: DiffableFields
  versions?: { drafts?: boolean }
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

function resolvePrimitiveChange(oldVal: unknown, newVal: unknown): ChangeType {
  if (isEqual(oldVal, newVal)) return 'unchanged'
  if (oldVal === undefined || oldVal === null) return 'added'
  if (newVal === undefined || newVal === null) return 'removed'
  return 'modified'
}

export function diffPrimitive(oldVal: unknown, newVal: unknown): PrimitiveFieldDiff {
  const change = resolvePrimitiveChange(oldVal, newVal)
  const diff: PrimitiveFieldDiff = { type: 'primitive', change }
  if (oldVal !== undefined) diff.oldValue = oldVal
  if (newVal !== undefined) diff.value = newVal
  return diff
}

function getItemId(item: unknown): string | undefined {
  if (typeof item === 'object' && item !== null && 'id' in item) {
    return String(item.id)
  }
  return undefined
}

interface ItemEntry {
  id: string
  item: Record<string, unknown>
  index: number
}

function collectItemEntries(val: unknown): ItemEntry[] {
  if (!Array.isArray(val)) return []
  const arr = val as readonly unknown[]
  const entries: ItemEntry[] = []
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i]
    if (typeof raw === 'object' && raw !== null) {
      const id = getItemId(raw) ?? `index-${i}`
      entries.push({ id, item: raw as Record<string, unknown>, index: i })
    }
  }
  return entries
}

function diffMatchedArrayItem(
  fields: DiffableFields,
  oldInfo: ItemEntry,
  newItem: Record<string, unknown>,
  newIdx: number,
  options?: DiffOptions,
): ArrayItemDiff {
  const innerDiff = diffFields(fields, oldInfo.item, newItem, options)
  const orderChanged = oldInfo.index !== newIdx
  const change: ChangeType = innerDiff.hasChanges ? 'modified' : 'unchanged'
  return {
    id: oldInfo.id,
    change,
    orderChanged,
    oldIndex: oldInfo.index,
    newIndex: newIdx,
    diffs: innerDiff.fields,
  }
}

function diffArrayItems(
  fields: DiffableFields,
  oldVal: unknown,
  newVal: unknown,
  options?: DiffOptions,
): { items: ArrayItemDiff[]; hasChanges: boolean } {
  const oldEntries = collectItemEntries(oldVal)
  const newEntries = collectItemEntries(newVal)
  const oldMap = new Map(oldEntries.map((e) => [e.id, e]))
  const newMap = new Map(newEntries.map((e) => [e.id, e]))

  const items: ArrayItemDiff[] = []
  let hasChanges = false

  for (const [newIdx, newInfo] of newEntries.entries()) {
    const oldInfo = oldMap.get(newInfo.id)
    if (!oldInfo) {
      const innerDiff = diffFields(fields, {}, newInfo.item, options)
      items.push({
        id: newInfo.id,
        change: 'added',
        newIndex: newIdx,
        diffs: innerDiff.fields,
      })
      hasChanges = true
    } else {
      const itemDiff = diffMatchedArrayItem(fields, oldInfo, newInfo.item, newIdx, options)
      items.push(itemDiff)
      if (itemDiff.change !== 'unchanged' || itemDiff.orderChanged) {
        hasChanges = true
      }
    }
  }

  for (const oldInfo of oldEntries) {
    if (!newMap.has(oldInfo.id)) {
      const innerDiff = diffFields(fields, oldInfo.item, {}, options)
      items.push({
        id: oldInfo.id,
        change: 'removed',
        oldIndex: oldInfo.index,
        diffs: innerDiff.fields,
      })
      hasChanges = true
    }
  }

  return { items, hasChanges }
}

function findBlockDef(
  blocks: unknown,
  blockType?: string,
): { slug: string; fields: DiffableFields } | undefined {
  if (!blockType) return undefined
  if (Array.isArray(blocks)) {
    return blocks.find((b: { slug?: string }) => b.slug === blockType) as
      { slug: string; fields: DiffableFields } | undefined
  }
  if (typeof blocks === 'object' && blocks !== null) {
    return (blocks as Record<string, { slug: string; fields: DiffableFields }>)[blockType]
  }
  return undefined
}

function diffMatchedBlockItem(
  blocks: unknown,
  oldInfo: ItemEntry,
  newItem: Record<string, unknown>,
  newIdx: number,
  options?: DiffOptions,
): ArrayItemDiff {
  const oldType = typeof oldInfo.item.blockType === 'string' ? oldInfo.item.blockType : undefined
  const newType = typeof newItem.blockType === 'string' ? newItem.blockType : undefined
  const orderChanged = oldInfo.index !== newIdx

  if (oldType !== newType) {
    return {
      id: oldInfo.id,
      blockType: newType,
      change: 'modified',
      orderChanged,
      oldIndex: oldInfo.index,
      newIndex: newIdx,
    }
  }

  const blockDef = findBlockDef(blocks, newType)
  const innerDiff = blockDef
    ? diffFields(blockDef.fields, oldInfo.item, newItem, options)
    : { fields: {}, hasChanges: false }

  const change: ChangeType = innerDiff.hasChanges ? 'modified' : 'unchanged'
  return {
    id: oldInfo.id,
    blockType: newType,
    change,
    orderChanged,
    oldIndex: oldInfo.index,
    newIndex: newIdx,
    diffs: innerDiff.fields,
  }
}

function buildStandaloneBlockDiff(
  blocks: unknown,
  blockType: string | undefined,
  oldItem: Record<string, unknown>,
  newItem: Record<string, unknown>,
  options?: DiffOptions,
): Record<string, FieldDiff> {
  const blockDef = findBlockDef(blocks, blockType)
  if (!blockDef) return {}
  return diffFields(blockDef.fields, oldItem, newItem, options).fields
}

function diffBlockItems(
  blocks: unknown,
  oldVal: unknown,
  newVal: unknown,
  options?: DiffOptions,
): { items: ArrayItemDiff[]; hasChanges: boolean } {
  const oldEntries = collectItemEntries(oldVal)
  const newEntries = collectItemEntries(newVal)
  const oldMap = new Map(oldEntries.map((e) => [e.id, e]))
  const newMap = new Map(newEntries.map((e) => [e.id, e]))

  const items: ArrayItemDiff[] = []
  let hasChanges = false

  for (const [newIdx, newInfo] of newEntries.entries()) {
    const oldInfo = oldMap.get(newInfo.id)
    const blockType =
      typeof newInfo.item.blockType === 'string' ? newInfo.item.blockType : undefined
    if (!oldInfo) {
      items.push({
        id: newInfo.id,
        blockType,
        change: 'added',
        newIndex: newIdx,
        diffs: buildStandaloneBlockDiff(blocks, blockType, {}, newInfo.item, options),
      })
      hasChanges = true
    } else {
      const itemDiff = diffMatchedBlockItem(blocks, oldInfo, newInfo.item, newIdx, options)
      items.push(itemDiff)
      if (itemDiff.change !== 'unchanged' || itemDiff.orderChanged) {
        hasChanges = true
      }
    }
  }

  for (const oldInfo of oldEntries) {
    if (!newMap.has(oldInfo.id)) {
      const blockType =
        typeof oldInfo.item.blockType === 'string' ? oldInfo.item.blockType : undefined
      items.push({
        id: oldInfo.id,
        blockType,
        change: 'removed',
        oldIndex: oldInfo.index,
        diffs: buildStandaloneBlockDiff(blocks, blockType, oldInfo.item, {}, options),
      })
      hasChanges = true
    }
  }

  return { items, hasChanges }
}

function diffGroupField(
  subFields: unknown,
  oldVal: unknown,
  newVal: unknown,
  options?: DiffOptions,
): { diff: GroupFieldDiff; hasChanges: boolean } {
  const oldGroup =
    typeof oldVal === 'object' && oldVal !== null ? (oldVal as Record<string, unknown>) : {}
  const newGroup =
    typeof newVal === 'object' && newVal !== null ? (newVal as Record<string, unknown>) : {}
  const inner = diffFields(subFields as DiffableFields, oldGroup, newGroup, options)
  return {
    diff: { type: 'group', fields: inner.fields, hasChanges: inner.hasChanges },
    hasChanges: inner.hasChanges,
  }
}

function diffArrayField(
  subFields: unknown,
  oldVal: unknown,
  newVal: unknown,
  options?: DiffOptions,
): { diff: ArrayFieldDiff; hasChanges: boolean } {
  const result = diffArrayItems(subFields as DiffableFields, oldVal, newVal, options)
  return {
    diff: { type: 'array', items: result.items, hasChanges: result.hasChanges },
    hasChanges: result.hasChanges,
  }
}

function diffBlocksField(
  blocks: unknown,
  oldVal: unknown,
  newVal: unknown,
  options?: DiffOptions,
): { diff: BlocksFieldDiff; hasChanges: boolean } {
  const result = diffBlockItems(blocks, oldVal, newVal, options)
  return {
    diff: { type: 'blocks', items: result.items, hasChanges: result.hasChanges },
    hasChanges: result.hasChanges,
  }
}

function extractLocaleValue(val: unknown, locale: string): unknown {
  if (
    val &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    locale in (val as Record<string, unknown>)
  ) {
    return (val as Record<string, unknown>)[locale]
  }
  return val
}

function resolveDiffValues(
  field: { localized?: boolean },
  oldVal: unknown,
  newVal: unknown,
  options?: DiffOptions,
): { oldVal: unknown; newVal: unknown } {
  if (field.localized && options?.locale && options.locale !== 'all') {
    return {
      oldVal: extractLocaleValue(oldVal, options.locale),
      newVal: extractLocaleValue(newVal, options.locale),
    }
  }
  return { oldVal, newVal }
}

function diffSingleField(
  field: DiffableFieldItem,
  rawOldVal: unknown,
  rawNewVal: unknown,
  options?: DiffOptions,
): { diff: FieldDiff; hasChanges: boolean } {
  const { oldVal, newVal } = resolveDiffValues(field, rawOldVal, rawNewVal, options)

  if (field.type === 'group' && field.fields) {
    return diffGroupField(field.fields, oldVal, newVal, options)
  }
  if (field.type === 'array' && field.fields) {
    return diffArrayField(field.fields, oldVal, newVal, options)
  }
  if (field.type === 'blocks' && field.blocks) {
    return diffBlocksField(field.blocks, oldVal, newVal, options)
  }

  const primitive = diffPrimitive(oldVal, newVal)
  return {
    diff: primitive,
    hasChanges: primitive.change !== 'unchanged',
  }
}

function isDiffableFieldItem(val: unknown): val is DiffableFieldItem & { name: string } {
  return (
    typeof val === 'object' &&
    val !== null &&
    'type' in val &&
    typeof val.type === 'string' &&
    'name' in val &&
    typeof (val as { name: unknown }).name === 'string' &&
    Boolean((val as { name: string }).name)
  )
}

function iterateLayoutField(
  field: DiffableFieldItem,
  list: Array<{ name: string; field: DiffableFieldItem }>,
): boolean {
  if (field.type === 'tabs' && Array.isArray(field.tabs)) {
    for (const tab of field.tabs as Array<{ fields?: unknown }>) {
      if (tab && tab.fields) {
        list.push(...iterateFields(tab.fields as DiffableFields))
      }
    }
    return true
  }
  if ((field.type === 'row' || field.type === 'collapsible') && field.fields) {
    list.push(...iterateFields(field.fields as DiffableFields))
    return true
  }
  return false
}

function iterateFields(fields: DiffableFields): Array<{ name: string; field: DiffableFieldItem }> {
  const list: Array<{ name: string; field: DiffableFieldItem }> = []
  if (Array.isArray(fields)) {
    const arr = fields as readonly unknown[]
    for (const f of arr) {
      if (isDiffableFieldItem(f) && f.type !== 'join' && !iterateLayoutField(f, list)) {
        list.push({ name: f.name, field: f })
      }
    }
    return list
  }
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'join') continue
    if (!iterateLayoutField(field, list)) {
      list.push({ name, field })
    }
  }
  return list
}

export function diffFields(
  fields: DiffableFields,
  oldDoc: Record<string, unknown>,
  newDoc: Record<string, unknown>,
  options?: DiffOptions,
): { fields: Record<string, FieldDiff>; hasChanges: boolean } {
  const diffs: Record<string, FieldDiff> = {}
  let hasChanges = false

  const entries = iterateFields(fields)
  for (const { name, field } of entries) {
    const oldVal = oldDoc[name]
    const newVal = newDoc[name]
    const { diff, hasChanges: fieldChanged } = diffSingleField(field, oldVal, newVal, options)
    diffs[name] = diff
    if (fieldChanged) {
      hasChanges = true
    }
  }

  return { fields: diffs, hasChanges }
}

export function diffSnapshots(
  collection: DiffableCollection,
  oldSnapshot: Record<string, unknown>,
  newSnapshot: Record<string, unknown>,
  options?: DiffOptions,
): DocumentDiff {
  const result = diffFields(collection.fields, oldSnapshot, newSnapshot, options)

  if (collection.versions?.drafts) {
    const statusDiff = diffPrimitive(oldSnapshot._status, newSnapshot._status)
    result.fields._status = statusDiff
    if (statusDiff.change !== 'unchanged') {
      result.hasChanges = true
    }
  }

  return {
    fields: result.fields,
    hasChanges: result.hasChanges,
  }
}
