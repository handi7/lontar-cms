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

function stripLocaleSuffix(key: string): string {
  return key.replace(/_[a-z]{2,3}(-[a-zA-Z0-9]{2,4})?$/, '')
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
  if (cleanKey === 'PRIMARY') return 'id'
  if (cleanKey in fields) return cleanKey

  const withoutTable = stripTablePrefix(cleanKey, tableSlug)
  if (withoutTable in fields) return withoutTable

  const strippedSuffix = stripUniqueSuffix(withoutTable)
  if (strippedSuffix in fields) return strippedSuffix

  const withoutLocale = stripLocaleSuffix(strippedSuffix)
  if (withoutLocale in fields) return withoutLocale

  return fuzzyFindField(cleanKey, fields)
}

interface MysqlRawError {
  code?: string
  errno?: number
  sqlMessage?: string
  sqlState?: string
  message?: string
}

function extractMysqlError(err: unknown): MysqlRawError | undefined {
  let current: unknown = err
  while (typeof current === 'object' && current !== null) {
    const raw = current as MysqlRawError
    if (raw.code || raw.errno !== undefined || raw.sqlMessage || raw.sqlState) {
      return raw
    }
    if ('cause' in current && current.cause && current.cause !== current) {
      current = current.cause
    } else {
      break
    }
  }
  return undefined
}

function hasMysqlErrorCode(code: string): boolean {
  return (
    code.startsWith('ER_') ||
    code.startsWith('PROTOCOL_') ||
    code.startsWith('WARN_') ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT'
  )
}

function hasMysqlErrorProperties(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const raw = err as MysqlRawError
  if (
    typeof raw.errno === 'number' ||
    typeof raw.sqlState === 'string' ||
    typeof raw.sqlMessage === 'string'
  ) {
    return true
  }
  return typeof raw.code === 'string' && hasMysqlErrorCode(raw.code)
}

function matchesDriverError(target: unknown): boolean {
  if (target instanceof DrizzleError) {
    return true
  }
  return hasMysqlErrorProperties(target)
}

function nextCause(current: object): unknown {
  if ('cause' in current && current.cause && current.cause !== current) {
    return current.cause
  }
  return undefined
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

function parseDuplicateEntry(rawMsg: string): { value?: string; key?: string } | null {
  const match = /Duplicate entry ['"](.*)['"] for key ['"]([^'"]+)['"]/s.exec(rawMsg)
  if (!match) return null
  return { value: match[1], key: match[2] }
}

function isDuplicateEntryError(err?: MysqlRawError): boolean {
  if (!err) return false
  return err.code === 'ER_DUP_ENTRY' || err.errno === 1062
}

function resolveRawMessage(mysqlErr: MysqlRawError, fallbackErr: unknown): string {
  if (mysqlErr.sqlMessage) return mysqlErr.sqlMessage
  if (mysqlErr.message) return mysqlErr.message
  return fallbackErr instanceof Error ? fallbackErr.message : ''
}

function buildUniqueConstraintError(
  mysqlErr: MysqlRawError,
  err: unknown,
  context?: ErrorContext,
): UniqueConstraintError {
  const rawMsg = resolveRawMessage(mysqlErr, err)
  const parsed = parseDuplicateEntry(rawMsg)
  const key = parsed?.key
  const value = parsed?.value
  const field =
    key && context?.fields ? findFieldName(key, context.fields, context.slug) : undefined

  const msg = field
    ? `Value "${value ?? ''}" is already taken for field "${field}"`
    : 'Unique constraint violation'

  return new UniqueConstraintError(msg, { field, value, cause: err })
}

function isForeignKeyError(err?: MysqlRawError): boolean {
  if (!err) return false
  return (
    err.errno === 1451 ||
    err.errno === 1452 ||
    err.errno === 1216 ||
    err.errno === 1217 ||
    err.code === 'ER_ROW_IS_REFERENCED_2' ||
    err.code === 'ER_NO_REFERENCED_ROW_2' ||
    err.code === 'ER_ROW_IS_REFERENCED' ||
    err.code === 'ER_NO_REFERENCED_ROW'
  )
}

function parseMysqlFkMessage(rawMsg: string): {
  constraint?: string
  field?: string
  table?: string
  isReferencedParent?: boolean
} {
  const isReferencedParent =
    rawMsg.includes('Cannot delete or update a parent row') || rawMsg.includes('a parent row')
  const constraintMatch = /CONSTRAINT [`'"]?([^`'"\s,]+)[`'"]?/.exec(rawMsg)
  const fkMatch = /FOREIGN KEY \([`'"]?([^`'"\s,]+)[`'"]?\)/.exec(rawMsg)
  const tableMatch = /fails \((?:[`'"]?[^`'"\s()]+[`'"]?\.)?[`'"]?([^`'"\s(),]+)[`'"]?,/.exec(
    rawMsg,
  )

  return {
    constraint: constraintMatch?.[1],
    field: fkMatch?.[1],
    table: tableMatch?.[1],
    isReferencedParent,
  }
}

function buildMysqlForeignKeyConstraintError(
  mysqlErr: MysqlRawError,
  err: unknown,
  context?: ErrorContext,
): ForeignKeyConstraintError {
  const rawMsg = resolveRawMessage(mysqlErr, err)
  const parsed = parseMysqlFkMessage(rawMsg)
  const rawField = parsed.field ?? parsed.constraint
  const field =
    rawField && context?.fields ? findFieldName(rawField, context.fields, context.slug) : rawField
  const table = parsed.table

  let msg = 'Foreign key constraint violation'
  if (parsed.isReferencedParent) {
    msg = table
      ? `Cannot delete or update row referenced by "${table}"`
      : 'Cannot delete document referenced by other documents'
  } else if (field) {
    msg = `Referenced document for field "${field}" does not exist`
  }

  return new ForeignKeyConstraintError(msg, {
    field,
    table,
    constraint: parsed.constraint,
    cause: err,
  })
}

function isNotNullError(err?: MysqlRawError): boolean {
  if (!err) return false
  return (
    err.errno === 1048 ||
    err.errno === 1364 ||
    err.code === 'ER_BAD_NULL_ERROR' ||
    err.code === 'ER_NO_DEFAULT_FOR_FIELD'
  )
}

function parseMysqlNotNullColumn(rawMsg: string): string | undefined {
  const matchColumn = /Column ['"]([^'"]+)['"] cannot be null/.exec(rawMsg)
  if (matchColumn) return matchColumn[1]
  const matchField = /Field ['"]([^'"]+)['"] doesn't have a default value/.exec(rawMsg)
  return matchField?.[1]
}

function buildMysqlNotNullConstraintError(
  mysqlErr: MysqlRawError,
  err: unknown,
  context?: ErrorContext,
): NotNullConstraintError {
  const rawMsg = resolveRawMessage(mysqlErr, err)
  const column = parseMysqlNotNullColumn(rawMsg)
  const field =
    column && context?.fields ? findFieldName(column, context.fields, context.slug) : column
  const msg = field ? `Field "${field}" is required` : 'Not-null constraint violation'

  return new NotNullConstraintError(msg, {
    field,
    column,
    cause: err,
  })
}

function isCheckConstraintError(err?: MysqlRawError): boolean {
  if (!err) return false
  return err.errno === 3819 || err.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
}

function parseMysqlCheckConstraint(rawMsg: string): string | undefined {
  const match = /Check constraint ['"]([^'"]+)['"] is violated/.exec(rawMsg)
  return match?.[1]
}

function buildMysqlCheckConstraintError(
  mysqlErr: MysqlRawError,
  err: unknown,
  context?: ErrorContext,
): CheckConstraintError {
  const rawMsg = resolveRawMessage(mysqlErr, err)
  const constraint = parseMysqlCheckConstraint(rawMsg)
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

function mapMysqlError(
  mysqlErr: MysqlRawError,
  err: unknown,
  context?: ErrorContext,
): DatabaseError | null {
  if (isDuplicateEntryError(mysqlErr)) {
    return buildUniqueConstraintError(mysqlErr, err, context)
  }
  if (isForeignKeyError(mysqlErr)) {
    return buildMysqlForeignKeyConstraintError(mysqlErr, err, context)
  }
  if (isNotNullError(mysqlErr)) {
    return buildMysqlNotNullConstraintError(mysqlErr, err, context)
  }
  if (isCheckConstraintError(mysqlErr)) {
    return buildMysqlCheckConstraintError(mysqlErr, err, context)
  }
  return null
}

export function handleDatabaseError(err: unknown, context?: ErrorContext): never {
  if (isKnownDatabaseError(err)) {
    throw err
  }

  if (!isDriverError(err)) {
    throw err as Error
  }

  const mysqlErr = extractMysqlError(err)
  if (mysqlErr) {
    const mapped = mapMysqlError(mysqlErr, err, context)
    if (mapped) throw mapped
  }

  throw new DatabaseError('Database operation failed', { cause: err })
}
