import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  formatVariantFilename,
  getOrientedDimensions,
  isAnimatedMimeType,
  isResizableImage,
  processImage,
} from './image'

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

describe('isAnimatedMimeType', () => {
  it('returns true for gif and webp', () => {
    expect(isAnimatedMimeType('image/gif')).toBe(true)
    expect(isAnimatedMimeType('image/GIF')).toBe(true)
    expect(isAnimatedMimeType('image/webp')).toBe(true)
    expect(isAnimatedMimeType('IMAGE/WEBP')).toBe(true)
  })

  it('returns false for non-animated image types and other files', () => {
    expect(isAnimatedMimeType('image/jpeg')).toBe(false)
    expect(isAnimatedMimeType('image/png')).toBe(false)
    expect(isAnimatedMimeType('image/avif')).toBe(false)
    expect(isAnimatedMimeType('application/pdf')).toBe(false)
  })
})

describe('getOrientedDimensions', () => {
  it('preserves dimensions when width or height is undefined', () => {
    expect(getOrientedDimensions({})).toEqual({ width: undefined, height: undefined })
    expect(getOrientedDimensions({ width: 100 })).toEqual({ width: 100, height: undefined })
  })

  it('preserves normal orientations (1 through 4)', () => {
    expect(getOrientedDimensions({ width: 400, height: 200, orientation: 1 })).toEqual({
      width: 400,
      height: 200,
    })
    expect(getOrientedDimensions({ width: 400, height: 200, orientation: 3 })).toEqual({
      width: 400,
      height: 200,
    })
  })

  it('swaps width and height for transposed orientations (5 through 8)', () => {
    expect(getOrientedDimensions({ width: 400, height: 200, orientation: 5 })).toEqual({
      width: 200,
      height: 400,
    })
    expect(getOrientedDimensions({ width: 400, height: 200, orientation: 6 })).toEqual({
      width: 200,
      height: 400,
    })
    expect(getOrientedDimensions({ width: 400, height: 200, orientation: 7 })).toEqual({
      width: 200,
      height: 400,
    })
    expect(getOrientedDimensions({ width: 400, height: 200, orientation: 8 })).toEqual({
      width: 200,
      height: 400,
    })
  })

  it('uses pageHeight when present for animated images', () => {
    expect(getOrientedDimensions({ width: 100, height: 200, pageHeight: 100 })).toEqual({
      width: 100,
      height: 100,
    })
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

  it('swaps original dimensions for EXIF-rotated images and preserves variant aspect ratio', async () => {
    // 400x200 image with EXIF orientation 6 (transposed 90° clockwise -> visual 200x400)
    const buffer = await sharp({
      create: {
        width: 400,
        height: 200,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const result = await processImage({
      filename: 'portrait.jpg',
      buffer,
      mimeType: 'image/jpeg',
      sizes: {
        thumb: { width: 100 },
      },
    })

    // Stored dimensions are swapped to reflect visual/oriented layout
    expect(result.original.width).toBe(200)
    expect(result.original.height).toBe(400)

    const thumb = result.sizes.thumb!
    expect(thumb).toBeDefined()
    expect(thumb.width).toBe(100)
    // 200x400 scaled to width 100 yields height 200
    expect(thumb.height).toBe(200)
  })

  it('preserves animation frames when resizing animated GIFs', async () => {
    // Create two 100x80 frames joined into an animated GIF
    const frame1 = await sharp({
      create: { width: 100, height: 80, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const frame2 = await sharp({
      create: { width: 100, height: 80, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const buffer = await sharp([frame1, frame2], { join: { animated: true } })
      .gif()
      .toBuffer()

    const result = await processImage({
      filename: 'animation.gif',
      buffer,
      mimeType: 'image/gif',
      sizes: {
        thumb: { width: 50 },
        webpThumb: { width: 50, format: 'webp' },
        jpegThumb: { width: 50, format: 'jpeg' },
      },
    })

    // Original dimensions match single-frame visual size, not stacked strip
    expect(result.original.width).toBe(100)
    expect(result.original.height).toBe(80)

    const thumb = result.sizes.thumb!
    expect(thumb).toBeDefined()
    expect(thumb.width).toBe(50)
    expect(thumb.height).toBe(40)
    expect(thumb.mimeType).toBe('image/gif')
    const thumbMeta = await sharp(thumb.buffer, { animated: true }).metadata()
    expect(thumbMeta.pages).toBe(2)

    const webpThumb = result.sizes.webpThumb!
    expect(webpThumb).toBeDefined()
    expect(webpThumb.width).toBe(50)
    expect(webpThumb.height).toBe(40)
    expect(webpThumb.mimeType).toBe('image/webp')
    const webpMeta = await sharp(webpThumb.buffer, { animated: true }).metadata()
    expect(webpMeta.pages).toBe(2)

    const jpegThumb = result.sizes.jpegThumb!
    expect(jpegThumb).toBeDefined()
    expect(jpegThumb.width).toBe(50)
    expect(jpegThumb.height).toBe(40)
    expect(jpegThumb.mimeType).toBe('image/jpeg')
  })

  it('preserves animation frames when resizing animated WebP', async () => {
    const frame1 = await sharp({
      create: { width: 120, height: 60, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const frame2 = await sharp({
      create: { width: 120, height: 60, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const buffer = await sharp([frame1, frame2], { join: { animated: true } })
      .webp()
      .toBuffer()

    const result = await processImage({
      filename: 'animation.webp',
      buffer,
      mimeType: 'image/webp',
      sizes: {
        small: { width: 60 },
      },
    })

    expect(result.original.width).toBe(120)
    expect(result.original.height).toBe(60)

    const small = result.sizes.small!
    expect(small).toBeDefined()
    expect(small.width).toBe(60)
    expect(small.height).toBe(30)
    const smallMeta = await sharp(small.buffer, { animated: true }).metadata()
    expect(smallMeta.pages).toBe(2)
  })
})
