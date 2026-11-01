import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { formatVariantFilename, isResizableImage, processImage } from './image'

describe('formatVariantFilename', () => {
  it('appends size name before extension', () => {
    expect(formatVariantFilename('photo.png', 'thumb')).toBe('photo-thumb.png')
    expect(formatVariantFilename('my.photo.name.jpg', 'hero')).toBe('my.photo.name-hero.jpg')
  })

  it('replaces extension when format is specified', () => {
    expect(formatVariantFilename('photo.jpg', 'thumb', 'webp')).toBe('photo-thumb.webp')
  })

  it('handles filenames without extension', () => {
    expect(formatVariantFilename('photo', 'thumb')).toBe('photo-thumb')
    expect(formatVariantFilename('photo', 'thumb', 'png')).toBe('photo-thumb.png')
  })
})

describe('isResizableImage', () => {
  it('returns true for raster image mime types', () => {
    expect(isResizableImage('image/jpeg')).toBe(true)
    expect(isResizableImage('image/jpg')).toBe(true)
    expect(isResizableImage('image/png')).toBe(true)
    expect(isResizableImage('image/webp')).toBe(true)
    expect(isResizableImage('image/avif')).toBe(true)
    expect(isResizableImage('image/gif')).toBe(true)
  })

  it('returns false for vector and non-image mime types', () => {
    expect(isResizableImage('image/svg+xml')).toBe(false)
    expect(isResizableImage('application/pdf')).toBe(false)
    expect(isResizableImage('text/plain')).toBe(false)
  })
})

describe('processImage', () => {
  async function createTestImage(width = 800, height = 600): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()
  }

  it('returns original image metadata without sizes when no presets given', async () => {
    const buffer = await createTestImage(800, 600)
    const result = await processImage({
      filename: 'sample.png',
      buffer,
      mimeType: 'image/png',
    })

    expect(result.original.filename).toBe('sample.png')
    expect(result.original.width).toBe(800)
    expect(result.original.height).toBe(600)
    expect(result.original.filesize).toBe(buffer.length)
    expect(result.original.mimeType).toBe('image/png')
    expect(result.sizes).toEqual({})
  })

  it('bypasses resizing for non-image files', async () => {
    const buffer = Buffer.from('PDF content here')
    const result = await processImage({
      filename: 'document.pdf',
      buffer,
      mimeType: 'application/pdf',
      sizes: {
        thumb: { width: 100 },
      },
    })

    expect(result.original.filename).toBe('document.pdf')
    expect(result.original.filesize).toBe(buffer.length)
    expect(result.sizes).toEqual({})
  })

  it('resizes images according to configured size presets', async () => {
    const buffer = await createTestImage(800, 600)
    const result = await processImage({
      filename: 'landscape.png',
      buffer,
      mimeType: 'image/png',
      sizes: {
        thumb: { width: 200, height: 150 },
        square: { width: 100, height: 100, fit: 'cover' },
        hero: { width: 400 },
      },
    })

    expect(result.original.width).toBe(800)
    expect(result.original.height).toBe(600)

    const thumb = result.sizes.thumb!
    expect(thumb).toBeDefined()
    expect(thumb.filename).toBe('landscape-thumb.png')
    expect(thumb.width).toBe(200)
    expect(thumb.height).toBe(150)
    expect(thumb.mimeType).toBe('image/png')

    const square = result.sizes.square!
    expect(square).toBeDefined()
    expect(square.filename).toBe('landscape-square.png')
    expect(square.width).toBe(100)
    expect(square.height).toBe(100)

    const hero = result.sizes.hero!
    expect(hero).toBeDefined()
    expect(hero.filename).toBe('landscape-hero.png')
    expect(hero.width).toBe(400)
    // 800x600 scaled to width 400 has height 300
    expect(hero.height).toBe(300)
  })

  it('supports format conversion and quality', async () => {
    const buffer = await createTestImage(400, 300)
    const result = await processImage({
      filename: 'photo.png',
      buffer,
      mimeType: 'image/png',
      sizes: {
        webpThumb: { width: 150, format: 'webp', quality: 80 },
      },
    })

    const webpThumb = result.sizes.webpThumb!
    expect(webpThumb).toBeDefined()
    expect(webpThumb.filename).toBe('photo-webpThumb.webp')
    expect(webpThumb.mimeType).toBe('image/webp')
    expect(webpThumb.width).toBe(150)
  })

  it('respects withoutEnlargement by default', async () => {
    const buffer = await createTestImage(300, 200)
    const result = await processImage({
      filename: 'small.png',
      buffer,
      mimeType: 'image/png',
      sizes: {
        huge: { width: 1200 },
      },
    })

    const huge = result.sizes.huge!
    expect(huge).toBeDefined()
    expect(huge.width).toBe(300)
    expect(huge.height).toBe(200)
  })
})
