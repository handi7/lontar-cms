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
