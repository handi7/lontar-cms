export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

export function validatePassword(password?: unknown, fieldName = 'Password'): string | null {
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `${fieldName} must be at least ${MIN_PASSWORD_LENGTH} characters long`
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `${fieldName} cannot exceed ${MAX_PASSWORD_LENGTH} characters`
  }
  return null
}
