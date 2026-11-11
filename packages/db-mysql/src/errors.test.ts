import { describe, expect, it } from 'vitest'
import { DatabaseError, NotFoundError, UniqueConstraintError, ValidationError } from '@lontar/core'
import { findFieldName, handleDatabaseError, isDriverError, toErrorContext } from './errors'

describe('db-mysql errors', () => {
  describe('findFieldName', () => {
    const fields = {
      title: { type: 'text' },
      slug: { type: 'slug' },
      email: { type: 'email' },
      filename: { type: 'text' },
    }

    it('matches PRIMARY to id', () => {
      expect(findFieldName('PRIMARY', fields, 'posts')).toBe('id')
      expect(findFieldName('posts.PRIMARY', fields, 'posts')).toBe('id')
    })

    it('matches exact field name', () => {
      expect(findFieldName('slug', fields, 'posts')).toBe('slug')
      expect(findFieldName('posts.slug', fields, 'posts')).toBe('slug')
    })

    it('matches table-prefixed unique constraint name', () => {
      expect(findFieldName('posts.posts_slug_unique', fields, 'posts')).toBe('slug')
      expect(findFieldName('posts_slug_unique', fields, 'posts')).toBe('slug')
      expect(findFieldName('posts_email_unique', fields, 'posts')).toBe('email')
    })

    it('matches upload filename field', () => {
      expect(findFieldName('media.media_filename_unique', fields, 'media')).toBe('filename')
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

    it('maps MySQL ER_DUP_ENTRY to UniqueConstraintError with field and value', () => {
      const rawError = {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
        sqlMessage: "Duplicate entry 'duplicate-slug' for key 'posts.posts_slug_unique'",
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

    it('maps generic MySQL error to sanitized DatabaseError without leaking SQL', () => {
      const rawError = {
        code: 'ER_PARSE_ERROR',
        errno: 1064,
        sqlMessage: 'You have an error in your SQL syntax near...',
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

    it('returns true when error or cause has mysql-specific properties', () => {
      expect(isDriverError({ code: 'ER_DUP_ENTRY', errno: 1062 })).toBe(true)
      expect(isDriverError({ code: 'ER_LOCK_DEADLOCK', errno: 1213 })).toBe(true)
      expect(isDriverError({ code: 'ECONNRESET' })).toBe(true)
      expect(isDriverError({ sqlState: '23000' })).toBe(true)
      expect(isDriverError({ sqlMessage: 'Table not found' })).toBe(true)

      const wrapped = new Error('Drizzle wrapper')
      ;(wrapped as unknown as { cause: unknown }).cause = { code: 'ER_PARSE_ERROR', errno: 1064 }
      expect(isDriverError(wrapped)).toBe(true)
    })
  })
})
