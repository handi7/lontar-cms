import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, validatePassword } from './password'

describe('validatePassword (#378)', () => {
  it('accepts passwords within [8, 128] characters', () => {
    expect(validatePassword('12345678')).toBeNull()
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
    expect(validatePassword('a'.repeat(MAX_PASSWORD_LENGTH))).toBeNull()
    expect(validatePassword('a'.repeat(64))).toBeNull()
  })

  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('')).toBe('Password must be at least 8 characters long')
    expect(validatePassword('short')).toBe('Password must be at least 8 characters long')
    expect(validatePassword('1234567')).toBe('Password must be at least 8 characters long')
  })

  it('rejects passwords longer than 128 characters', () => {
    const tooLong = 'a'.repeat(129)
    expect(validatePassword(tooLong)).toBe('Password cannot exceed 128 characters')
    expect(validatePassword('a'.repeat(200))).toBe('Password cannot exceed 128 characters')
  })

  it('rejects non-string or missing values', () => {
    expect(validatePassword(undefined)).toBe('Password must be at least 8 characters long')
    expect(validatePassword(null)).toBe('Password must be at least 8 characters long')
    expect(validatePassword(12345678)).toBe('Password must be at least 8 characters long')
  })

  it('customizes field name in error message', () => {
    expect(validatePassword('short', 'New password')).toBe(
      'New password must be at least 8 characters long',
    )
    expect(validatePassword('a'.repeat(129), 'New password')).toBe(
      'New password cannot exceed 128 characters',
    )
  })
})
