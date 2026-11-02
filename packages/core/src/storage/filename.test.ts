import { describe, expect, it, vi } from 'vitest'
import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter, StoredDoc } from '../database/adapter'
import type { Where } from '../query/types'
import { getUniqueFilename, sanitizeFilename } from './filename'

describe('sanitizeFilename', () => {
  it('strips path traversal segments (POSIX and Windows)', () => {
    expect(sanitizeFilename('../escaped.txt').sanitized).toBe('escaped.txt')
    expect(sanitizeFilename('../../var/log/app.log').sanitized).toBe('app.log')
    expect(sanitizeFilename('..\\..\\windows\\system32.dll').sanitized).toBe('system32.dll')
    expect(sanitizeFilename('/etc/passwd').sanitized).toBe('passwd')
  })

  it('strips leading dots to prevent hidden files', () => {
    expect(sanitizeFilename('.env').sanitized).toBe('env')
    expect(sanitizeFilename('...hidden.tar.gz').sanitized).toBe('hidden-tar.gz')
  })

  it('slugifies special characters and spaces', () => {
    expect(sanitizeFilename('cover #1.jpg').sanitized).toBe('cover-1.jpg')
    expect(sanitizeFilename('100%.png').sanitized).toBe('100.png')
    expect(sanitizeFilename('my photo (final) [2].jpeg').sanitized).toBe('my-photo-final-2.jpeg')
  })

  it('preserves alphanumeric, dashes, and underscores in base', () => {
    expect(sanitizeFilename('photo_2026-test.png').sanitized).toBe('photo_2026-test.png')
  })

  it('strips null bytes and control characters', () => {
    expect(sanitizeFilename('test\0file\x1f.txt').sanitized).toBe('testfile.txt')
  })

  it('defaults to "file" when name is empty or all special characters', () => {
    expect(sanitizeFilename('').sanitized).toBe('file')
    expect(sanitizeFilename('   ').sanitized).toBe('file')
    expect(sanitizeFilename('###').sanitized).toBe('file')
    expect(sanitizeFilename('.').sanitized).toBe('file')
  })
})

describe('getUniqueFilename', () => {
  const mockCollection: CollectionConfig = {
    slug: 'media',
    fields: {},
    upload: true,
  }

  function createMockDb(
    findImpl?: (args: { where?: Where }) => Promise<{ docs: StoredDoc[]; totalDocs: number }>,
  ): DatabaseAdapter {
    return {
      name: 'mock',
      find: findImpl
        ? vi.fn().mockImplementation(findImpl)
        : vi.fn().mockResolvedValue({ docs: [], totalDocs: 0 }),
      findByID: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findGlobal: vi.fn(),
      updateGlobal: vi.fn(),
      toSchemaFile: () => '',
      migrate: () => Promise.resolve(),
    }
  }

  it('returns candidate directly if no collision exists', async () => {
    const mockDb = createMockDb()

    const unique = await getUniqueFilename({
      db: mockDb,
      collection: mockCollection,
      base: 'photo',
      ext: 'jpg',
    })

    expect(unique).toBe('photo.jpg')
  })

  it('appends incrementing counter on collision', async () => {
    const docsByCandidate: Record<string, StoredDoc[]> = {
      'photo.jpg': [{ id: 1, filename: 'photo.jpg' } as unknown as StoredDoc],
      'photo-1.jpg': [{ id: 2, filename: 'photo-1.jpg' } as unknown as StoredDoc],
      'photo-2.jpg': [],
    }

    const mockDb = createMockDb(({ where }) => {
      const filter = where?.filename as { equals?: string } | undefined
      const candidate = filter?.equals ?? ''
      const docs = docsByCandidate[candidate] ?? []
      return Promise.resolve({ docs, totalDocs: docs.length })
    })

    const unique = await getUniqueFilename({
      db: mockDb,
      collection: mockCollection,
      base: 'photo',
      ext: 'jpg',
    })

    expect(unique).toBe('photo-2.jpg')
  })

  it('allows same filename when excludeDocId matches existing doc', async () => {
    const mockDb = createMockDb(() =>
      Promise.resolve({
        docs: [{ id: 42, filename: 'photo.jpg' } as unknown as StoredDoc],
        totalDocs: 1,
      }),
    )

    const unique = await getUniqueFilename({
      db: mockDb,
      collection: mockCollection,
      base: 'photo',
      ext: 'jpg',
      excludeDocId: 42,
    })

    expect(unique).toBe('photo.jpg')
  })
})
