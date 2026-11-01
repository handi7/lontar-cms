import fs from 'node:fs/promises'
import path from 'node:path'
import type { StorageAdapter, UploadFile, UploadResult } from '@lontar/core'

export interface LocalStorageOptions {
  /**
   * Directory on disk where uploaded files are stored.
   * Defaults to path.resolve(process.cwd(), 'uploads').
   */
  uploadDir?: string
  /**
   * Base URL where uploaded files are served from.
   * Defaults to '/uploads'.
   */
  baseUrl?: string
}

function normalizeBaseUrl(baseUrl?: string): string {
  const url = baseUrl ?? '/uploads'
  return url.replace(/\/+$/, '')
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  )
}

export function localStorage(options: LocalStorageOptions = {}): StorageAdapter {
  const uploadDir = options.uploadDir
    ? path.resolve(options.uploadDir)
    : path.resolve(process.cwd(), 'uploads')
  const baseUrl = normalizeBaseUrl(options.baseUrl)

  let dirEnsured = false
  async function ensureDir(): Promise<void> {
    if (dirEnsured) return
    await fs.mkdir(uploadDir, { recursive: true })
    dirEnsured = true
  }

  function getUrl(filename: string): string {
    const cleanFilename = filename.replace(/^\/+/, '')
    return `${baseUrl}/${cleanFilename}`
  }

  async function upload(file: UploadFile): Promise<UploadResult> {
    await ensureDir()
    const filePath = path.join(uploadDir, file.filename)
    const fileDir = path.dirname(filePath)
    if (fileDir !== uploadDir) {
      await fs.mkdir(fileDir, { recursive: true })
    }
    await fs.writeFile(filePath, file.buffer)
    return {
      filename: file.filename,
      url: getUrl(file.filename),
    }
  }

  async function remove(filename: string): Promise<void> {
    const filePath = path.join(uploadDir, filename)
    try {
      await fs.unlink(filePath)
    } catch (error: unknown) {
      if (!isFileNotFoundError(error)) {
        throw error
      }
    }
  }

  return {
    name: 'local',
    upload,
    delete: remove,
    getUrl,
  }
}

/** Alias for localStorage */
export const diskStorage = localStorage
