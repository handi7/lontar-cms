import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { BlockConfig, Field, Fields } from '../fields/types'

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
  const oldEmpty = oldVal === undefined || oldVal === null
  const newEmpty = newVal === undefined || newVal === null
  if (oldEmpty && !newEmpty) return 'added'
  if (!oldEmpty && newEmpty) return 'removed'
  return 'modified'
}

function diffPrimitive(oldVal: unknown, newVal: unknown): PrimitiveFieldDiff {
  const change = resolvePrimitiveChange(oldVal, newVal)
  return {
    type: 'primitive',
    change,
    oldValue: oldVal,
    value: newVal,
  }
}

type ItemRecord = Record<string, unknown> & { id: string; blockType?: string }

function asItemArray(raw: unknown): ItemRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is ItemRecord => typeof item === 'object' && item !== null)
}

function mapItemsById(items: ItemRecord[]): Map<string, { item: ItemRecord; index: number }> {
  const map = new Map<string, { item: ItemRecord; index: number }>()
  let i = 0
  for (const item of items) {
    if (item.id) {
      map.set(String(item.id), { item, index: i })
    }
    i++
  }
  return map
}

function diffMatchedArrayItem(
  fields: Fields,
  oldInfo: { item: ItemRecord; index: number },
  newItem: ItemRecord,
  newIndex: number,
): ArrayItemDiff {
  const innerDiff = diffFields(fields, oldInfo.item, newItem)
  const orderChanged = oldInfo.index !== newIndex
  const change: ChangeType = innerDiff.hasChanges ? 'modified' : 'unchanged'
  return {
    id: String(newItem.id),
    change,
    orderChanged,
    oldIndex: oldInfo.index,
    newIndex,
    diffs: innerDiff.fields,
  }
}

function diffArrayItems(
  fields: Fields,
  oldRaw: unknown,
  newRaw: unknown,
): { items: ArrayItemDiff[]; hasChanges: boolean } {
  const oldItems = asItemArray(oldRaw)
  const newItems = asItemArray(newRaw)
  const oldMap = mapItemsById(oldItems)
  const newMap = mapItemsById(newItems)

  const items: ArrayItemDiff[] = []

  let newIdx = 0
  for (const newItem of newItems) {
    const oldInfo = oldMap.get(String(newItem.id))
    if (oldInfo) {
      items.push(diffMatchedArrayItem(fields, oldInfo, newItem, newIdx))
    } else {
      items.push({
        id: String(newItem.id),
        change: 'added',
        newIndex: newIdx,
      })
    }
    newIdx++
  }

  let oldIdx = 0
  for (const oldItem of oldItems) {
    if (!newMap.has(String(oldItem.id))) {
      items.push({
        id: String(oldItem.id),
        change: 'removed',
        oldIndex: oldIdx,
      })
    }
    oldIdx++
  }

  const hasChanges = items.some((it) => it.change !== 'unchanged' || it.orderChanged)
  return { items, hasChanges }
}

function diffMatchedBlockItem(
  blocks: readonly BlockConfig[],
  oldInfo: { item: ItemRecord; index: number },
  newItem: ItemRecord,
  newIndex: number,
): ArrayItemDiff {
  const blockType = newItem.blockType ?? oldInfo.item.blockType
  const orderChanged = oldInfo.index !== newIndex

  if (oldInfo.item.blockType !== newItem.blockType) {
    return {
      id: String(newItem.id),
      blockType,
      change: 'modified',
      orderChanged,
      oldIndex: oldInfo.index,
      newIndex,
    }
  }

  const blockDef = blocks.find((b) => b.slug === blockType)
  const innerDiff = blockDef
    ? diffFields(blockDef.fields, oldInfo.item, newItem)
    : { fields: {}, hasChanges: false }
  const change: ChangeType = innerDiff.hasChanges ? 'modified' : 'unchanged'

  return {
    id: String(newItem.id),
    blockType,
    change,
    orderChanged,
    oldIndex: oldInfo.index,
    newIndex,
    diffs: innerDiff.fields,
  }
}

function diffBlockItems(
  blocks: readonly BlockConfig[],
  oldRaw: unknown,
  newRaw: unknown,
): { items: ArrayItemDiff[]; hasChanges: boolean } {
  const oldItems = asItemArray(oldRaw)
  const newItems = asItemArray(newRaw)
  const oldMap = mapItemsById(oldItems)
  const newMap = mapItemsById(newItems)

  const items: ArrayItemDiff[] = []

  let newIdx = 0
  for (const newItem of newItems) {
    const oldInfo = oldMap.get(String(newItem.id))
    if (oldInfo) {
      items.push(diffMatchedBlockItem(blocks, oldInfo, newItem, newIdx))
    } else {
      items.push({
        id: String(newItem.id),
        blockType: newItem.blockType,
        change: 'added',
        newIndex: newIdx,
      })
    }
    newIdx++
  }

  let oldIdx = 0
  for (const oldItem of oldItems) {
    if (!newMap.has(String(oldItem.id))) {
      items.push({
        id: String(oldItem.id),
        blockType: oldItem.blockType,
        change: 'removed',
        oldIndex: oldIdx,
      })
    }
    oldIdx++
  }

  const hasChanges = items.some((it) => it.change !== 'unchanged' || it.orderChanged)
  return { items, hasChanges }
}

function diffSingleField(
  field: Field,
  oldVal: unknown,
  newVal: unknown,
): { diff: FieldDiff; hasChanges: boolean } {
  if (field.type === 'group') {
    const oldGroup =
      typeof oldVal === 'object' && oldVal !== null ? (oldVal as Record<string, unknown>) : {}
    const newGroup =
      typeof newVal === 'object' && newVal !== null ? (newVal as Record<string, unknown>) : {}
    const inner = diffFields(field.fields, oldGroup, newGroup)
    return {
      diff: { type: 'group', fields: inner.fields, hasChanges: inner.hasChanges },
      hasChanges: inner.hasChanges,
    }
  }

  if (field.type === 'array') {
    const result = diffArrayItems(field.fields, oldVal, newVal)
    return {
      diff: { type: 'array', items: result.items, hasChanges: result.hasChanges },
      hasChanges: result.hasChanges,
    }
  }

  if (field.type === 'blocks') {
    const result = diffBlockItems(field.blocks, oldVal, newVal)
    return {
      diff: { type: 'blocks', items: result.items, hasChanges: result.hasChanges },
      hasChanges: result.hasChanges,
    }
  }

  const primitive = diffPrimitive(oldVal, newVal)
  return {
    diff: primitive,
    hasChanges: primitive.change !== 'unchanged',
  }
}

export function diffFields(
  fields: Fields,
  oldDoc: Record<string, unknown>,
  newDoc: Record<string, unknown>,
): { fields: Record<string, FieldDiff>; hasChanges: boolean } {
  const diffs: Record<string, FieldDiff> = {}
  let hasChanges = false

  for (const [name, field] of Object.entries(fields)) {
    const oldVal = oldDoc[name]
    const newVal = newDoc[name]
    const { diff, hasChanges: fieldChanged } = diffSingleField(field, oldVal, newVal)
    diffs[name] = diff
    if (fieldChanged) {
      hasChanges = true
    }
  }

  return { fields: diffs, hasChanges }
}

export function diffSnapshots(
  collection: CollectionConfig,
  oldSnapshot: DocumentData,
  newSnapshot: DocumentData,
): DocumentDiff {
  const result = diffFields(collection.fields, oldSnapshot, newSnapshot)

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
