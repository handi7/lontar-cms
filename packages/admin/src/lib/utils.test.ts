import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  describe('resolves conflicts between prefixed utilities', () => {
    it('keeps the last padding', () => {
      expect(cn('lt:p-2', 'lt:p-4')).toBe('lt:p-4')
    })

    it('keeps the last font size', () => {
      expect(cn('lt:text-sm', 'lt:text-lg')).toBe('lt:text-lg')
    })

    it('keeps the last background colour', () => {
      expect(cn('lt:bg-primary', 'lt:bg-secondary')).toBe('lt:bg-secondary')
    })

    it('resolves conflicts within the same variant', () => {
      expect(cn('lt:hover:bg-primary', 'lt:hover:bg-secondary')).toBe('lt:hover:bg-secondary')
    })

    it('treats a variant and its base as separate', () => {
      expect(cn('lt:bg-primary', 'lt:hover:bg-secondary')).toBe(
        'lt:bg-primary lt:hover:bg-secondary',
      )
    })

    it('resolves a data-attribute variant against itself', () => {
      expect(cn('lt:data-[state=open]:bg-primary', 'lt:data-[state=open]:bg-secondary')).toBe(
        'lt:data-[state=open]:bg-secondary',
      )
    })

    it('treats display utilities as one group', () => {
      expect(cn('lt:flex', 'lt:hidden')).toBe('lt:hidden')
    })
  })

  describe('leaves non-conflicting classes alone', () => {
    it('keeps utilities from different groups', () => {
      expect(cn('lt:flex', 'lt:p-4')).toBe('lt:flex lt:p-4')
    })

    it('keeps the hand-written lontar- class names', () => {
      expect(cn('lontar-btn', 'lontar-btn-primary')).toBe('lontar-btn lontar-btn-primary')
    })

    it('does not let a prefixed utility override an unprefixed class name', () => {
      expect(cn('lontar-input', 'lt:p-4')).toBe('lontar-input lt:p-4')
    })
  })

  describe('passes clsx input through', () => {
    it('drops falsey values', () => {
      expect(cn('lt:flex', false, undefined, null, '')).toBe('lt:flex')
    })

    it('accepts a conditional object', () => {
      expect(cn('lt:flex', { 'lt:p-4': true, 'lt:p-2': false })).toBe('lt:flex lt:p-4')
    })

    it('accepts nested arrays', () => {
      expect(cn(['lt:flex', ['lt:p-2']], 'lt:p-4')).toBe('lt:flex lt:p-4')
    })

    it('returns an empty string for no input', () => {
      expect(cn()).toBe('')
    })
  })
})
