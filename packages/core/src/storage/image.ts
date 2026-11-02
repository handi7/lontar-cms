import sharp, { type Metadata } from 'sharp'

export type ImageFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'

export interface ImageSizeConfig {
  width?: number
  height?: number
  fit?: ImageFit
  format?: ImageFormat
  quality?: number
  withoutEnlargement?: boolean
}

export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export class InvalidImageError extends Error {
  constructor(message = 'Invalid image') {
    super(message)
    this.name = 'InvalidImageError'
  }
}

export interface UploadConfig {
  /** Resize presets keyed by size name (e.g. `thumb`, `hero`) */
  sizes?: Record<string, ImageSizeConfig>
  /** Optional allowed mime types list (e.g. `['image/jpeg', 'image/png']`) */
  mimeTypes?: string[]
  /** Maximum allowed file size in bytes. Defaults to 10 MB (10 * 1024 * 1024). */
  maxFileSize?: number
}

export interface ProcessedImageSize {
  name: string
  filename: string
  buffer: Buffer
  width?: number
  height?: number
  filesize: number
  mimeType: string
}

export interface ProcessedOriginal {
  filename: string
  buffer: Buffer
  width?: number
  height?: number
  filesize: number
  mimeType: string
}

export interface ProcessedImageResult {
  original: ProcessedOriginal
  sizes: Record<string, ProcessedImageSize>
}

const RESIZABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/tiff',
  'image/gif',
])

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
  gif: 'image/gif',
}

export function isResizableImage(mimeType: string): boolean {
  return RESIZABLE_MIME_TYPES.has(mimeType.toLowerCase())
}

export function formatVariantFilename(
  originalFilename: string,
  sizeName: string,
  format?: string,
): string {
  const lastDot = originalFilename.lastIndexOf('.')
  const base = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename
  const ext = format ?? (lastDot > 0 ? originalFilename.slice(lastDot + 1) : '')
  return ext ? `${base}-${sizeName}.${ext}` : `${base}-${sizeName}`
}

function resolveMimeType(originalMime: string, format?: string): string {
  if (format && FORMAT_TO_MIME[format]) {
    return FORMAT_TO_MIME[format]
  }
  return originalMime
}

async function resizeVariant(
  buffer: Buffer,
  name: string,
  config: ImageSizeConfig,
  originalFilename: string,
  originalMimeType: string,
): Promise<ProcessedImageSize> {
  try {
    let pipeline = sharp(buffer).rotate()
    pipeline = pipeline.resize({
      width: config.width,
      height: config.height,
      fit: config.fit ?? 'cover',
      withoutEnlargement: config.withoutEnlargement ?? true,
    })

    if (config.format) {
      pipeline = pipeline.toFormat(config.format, {
        quality: config.quality,
      })
    }

    const resizedBuffer = await pipeline.toBuffer()
    const meta = await sharp(resizedBuffer).metadata()
    const mimeType = resolveMimeType(originalMimeType, config.format)
    const filename = formatVariantFilename(originalFilename, name, config.format)

    return {
      name,
      filename,
      buffer: resizedBuffer,
      width: meta.width,
      height: meta.height,
      filesize: resizedBuffer.length,
      mimeType,
    }
  } catch (err) {
    if (err instanceof InvalidImageError) throw err
    throw new InvalidImageError('Invalid image')
  }
}

export async function processImage(args: {
  filename: string
  buffer: Buffer
  mimeType: string
  sizes?: Record<string, ImageSizeConfig>
}): Promise<ProcessedImageResult> {
  const { filename, buffer, mimeType, sizes } = args

  if (!isResizableImage(mimeType)) {
    return {
      original: {
        filename,
        buffer,
        filesize: buffer.length,
        mimeType,
      },
      sizes: {},
    }
  }

  let meta: Metadata
  try {
    meta = await sharp(buffer).metadata()
  } catch {
    throw new InvalidImageError('Invalid image')
  }

  const original: ProcessedOriginal = {
    filename,
    buffer,
    width: meta.width,
    height: meta.height,
    filesize: buffer.length,
    mimeType,
  }

  if (!sizes || Object.keys(sizes).length === 0) {
    return { original, sizes: {} }
  }

  const processedSizes: Record<string, ProcessedImageSize> = {}
  for (const [name, config] of Object.entries(sizes)) {
    processedSizes[name] = await resizeVariant(buffer, name, config, filename, mimeType)
  }

  return {
    original,
    sizes: processedSizes,
  }
}
