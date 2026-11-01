import type { StorageAdapter, UploadFile } from './adapter'
import { processImage, type ProcessedImageSize, type UploadConfig } from './image'

export interface UploadedImageVariant {
  filename: string
  url: string
  width?: number
  height?: number
  filesize: number
  mimeType: string
}

export interface UploadedMediaDoc {
  filename: string
  url: string
  mimeType: string
  filesize: number
  width?: number
  height?: number
  sizes?: Record<string, UploadedImageVariant>
}

async function uploadSizes(
  storage: StorageAdapter,
  sizes: Record<string, ProcessedImageSize>,
): Promise<Record<string, UploadedImageVariant>> {
  const result: Record<string, UploadedImageVariant> = {}
  for (const [name, variant] of Object.entries(sizes)) {
    const uploadRes = await storage.upload({
      filename: variant.filename,
      buffer: variant.buffer,
      mimeType: variant.mimeType,
    })
    result[name] = {
      filename: uploadRes.filename,
      url: uploadRes.url,
      width: variant.width,
      height: variant.height,
      filesize: variant.filesize,
      mimeType: variant.mimeType,
    }
  }
  return result
}

export async function uploadMedia(args: {
  storage: StorageAdapter
  file: UploadFile
  uploadConfig?: boolean | UploadConfig
}): Promise<UploadedMediaDoc> {
  const { storage, file, uploadConfig } = args
  const sizes = typeof uploadConfig === 'object' ? uploadConfig.sizes : undefined

  const processed = await processImage({
    filename: file.filename,
    buffer: file.buffer,
    mimeType: file.mimeType,
    sizes,
  })

  const originalUpload = await storage.upload({
    filename: processed.original.filename,
    buffer: processed.original.buffer,
    mimeType: processed.original.mimeType,
  })

  const uploadedSizes = await uploadSizes(storage, processed.sizes)
  const hasSizes = Object.keys(uploadedSizes).length > 0

  return {
    filename: originalUpload.filename,
    url: originalUpload.url,
    mimeType: processed.original.mimeType,
    filesize: processed.original.filesize,
    width: processed.original.width,
    height: processed.original.height,
    ...(hasSizes ? { sizes: uploadedSizes } : {}),
  }
}

export async function deleteMedia(args: {
  storage: StorageAdapter
  filename: string
  sizes?: Record<string, { filename: string }>
}): Promise<void> {
  const { storage, filename, sizes } = args

  await storage.delete(filename)

  if (sizes) {
    for (const variant of Object.values(sizes)) {
      if (variant?.filename) {
        await storage.delete(variant.filename)
      }
    }
  }
}
