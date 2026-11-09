import type { ClientField, ClientBlock } from './client-config'
import type { FilterOperator, FilterValue } from './query'

export type ConditionOperator = FilterOperator | 'exists'

export type ConditionFilter = {
  [K in ConditionOperator]?: K extends 'exists' ? boolean : FilterValue
}

export type ConditionField = ConditionFilter | FilterValue

export interface FieldCondition {
  [field: string]: ConditionField | FieldCondition | FieldCondition[] | undefined
  and?: FieldCondition[]
  or?: FieldCondition[]
}

const OPERATOR_KEYS = new Set<string>([
  'equals',
  'not_equals',
  'contains',
  'in',
  'greater_than',
  'less_than',
  'greater_than_equal',
  'less_than_equal',
  'exists',
])

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

export function getValueByPath(data: unknown, path: string): unknown {
  if (data === null || data === undefined || typeof data !== 'object') {
    return undefined
  }
  const segments = path.split('.')
  let current: unknown = data
  for (const seg of segments) {
    if (FORBIDDEN_KEYS.has(seg)) return undefined
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[seg]
  }
  return current
}

export function resolveConditionTarget(
  path: string,
  rootData: Record<string, unknown>,
  siblingData?: Record<string, unknown>,
): unknown {
  if (path.startsWith('$root.')) {
    return getValueByPath(rootData, path.slice(6))
  }
  return getValueByPath(siblingData ?? rootData, path)
}

function evalEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime()
  }
  if (actual instanceof Date && typeof expected === 'string') {
    return actual.getTime() === new Date(expected).getTime()
  }
  if (typeof actual === 'string' && expected instanceof Date) {
    return new Date(actual).getTime() === expected.getTime()
  }
  return false
}

function evalIn(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(expected)) return false
  return expected.some((item) => evalEquals(actual, item))
}

function evalContains(actual: unknown, expected: unknown): boolean {
  if (
    typeof actual === 'string' &&
    (typeof expected === 'string' || typeof expected === 'number')
  ) {
    return actual.includes(String(expected))
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => evalEquals(item, expected))
  }
  return false
}

function toComparable(val: unknown): number | null {
  if (typeof val === 'number') return val
  if (val instanceof Date) return val.getTime()
  if (typeof val === 'string') {
    const parsed = Date.parse(val)
    if (!Number.isNaN(parsed)) return parsed
    const num = Number(val)
    if (!Number.isNaN(num)) return num
  }
  return null
}

function evalComparison(op: string, actual: unknown, expected: unknown): boolean {
  const a = toComparable(actual)
  const b = toComparable(expected)
  if (a === null || b === null) return false
  if (op === 'greater_than') return a > b
  if (op === 'less_than') return a < b
  if (op === 'greater_than_equal') return a >= b
  if (op === 'less_than_equal') return a <= b
  return false
}

function evalExists(actual: unknown, expected: unknown): boolean {
  const hasValue = actual !== undefined && actual !== null && actual !== ''
  return expected ? hasValue : !hasValue
}

function evaluateOperator(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'equals':
      return evalEquals(actual, expected)
    case 'not_equals':
      return !evalEquals(actual, expected)
    case 'in':
      return evalIn(actual, expected)
    case 'contains':
      return evalContains(actual, expected)
    case 'greater_than':
    case 'less_than':
    case 'greater_than_equal':
    case 'less_than_equal':
      return evalComparison(op, actual, expected)
    case 'exists':
      return evalExists(actual, expected)
    default:
      return false
  }
}

function isOperatorObject(val: unknown): val is Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val) || val instanceof Date) return false
  const keys = Object.keys(val)
  return keys.length > 0 && keys.some((k) => OPERATOR_KEYS.has(k))
}

export function evaluateFieldFilter(actual: unknown, filter: unknown): boolean {
  if (!isOperatorObject(filter)) {
    return evalEquals(actual, filter)
  }
  for (const [op, expected] of Object.entries(filter)) {
    if (expected === undefined) continue
    if (OPERATOR_KEYS.has(op)) {
      if (!evaluateOperator(op, actual, expected)) return false
    }
  }
  return true
}

function evalAnd(
  conditions: unknown,
  data: Record<string, unknown>,
  siblingData?: Record<string, unknown>,
): boolean {
  if (!Array.isArray(conditions)) return true
  return conditions.every((c) => matchesCondition(c as FieldCondition, data, siblingData))
}

function evalOr(
  conditions: unknown,
  data: Record<string, unknown>,
  siblingData?: Record<string, unknown>,
): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true
  return conditions.some((c) => matchesCondition(c as FieldCondition, data, siblingData))
}

function evaluateConditionEntry(
  key: string,
  val: unknown,
  data: Record<string, unknown>,
  siblingData?: Record<string, unknown>,
): boolean {
  if (val === undefined) return true
  if (key === 'and') return evalAnd(val, data, siblingData)
  if (key === 'or') return evalOr(val, data, siblingData)
  const targetVal = resolveConditionTarget(key, data, siblingData)
  return evaluateFieldFilter(targetVal, val)
}

export function matchesCondition(
  condition: FieldCondition | undefined,
  data: Record<string, unknown>,
  siblingData?: Record<string, unknown>,
): boolean {
  if (!condition || typeof condition !== 'object') {
    return true
  }

  const entries = Object.entries(condition)
  if (entries.length === 0) {
    return true
  }

  return entries.every(([key, val]) => evaluateConditionEntry(key, val, data, siblingData))
}

function sanitizeGroupFields(
  fields: readonly ClientField[],
  groupData: Record<string, unknown>,
  rootContext: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...groupData }
  for (const field of fields) {
    if (field.condition && !matchesCondition(field.condition, rootContext, groupData)) {
      result[field.name] = null
    } else {
      sanitizeFieldContainer(field, result, rootContext)
    }
  }
  return result
}

function sanitizeArrayRows(
  fields: readonly ClientField[],
  rows: readonly Record<string, unknown>[],
  rootContext: Record<string, unknown>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row
    const item: Record<string, unknown> = { ...row }
    for (const field of fields) {
      if (field.condition && !matchesCondition(field.condition, rootContext, row)) {
        delete item[field.name]
      } else {
        sanitizeFieldContainer(field, item, rootContext)
      }
    }
    return item
  })
}

function sanitizeBlocksRows(
  blocks: readonly ClientBlock[],
  rows: readonly Record<string, unknown>[],
  rootContext: Record<string, unknown>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row
    const item: Record<string, unknown> = { ...row }
    const blockDef = blocks.find((b) => b.slug === row.blockType)
    if (blockDef) {
      for (const field of blockDef.fields) {
        if (field.condition && !matchesCondition(field.condition, rootContext, row)) {
          delete item[field.name]
        } else {
          sanitizeFieldContainer(field, item, rootContext)
        }
      }
    }
    return item
  })
}

function sanitizeFieldContainer(
  field: ClientField,
  result: Record<string, unknown>,
  context: Record<string, unknown>,
): void {
  const val = result[field.name]
  if (field.type === 'group' && val && typeof val === 'object') {
    result[field.name] = sanitizeGroupFields(field.fields, val as Record<string, unknown>, context)
  } else if (field.type === 'array' && Array.isArray(val)) {
    result[field.name] = sanitizeArrayRows(field.fields, val as Record<string, unknown>[], context)
  } else if (field.type === 'blocks' && Array.isArray(val)) {
    result[field.name] = sanitizeBlocksRows(field.blocks, val as Record<string, unknown>[], context)
  }
}

export function sanitizeConditionalFields(
  fields: readonly ClientField[],
  data: Record<string, unknown>,
  originalDoc?: Record<string, unknown>,
): Record<string, unknown> {
  const context = originalDoc ? { ...originalDoc, ...data } : data
  const result: Record<string, unknown> = { ...data }

  for (const f of fields) {
    if (f.condition && !matchesCondition(f.condition, context, context)) {
      if (f.name in result || (originalDoc && f.name in originalDoc)) {
        result[f.name] = null
      }
      continue
    }

    sanitizeFieldContainer(f, result, context)
  }

  return result
}
