import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, UploadFile } from './adapter'
import { deleteMedia, uploadMedia } from './pipeline'

describe('uploadMedia and deleteMedia pipeline', () => {
  function createMockStorage() {
    const upload = vi.fn((file: UploadFile) =>
      Promise.resolve({
        filename: file.filename,
        url: `https://example.com/uploads/${file.filename}`,
      }),
    )
    const remove = vi.fn(() => Promise.resolve())
    const getUrl = vi.fn((filename: string) => `https://example.com/uploads/${filename}`)
    const storage: StorageAdapter = {
      name: 'mock',
      upload,
      delete: remove,
      getUrl,
    }
    return { storage, upload, delete: remove, getUrl }
  }

  async function createTestImage(width = 600, height = 400): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 128, b: 255 },
      },
    })
      .png()
      .toBuffer()
  }

  it('uploads original image and all configured variants', async () => {
    const { storage, upload } = createMockStorage()
    const buffer = await createTestImage(600, 400)

    const result = await uploadMedia({
      storage,
      file: {
        filename: 'banner.png',
        buffer,
        mimeType: 'image/png',
      },
      uploadConfig: {
        sizes: {
          thumb: { width: 150 },
          card: { width: 300 },
        },
      },
    })

    expect(upload).toHaveBeenCalledTimes(3)
    expect(result.filename).toBe('banner.png')
    expect(result.url).toBe('https://example.com/uploads/banner.png')
    expect(result.mimeType).toBe('image/png')
    expect(result.width).toBe(600)
    expect(result.height).toBe(400)

    expect(result.sizes).toBeDefined()
    expect(result.sizes?.thumb).toEqual({
      filename: 'banner-thumb.png',
      url: 'https://example.com/uploads/banner-thumb.png',
      width: 150,
      height: 100,
      filesize: expect.any(Number) as number,
      mimeType: 'image/png',
    })
    expect(result.sizes?.card).toEqual({
      filename: 'banner-card.png',
      url: 'https://example.com/uploads/banner-card.png',
      width: 300,
      height: 200,
      filesize: expect.any(Number) as number,
      mimeType: 'image/png',
    })
  })

  it('uploads non-image file without resizing', async () => {
    const { storage, upload } = createMockStorage()
    const buffer = Buffer.from('hello plain text')

    const result = await uploadMedia({
      storage,
      file: {
        filename: 'notes.txt',
        buffer,
        mimeType: 'text/plain',
      },
      uploadConfig: {
        sizes: {
          thumb: { width: 100 },
        },
      },
    })

    expect(upload).toHaveBeenCalledTimes(1)
    expect(result.filename).toBe('notes.txt')
    expect(result.url).toBe('https://example.com/uploads/notes.txt')
    expect(result.sizes).toBeUndefined()
  })

  it('deletes original file and all size variants', async () => {
    const { storage, delete: remove } = createMockStorage()

    await deleteMedia({
      storage,
      filename: 'banner.png',
      sizes: {
        thumb: { filename: 'banner-thumb.png' },
        card: { filename: 'banner-card.png' },
      },
    })

    expect(remove).toHaveBeenCalledTimes(3)
    expect(remove).toHaveBeenCalledWith('banner.png')
    expect(remove).toHaveBeenCalledWith('banner-thumb.png')
    expect(remove).toHaveBeenCalledWith('banner-card.png')
  })

  it('deletes only original file when sizes is undefined', async () => {
    const { storage, delete: remove } = createMockStorage()

    await deleteMedia({
      storage,
      filename: 'document.pdf',
    })

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('document.pdf')
  })
})
