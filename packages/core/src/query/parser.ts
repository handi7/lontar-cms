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

function parseBracketPath(key: string): string[] | null {
  if (key === 'where') return ['where']
  if (!key.startsWith('where[')) return null

  const matches = [...key.matchAll(/\[([^\]]*)\]/g)]
  if (matches.length === 0) return null
  return ['where', ...matches.map((m) => m[1] ?? '')]
}

function normalizeLeafValue(lastSegment: string, value: unknown): unknown {
  if (lastSegment === 'in') {
    if (typeof value === 'string') {
      return value.split(',').map((s) => s.trim())
    }
  }
  return value
}

function assignLeaf(target: Record<string, unknown> | unknown[], segment: string, value: unknown) {
  const normalized = normalizeLeafValue(segment, value)
  if (Array.isArray(target)) {
    if (segment === '') {
      target.push(normalized)
    } else {
      const idx = parseInt(segment, 10)
      if (!Number.isNaN(idx)) {
        target[idx] = normalized
      }
    }
  } else {
    target[segment] = normalized
  }
}

function getOrCreateContainer(
  current: Record<string, unknown> | unknown[],
  segment: string,
  nextIsArray: boolean,
): Record<string, unknown> | unknown[] {
  const container = nextIsArray ? [] : {}
  if (Array.isArray(current)) {
    const idx = parseInt(segment, 10)
    if (!current[idx] || typeof current[idx] !== 'object') {
      current[idx] = container
    }
    return current[idx] as Record<string, unknown> | unknown[]
  }

  if (!current[segment] || typeof current[segment] !== 'object') {
    current[segment] = container
  }
  return current[segment] as Record<string, unknown> | unknown[]
}

function setDeep(root: Record<string, unknown>, path: string[], value: unknown) {
  let current: Record<string, unknown> | unknown[] = root

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]
    if (segment === undefined) continue
    const nextSegment = path[i + 1] ?? ''
    const nextIsArray = /^\d+$/.test(nextSegment) || nextSegment === ''
    current = getOrCreateContainer(current, segment, nextIsArray)
  }

  const lastSegment = path[path.length - 1]
  if (lastSegment !== undefined) {
    assignLeaf(current, lastSegment, value)
  }
}

function parseJsonWhere(raw: string): Where | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Where) : null
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
