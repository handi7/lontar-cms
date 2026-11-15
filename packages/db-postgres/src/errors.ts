import { DrizzleError } from 'drizzle-orm'
import {
  CheckConstraintError,
  DatabaseError,
  ForeignKeyConstraintError,
  NotNullConstraintError,
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
  column?: string
}

function nextCause(current: object): unknown {
  if ('cause' in current && current.cause && current.cause !== current) {
    return current.cause
  }
  return undefined
}

function hasPostgresRawProps(raw: PostgresRawError): boolean {
  return Boolean(
    raw.code || raw.detail || raw.constraint || raw.routine || raw.severity || raw.column,
  )
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
    typeof raw.severity === 'string' ||
    typeof raw.column === 'string'
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

function parsePostgresFkDetail(detail?: string): {
  keyName?: string
  keyValue?: string
  targetTable?: string
  referencingTable?: string
} {
  if (!detail) return {}
  const keyMatch = /Key \(([^)]+)\)=\((.*)\)/.exec(detail)
  const missingMatch = /is not present in table "([^"]+)"/.exec(detail)
  const referencedMatch = /is still referenced from table "([^"]+)"/.exec(detail)
  return {
    keyName: keyMatch?.[1],
    keyValue: keyMatch?.[2],
    targetTable: missingMatch?.[1],
    referencingTable: referencedMatch?.[1],
  }
}

function buildForeignKeyConstraintError(
  pgErr: PostgresRawError,
  err: unknown,
  context?: ErrorContext,
): ForeignKeyConstraintError {
  const { keyName, targetTable, referencingTable } = parsePostgresFkDetail(pgErr.detail)
  const table = referencingTable ?? targetTable ?? pgErr.table
  const field = resolveFieldName(keyName, pgErr.constraint, context)

  let msg = 'Foreign key constraint violation'
  if (referencingTable) {
    msg = `Cannot delete or update row referenced by "${referencingTable}"`
  } else if (field) {
    msg = `Referenced document for field "${field}" does not exist`
  } else if (targetTable) {
    msg = `Referenced row in table "${targetTable}" does not exist`
  }

  return new ForeignKeyConstraintError(msg, {
    field,
    table,
    constraint: pgErr.constraint,
    cause: err,
  })
}

function parsePostgresNotNullColumn(pgErr: PostgresRawError, rawMsg: string): string | undefined {
  if (pgErr.column) return pgErr.column
  const match = /null value in column "([^"]+)"/.exec(rawMsg)
  return match?.[1]
}

function buildNotNullConstraintError(
  pgErr: PostgresRawError,
  err: unknown,
  context?: ErrorContext,
): NotNullConstraintError {
  const rawMsg = pgErr.message ?? (err instanceof Error ? err.message : '')
  const column = parsePostgresNotNullColumn(pgErr, rawMsg)
  const field =
    column && context?.fields ? findFieldName(column, context.fields, context.slug) : column
  const msg = field ? `Field "${field}" is required` : 'Not-null constraint violation'

  return new NotNullConstraintError(msg, {
    field,
    column,
    cause: err,
  })
}

function parsePostgresCheckConstraint(pgErr: PostgresRawError, rawMsg: string): string | undefined {
  if (pgErr.constraint) return pgErr.constraint
  const match = /violates check constraint "([^"]+)"/.exec(rawMsg)
  return match?.[1]
}

function buildCheckConstraintError(
  pgErr: PostgresRawError,
  err: unknown,
  context?: ErrorContext,
): CheckConstraintError {
  const rawMsg = pgErr.message ?? (err instanceof Error ? err.message : '')
  const constraint = parsePostgresCheckConstraint(pgErr, rawMsg)
  const field =
    constraint && context?.fields
      ? findFieldName(constraint, context.fields, context.slug)
      : undefined
  const msg = field
    ? `Value violates check constraint for field "${field}"`
    : 'Check constraint violation'

  return new CheckConstraintError(msg, {
    field,
    constraint,
    cause: err,
  })
}

function isKnownDatabaseError(err: unknown): err is DatabaseError {
  return (
    err instanceof UniqueConstraintError ||
    err instanceof ForeignKeyConstraintError ||
    err instanceof NotNullConstraintError ||
    err instanceof CheckConstraintError ||
    err instanceof DatabaseError
  )
}

function mapPostgresError(
  pgErr: PostgresRawError,
  err: unknown,
  context?: ErrorContext,
): DatabaseError | null {
  switch (pgErr.code) {
    case '23505':
      return buildUniqueConstraintError(pgErr, err, context)
    case '23503':
      return buildForeignKeyConstraintError(pgErr, err, context)
    case '23502':
      return buildNotNullConstraintError(pgErr, err, context)
    case '23514':
      return buildCheckConstraintError(pgErr, err, context)
    default:
      return null
  }
}

export function handleDatabaseError(err: unknown, context?: ErrorContext): never {
  if (isKnownDatabaseError(err)) {
    throw err
  }

  if (!isDriverError(err)) {
    throw err as Error
  }

  const pgErr = extractPostgresError(err)
  if (pgErr) {
    const mapped = mapPostgresError(pgErr, err, context)
    if (mapped) throw mapped
  }

  throw new DatabaseError('Database operation failed', { cause: err })
}
