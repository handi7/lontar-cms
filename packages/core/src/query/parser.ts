import type { FilterOperator, SortItem, Where } from './types'

const KNOWN_OPERATORS: ReadonlySet<string> = new Set<FilterOperator>([
  'equals',
  'not_equals',
  'contains',
  'in',
  'greater_than',
  'less_than',
  'greater_than_equal',
  'less_than_equal',
])

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_DEPTH = 10
const MAX_ARRAY_INDEX = 100

function isValidSegment(seg: string): boolean {
  if (FORBIDDEN_KEYS.has(seg)) return false
  if (/^\d+$/.test(seg) && parseInt(seg, 10) > MAX_ARRAY_INDEX) return false
  return true
}

function parseBracketPath(key: string): string[] | null {
  if (key === 'where') return ['where']
  if (!/^where(\[[^\]]*\])+$/.test(key)) return null

  const matches = [...key.matchAll(/\[([^\]]*)\]/g)]
  if (matches.length === 0 || matches.length + 1 > MAX_DEPTH) return null

  const segments: string[] = ['where']
  for (const match of matches) {
    const seg = match[1] ?? ''
    if (!isValidSegment(seg)) return null
    segments.push(seg)
  }

  return segments
}

function normalizeLeafValue(lastSegment: string, value: unknown): unknown {
  if (lastSegment === 'in' && typeof value === 'string') {
    return value.split(',').map((s) => s.trim())
  }
  return value
}

function assignArrayLeaf(target: unknown[], segment: string, value: unknown) {
  if (segment === '') {
    if (target.length < MAX_ARRAY_INDEX) {
      target.push(value)
    }
    return
  }

  const idx = parseInt(segment, 10)
  if (!Number.isNaN(idx) && idx >= 0 && idx <= MAX_ARRAY_INDEX) {
    target[idx] = value
  }
}

function assignLeaf(target: Record<string, unknown> | unknown[], segment: string, value: unknown) {
  if (FORBIDDEN_KEYS.has(segment)) return
  const normalized = normalizeLeafValue(segment, value)
  if (Array.isArray(target)) {
    assignArrayLeaf(target, segment, normalized)
  } else {
    target[segment] = normalized
  }
}

function getOrCreateArrayContainer(
  current: unknown[],
  segment: string,
  container: Record<string, unknown> | unknown[],
): Record<string, unknown> | unknown[] | null {
  if (segment === '') {
    current.push(container)
    return container
  }
  const idx = parseInt(segment, 10)
  if (Number.isNaN(idx) || idx < 0 || idx > MAX_ARRAY_INDEX) {
    return null
  }
  if (!current[idx] || typeof current[idx] !== 'object') {
    current[idx] = container
  }
  return current[idx] as Record<string, unknown> | unknown[]
}

function getOrCreateObjectContainer(
  current: Record<string, unknown>,
  segment: string,
  container: Record<string, unknown> | unknown[],
): Record<string, unknown> | unknown[] {
  if (
    !Object.prototype.hasOwnProperty.call(current, segment) ||
    typeof current[segment] !== 'object' ||
    current[segment] === null
  ) {
    current[segment] = container
  }
  return current[segment] as Record<string, unknown> | unknown[]
}

function getOrCreateContainer(
  current: Record<string, unknown> | unknown[],
  segment: string,
  nextIsArray: boolean,
): Record<string, unknown> | unknown[] | null {
  if (FORBIDDEN_KEYS.has(segment)) return null
  const container = nextIsArray ? [] : {}

  if (Array.isArray(current)) {
    return getOrCreateArrayContainer(current, segment, container)
  }
  return getOrCreateObjectContainer(current, segment, container)
}

function setDeep(root: Record<string, unknown>, path: string[], value: unknown) {
  if (path.length > MAX_DEPTH) return
  let current: Record<string, unknown> | unknown[] = root

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]
    if (segment === undefined || FORBIDDEN_KEYS.has(segment)) return
    const nextSegment = path[i + 1] ?? ''
    const nextIsArray = /^\d+$/.test(nextSegment) || nextSegment === ''
    const nextContainer = getOrCreateContainer(current, segment, nextIsArray)
    if (!nextContainer) return
    current = nextContainer
  }

  const lastSegment = path[path.length - 1]
  if (lastSegment !== undefined) {
    assignLeaf(current, lastSegment, value)
  }
}

function sanitizeJsonArray(arr: unknown[], depth: number): unknown[] {
  const result: unknown[] = []
  const limit = Math.min(arr.length, MAX_ARRAY_INDEX)
  for (let i = 0; i < limit; i++) {
    const sanitized = sanitizeJsonValue(arr[i], depth + 1)
    if (sanitized !== undefined) {
      result.push(sanitized)
    }
  }
  return result
}

function sanitizeJsonObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    const sanitized = sanitizeJsonValue(val, depth + 1)
    if (sanitized !== undefined) {
      result[key] = sanitized
    }
  }
  return result
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return sanitizeJsonArray(value, depth)
  }
  return sanitizeJsonObject(value as Record<string, unknown>, depth)
}

function parseJsonWhere(raw: string): Where | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return sanitizeJsonObject(parsed as Record<string, unknown>, 0) as Where
  } catch {
    return null
  }
}

export function parseWhere(entries: Iterable<[string, string | string[]]>): Where | undefined {
  const rawRoot: { where?: unknown } = {}

  for (const [key, value] of entries) {
    if (key === 'where' && typeof value === 'string') {
      const jsonParsed = parseJsonWhere(value)
      if (jsonParsed) return jsonParsed
    }

    const path = parseBracketPath(key)
    if (!path) continue

    setDeep(rawRoot, path, value)
  }

  const result = rawRoot.where
  if (!result || typeof result !== 'object') return undefined
  return result as Where
}

export function parseWhereFromSearchParams(searchParams: URLSearchParams): Where | undefined {
  return parseWhere(searchParams.entries())
}

function parseSingleSortItem(item: string): SortItem | null {
  const trimmed = item.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('-')) {
    const field = trimmed.slice(1).trim()
    return field ? { field, direction: 'desc' } : null
  }

  const field = (trimmed.startsWith('+') ? trimmed.slice(1) : trimmed).trim()
  return field ? { field, direction: 'asc' } : null
}

export function parseSort(rawSort: string | string[] | undefined): SortItem[] {
  if (!rawSort) return []
  const items = Array.isArray(rawSort) ? rawSort.flatMap((s) => s.split(',')) : rawSort.split(',')

  const result: SortItem[] = []
  for (const item of items) {
    const parsed = parseSingleSortItem(item)
    if (parsed) {
      result.push(parsed)
    }
  }

  return result
}

export { KNOWN_OPERATORS }
