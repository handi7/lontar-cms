import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatDimensions,
  formatFileSize,
  isMimeGroup,
  mimeGroupOf,
  mimeGroupWhere,
  readStoredViewMode,
  thumbnailUrl,
  viewModeStorageKey,
  writeStoredViewMode,
} from './media'

describe('mime groups (#462)', () => {
  it('maps a MIME type to the group that picks its icon', () => {
    expect(mimeGroupOf('image/png')).toBe('images')
    expect(mimeGroupOf('video/mp4')).toBe('video')
    expect(mimeGroupOf('audio/mpeg')).toBe('audio')
    expect(mimeGroupOf('application/pdf')).toBe('documents')
    expect(mimeGroupOf('text/plain')).toBe('documents')
    expect(
      mimeGroupOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('documents')
    expect(mimeGroupOf('application/zip')).toBe('other')
    expect(mimeGroupOf(undefined)).toBe('other')
  })

  it('builds a where clause per group', () => {
    expect(mimeGroupWhere('images')).toEqual({ mimeType: { contains: 'image/' } })
    expect(mimeGroupWhere('other')).toEqual({
      mimeType: { in: expect.arrayContaining(['application/zip']) as string[] },
    })
    const documents = mimeGroupWhere('documents')
    expect(documents.or).toContainEqual({ mimeType: { contains: 'application/pdf' } })
  })

  it('accepts only the known group names', () => {
    expect(isMimeGroup('images')).toBe(true)
    expect(isMimeGroup('Images')).toBe(false)
    expect(isMimeGroup(undefined)).toBe(false)
  })
})

describe('thumbnailUrl (#462)', () => {
  it('prefers the thumb size, then any generated size, then the original url', () => {
    const base = { mimeType: 'image/png', url: '/media/a.png' }
    expect(
      thumbnailUrl({
        ...base,
        sizes: { card: { url: '/media/a-card.png' }, thumb: { url: '/t' } },
      }),
    ).toBe('/t')
    expect(thumbnailUrl({ ...base, sizes: { card: { url: '/media/a-card.png' } } })).toBe(
      '/media/a-card.png',
    )
    expect(thumbnailUrl({ ...base, sizes: { card: {} } })).toBe('/media/a.png')
    expect(thumbnailUrl({ ...base, sizes: null })).toBe('/media/a.png')
  })

  it('returns nothing for a file that is not an image', () => {
    expect(thumbnailUrl({ mimeType: 'application/pdf', url: '/media/a.pdf' })).toBeUndefined()
  })

  it('recognises an image by its extension when the MIME type is missing', () => {
    expect(thumbnailUrl({ url: '/media/a.webp' })).toBe('/media/a.webp')
  })
})

describe('file details (#462)', () => {
  it('formats sizes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatFileSize(undefined)).toBe('—')
  })

  it('formats dimensions only when both are known', () => {
    expect(formatDimensions({ width: 800, height: 600 })).toBe('800 × 600')
    expect(formatDimensions({ width: 800 })).toBeUndefined()
  })
})

describe('view mode storage (#462)', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('scopes the key by user and collection', () => {
    expect(viewModeStorageKey('u1', 'media')).toBe('lontar-admin-list-view:u1:media')
    expect(viewModeStorageKey(null, 'media')).toBe('lontar-admin-list-view:anonymous:media')
  })

  it('round-trips a choice and ignores a hand-edited value', () => {
    const key = viewModeStorageKey('u1', 'media')
    expect(readStoredViewMode(key)).toBeNull()
    writeStoredViewMode(key, 'grid')
    expect(readStoredViewMode(key)).toBe('grid')
    window.localStorage.setItem(key, 'masonry')
    expect(readStoredViewMode(key)).toBeNull()
  })

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(readStoredViewMode('k')).toBeNull()
    expect(() => writeStoredViewMode('k', 'grid')).not.toThrow()
  })
})
