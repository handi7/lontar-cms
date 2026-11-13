import { DrizzleError } from 'drizzle-orm'
import {
  DatabaseError,
  UniqueConstraintError,
  type CollectionConfig,
  type GlobalConfig,
} from '@lontar/core'

export interface ErrorContext {
  slug?: string
  fields?: Record<string, unknown>
}

export function toErrorContext(target?: CollectionConfig | GlobalConfig): ErrorContext | undefined {
  if (!target) return undefined
  return {
    slug: target.slug,
    fields: target.fields,
  }
}

function stripTablePrefix(cleanKey: string, tableSlug?: string): string {
  if (tableSlug && cleanKey.startsWith(`${tableSlug}_`)) {
    return cleanKey.slice(tableSlug.length + 1)
  }
  return cleanKey
}

function stripUniqueSuffix(key: string): string {
  if (key.endsWith('_unique')) {
    return key.slice(0, -'_unique'.length)
  }
  return key
}

function fuzzyFindField(cleanKey: string, fields: Record<string, unknown>): string | undefined {
  for (const name of Object.keys(fields)) {
    if (
      cleanKey === name ||
      cleanKey.includes(`_${name}_`) ||
      cleanKey.endsWith(`_${name}`) ||
      cleanKey.startsWith(`${name}_`)
    ) {
      return name
    }
  }
  return undefined
}

export function findFieldName(
  key: string,
  fields: Record<string, unknown>,
  tableSlug?: string,
): string | undefined {
  const cleanKey = key.includes('.') ? (key.split('.').pop() ?? key) : key
  if (cleanKey === 'PRIMARY' || cleanKey.endsWith('_pkey')) return 'id'
  if (cleanKey in fields) return cleanKey

  const withoutTable = stripTablePrefix(cleanKey, tableSlug)
  if (withoutTable in fields) return withoutTable

  const strippedSuffix = stripUniqueSuffix(withoutTable)
  if (strippedSuffix in fields) return strippedSuffix

  return fuzzyFindField(cleanKey, fields)
}

interface PostgresRawError {
  code?: string
  detail?: string
  constraint?: string
  table?: string
  schema?: string
  routine?: string
  severity?: string
  message?: string
}

function nextCause(current: object): unknown {
  if ('cause' in current && current.cause && current.cause !== current) {
    return current.cause
  }
  return undefined
}

function hasPostgresRawProps(raw: PostgresRawError): boolean {
  return Boolean(raw.code || raw.detail || raw.constraint || raw.routine || raw.severity)
}

function extractPostgresError(err: unknown): PostgresRawError | undefined {
  let current: unknown = err
  while (typeof current === 'object' && current !== null) {
    const raw = current as PostgresRawError
    if (hasPostgresRawProps(raw)) {
      return raw
    }
    current = nextCause(current)
  }
  return undefined
}

function hasNetworkErrorCode(code: string): boolean {
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'
}

function hasPostgresErrorCode(code: string): boolean {
  return /^[0-9A-Z]{5}$/.test(code) || hasNetworkErrorCode(code)
}

function hasPostgresErrorProperties(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const raw = err as PostgresRawError
  if (
    typeof raw.constraint === 'string' ||
    typeof raw.detail === 'string' ||
    typeof raw.routine === 'string' ||
    typeof raw.severity === 'string'
  ) {
    return true
  }
  return typeof raw.code === 'string' && hasPostgresErrorCode(raw.code)
}

function matchesDriverError(target: unknown): boolean {
  if (target instanceof DrizzleError) {
    return true
  }
  return hasPostgresErrorProperties(target)
}

export function isDriverError(err: unknown): boolean {
  let current: unknown = err
  while (typeof current === 'object' && current !== null) {
    if (matchesDriverError(current)) {
      return true
    }
    current = nextCause(current)
  }
  return false
}

function parsePostgresDetail(detail?: string): { field?: string; value?: string } {
  if (!detail) return {}
  const match = /Key \(([^)]+)\)=\((.*)\) already exists/.exec(detail)
  if (!match) return {}
  return { field: match[1], value: match[2] }
}

function resolveFieldName(
  parsedField: string | undefined,
  constraint: string | undefined,
  context?: ErrorContext,
): string | undefined {
  if (!context?.fields) return parsedField
  if (parsedField && parsedField in context.fields) {
    return parsedField
  }
  if (constraint) {
    return findFieldName(constraint, context.fields, context.slug)
  }
  if (parsedField) {
    return findFieldName(parsedField, context.fields, context.slug)
  }
  return undefined
}

function buildUniqueConstraintError(
  pgErr: PostgresRawError,
  err: unknown,
  context?: ErrorContext,
): UniqueConstraintError {
  const { field: parsedField, value } = parsePostgresDetail(pgErr.detail)
  const field = resolveFieldName(parsedField, pgErr.constraint, context)

  const msg = field
    ? `Value "${value ?? ''}" is already taken for field "${field}"`
    : 'Unique constraint violation'

  return new UniqueConstraintError(msg, { field, value, cause: err })
}

export function handleDatabaseError(err: unknown, context?: ErrorContext): never {
  if (err instanceof UniqueConstraintError || err instanceof DatabaseError) {
    throw err
  }

  if (!isDriverError(err)) {
    throw err as Error
  }

  const pgErr = extractPostgresError(err)
  if (pgErr?.code === '23505') {
    throw buildUniqueConstraintError(pgErr, err, context)
  }

  throw new DatabaseError('Database operation failed', { cause: err })
}
