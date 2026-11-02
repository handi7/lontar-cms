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
  if (cleanKey === 'PRIMARY') return 'id'
  if (cleanKey in fields) return cleanKey

  const withoutTable = stripTablePrefix(cleanKey, tableSlug)
  if (withoutTable in fields) return withoutTable

  const strippedSuffix = stripUniqueSuffix(withoutTable)
  if (strippedSuffix in fields) return strippedSuffix

  return fuzzyFindField(cleanKey, fields)
}

interface MysqlRawError {
  code?: string
  errno?: number
  sqlMessage?: string
  message?: string
}

function extractMysqlError(err: unknown): MysqlRawError | undefined {
  const cause = typeof err === 'object' && err !== null && 'cause' in err ? err.cause : err
  if (typeof cause === 'object' && cause !== null) {
    return cause
  }
  return undefined
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

export function handleDatabaseError(err: unknown, context?: ErrorContext): never {
  if (err instanceof UniqueConstraintError || err instanceof DatabaseError) {
    throw err
  }

  const mysqlErr = extractMysqlError(err)
  if (isDuplicateEntryError(mysqlErr) && mysqlErr) {
    throw buildUniqueConstraintError(mysqlErr, err, context)
  }

  throw new DatabaseError('Database operation failed', { cause: err })
}
