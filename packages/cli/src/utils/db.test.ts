import { describe, expect, it, vi } from 'vitest'
import { closeDb, isClosable } from './db'

describe('isClosable', () => {
  it('returns true when object has a close function', () => {
    expect(isClosable({ close: () => {} })).toBe(true)
    expect(isClosable({ close: async () => {} })).toBe(true)
  })

  it('returns false for primitives, null, or undefined', () => {
    expect(isClosable(null)).toBe(false)
    expect(isClosable(undefined)).toBe(false)
    expect(isClosable('close')).toBe(false)
    expect(isClosable(123)).toBe(false)
    expect(isClosable(true)).toBe(false)
  })

  it('returns false for objects without close or with non-function close', () => {
    expect(isClosable({})).toBe(false)
    expect(isClosable({ close: 'not-a-function' })).toBe(false)
    expect(isClosable({ close: null })).toBe(false)
  })
})

describe('closeDb', () => {
  it('calls and awaits close() if db is closable', async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    await closeDb({ close: closeSpy })
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('does nothing safely if db is not closable', async () => {
    await expect(closeDb(null)).resolves.toBeUndefined()
    await expect(closeDb({})).resolves.toBeUndefined()
    await expect(closeDb(undefined)).resolves.toBeUndefined()
  })
})
