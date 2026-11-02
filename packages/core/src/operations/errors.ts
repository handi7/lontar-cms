export class AccessDeniedError extends Error {
  readonly status: 401 | 403
  readonly user?: unknown

  constructor(message = 'Access denied', options?: { user?: unknown }) {
    super(message)
    this.name = 'AccessDeniedError'
    this.status = options?.user ? 403 : 401
    this.user = options?.user
  }
}

export class NotFoundError extends Error {
  readonly status = 404

  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  readonly status = 400
  readonly issues?: unknown[]

  constructor(message = 'Validation failed', options?: { issues?: unknown[] }) {
    super(message)
    this.name = 'ValidationError'
    this.issues = options?.issues
  }
}
