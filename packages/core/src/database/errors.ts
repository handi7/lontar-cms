export class DatabaseError extends Error {
  constructor(message = 'Database operation failed', options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseError'
  }
}

export class UniqueConstraintError extends DatabaseError {
  readonly field?: string
  readonly value?: unknown

  constructor(
    message = 'Unique constraint violation',
    options?: { field?: string; value?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'UniqueConstraintError'
    this.field = options?.field
    this.value = options?.value
  }
}

export class ForeignKeyConstraintError extends DatabaseError {
  readonly field?: string
  readonly table?: string
  readonly constraint?: string

  constructor(
    message = 'Foreign key constraint violation',
    options?: { field?: string; table?: string; constraint?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ForeignKeyConstraintError'
    this.field = options?.field
    this.table = options?.table
    this.constraint = options?.constraint
  }
}

export class NotNullConstraintError extends DatabaseError {
  readonly field?: string
  readonly column?: string

  constructor(
    message = 'Not-null constraint violation',
    options?: { field?: string; column?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'NotNullConstraintError'
    this.field = options?.field
    this.column = options?.column
  }
}

export class CheckConstraintError extends DatabaseError {
  readonly constraint?: string
  readonly field?: string

  constructor(
    message = 'Check constraint violation',
    options?: { constraint?: string; field?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'CheckConstraintError'
    this.constraint = options?.constraint
    this.field = options?.field
  }
}

export interface ValidationErrorResponse {
  error: string
  issues: Array<{
    code: string
    path: (string | number)[]
    message: string
  }>
}

function formatValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

export function formatUniqueConstraintError(err: UniqueConstraintError): ValidationErrorResponse {
  const path = err.field ? [err.field] : []
  const formatted = formatValue(err.value)
  const message =
    formatted !== null ? `Value "${formatted}" is already taken` : 'Value is already taken'
  return {
    error: 'Validation failed',
    issues: [
      {
        code: 'custom',
        path,
        message,
      },
    ],
  }
}

export function formatNotNullConstraintError(err: NotNullConstraintError): ValidationErrorResponse {
  const path = err.field ? [err.field] : err.column ? [err.column] : []
  const message = err.field
    ? `Field "${err.field}" is required`
    : err.column
      ? `Column "${err.column}" is required`
      : 'Required value is missing'
  return {
    error: 'Validation failed',
    issues: [
      {
        code: 'custom',
        path,
        message,
      },
    ],
  }
}

export function formatForeignKeyConstraintError(
  err: ForeignKeyConstraintError,
): ValidationErrorResponse {
  const path = err.field ? [err.field] : []
  const message = err.field
    ? `Referenced document for field "${err.field}" does not exist`
    : 'Foreign key constraint violation'
  return {
    error: 'Validation failed',
    issues: [
      {
        code: 'custom',
        path,
        message,
      },
    ],
  }
}

export function formatCheckConstraintError(err: CheckConstraintError): ValidationErrorResponse {
  const path = err.field ? [err.field] : []
  const message = err.field
    ? `Value violates check constraint for field "${err.field}"`
    : 'Check constraint violation'
  return {
    error: 'Validation failed',
    issues: [
      {
        code: 'custom',
        path,
        message,
      },
    ],
  }
}
