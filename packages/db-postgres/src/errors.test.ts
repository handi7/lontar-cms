import { describe, expect, it } from 'vitest'
import { DatabaseError, NotFoundError, UniqueConstraintError, ValidationError } from '@lontar/core'
import { findFieldName, handleDatabaseError, isDriverError, toErrorContext } from './errors'

describe('db-postgres errors', () => {
  describe('findFieldName', () => {
    const fields = {
      title: { type: 'text' },
      slug: { type: 'slug' },
      email: { type: 'email' },
      filename: { type: 'text' },
    }

    it('matches PRIMARY and _pkey to id', () => {
      expect(findFieldName('PRIMARY', fields, 'posts')).toBe('id')
      expect(findFieldName('posts_pkey', fields, 'posts')).toBe('id')
    })

    it('matches exact field name', () => {
      expect(findFieldName('slug', fields, 'posts')).toBe('slug')
    })

    it('matches table-prefixed unique constraint name', () => {
      expect(findFieldName('posts_slug_unique', fields, 'posts')).toBe('slug')
      expect(findFieldName('posts_email_unique', fields, 'posts')).toBe('email')
    })

    it('matches upload filename field', () => {
      expect(findFieldName('media_filename_unique', fields, 'media')).toBe('filename')
    })

    it('returns undefined when field cannot be determined', () => {
      expect(findFieldName('unknown_idx', fields, 'posts')).toBeUndefined()
    })
  })

  describe('handleDatabaseError', () => {
    const context = toErrorContext({
      slug: 'posts',
      fields: {
        title: { type: 'text' },
        slug: { type: 'slug' },
      },
    } as never)

    it('rethrows existing UniqueConstraintError unchanged', () => {
      const err = new UniqueConstraintError('Already unique', { field: 'slug' })
      expect(() => handleDatabaseError(err, context)).toThrow(err)
    })

    it('rethrows existing DatabaseError unchanged', () => {
      const err = new DatabaseError('Custom db error')
      expect(() => handleDatabaseError(err, context)).toThrow(err)
    })

    it('maps Postgres 23505 to UniqueConstraintError with field and value', () => {
      const rawError = {
        code: '23505',
        constraint: 'posts_slug_unique',
        detail: 'Key (slug)=(duplicate-slug) already exists.',
        message: 'duplicate key value violates unique constraint "posts_slug_unique"',
      }
      const drizzleError = new Error('Failed query: insert into ...')
      ;(drizzleError as unknown as { cause: unknown }).cause = rawError

      try {
        handleDatabaseError(drizzleError, context)
        expect.fail('should have thrown')
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(UniqueConstraintError)
        const uce = thrown as UniqueConstraintError
        expect(uce.field).toBe('slug')
        expect(uce.value).toBe('duplicate-slug')
        expect(uce.message).toBe('Value "duplicate-slug" is already taken for field "slug"')
      }
    })

    it('maps generic Postgres error to sanitized DatabaseError without leaking SQL', () => {
      const rawError = {
        code: '42P01',
        message: 'relation "secret_table" does not exist',
      }
      const drizzleError = new Error(
        'Failed query: select * from secret_table\nparams: password123',
      )
      ;(drizzleError as unknown as { cause: unknown }).cause = rawError

      try {
        handleDatabaseError(drizzleError, context)
        expect.fail('should have thrown')
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(DatabaseError)
        expect(thrown).not.toBeInstanceOf(UniqueConstraintError)
        const dbe = thrown as DatabaseError
        expect(dbe.message).toBe('Database operation failed')
        expect(dbe.message).not.toContain('secret_table')
        expect(dbe.message).not.toContain('password123')
        expect(dbe.cause).toBe(drizzleError)
      }
    })

    it('rethrows non-driver errors (NotFoundError, ValidationError, custom Error) untouched', () => {
      const notFound = new NotFoundError('Post not found')
      expect(() => handleDatabaseError(notFound, context)).toThrow(notFound)

      const validation = new ValidationError('Validation failed', { issues: [] })
      expect(() => handleDatabaseError(validation, context)).toThrow(validation)

      const custom = new Error('Custom hook failure')
      expect(() => handleDatabaseError(custom, context)).toThrow(custom)
    })
  })

  describe('isDriverError', () => {
    it('returns false for generic errors and core domain errors', () => {
      expect(isDriverError(new Error('Generic failure'))).toBe(false)
      expect(isDriverError(new NotFoundError('Missing doc'))).toBe(false)
      expect(isDriverError(new ValidationError('Invalid'))).toBe(false)
      expect(isDriverError(null)).toBe(false)
      expect(isDriverError('string error')).toBe(false)
    })

    it('returns true when error or cause has postgres-specific properties', () => {
      expect(isDriverError({ code: '23505' })).toBe(true)
      expect(isDriverError({ code: '40P01' })).toBe(true)
      expect(isDriverError({ code: 'ECONNRESET' })).toBe(true)
      expect(isDriverError({ constraint: 'users_email_unique' })).toBe(true)
      expect(isDriverError({ detail: 'Key (id)=(1) already exists.' })).toBe(true)

      const wrapped = new Error('Drizzle wrapper')
      ;(wrapped as unknown as { cause: unknown }).cause = { code: '42P01' }
      expect(isDriverError(wrapped)).toBe(true)
    })
  })
})
