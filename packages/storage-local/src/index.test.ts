import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { uploadMedia } from '@lontar/core'
import { diskStorage, localStorage } from './index'

describe('@lontar/storage-local', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lontar-storage-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('uploads a file to disk and returns its url with default baseUrl', async () => {
    const adapter = localStorage({ uploadDir: tmpDir })
    expect(adapter.name).toBe('local')

    const file = {
      filename: 'test.txt',
      buffer: Buffer.from('hello local storage'),
      mimeType: 'text/plain',
    }

    const result = await adapter.upload(file)
    expect(result.filename).toBe('test.txt')
    expect(result.url).toBe('/uploads/test.txt')

    const written = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf8')
    expect(written).toBe('hello local storage')
  })

  it('supports custom baseUrl', async () => {
    const adapter = diskStorage({
      uploadDir: tmpDir,
      baseUrl: 'https://cdn.example.com/assets/',
    })

    const url = adapter.getUrl('photo.jpg')
    expect(url).toBe('https://cdn.example.com/assets/photo.jpg')

    const result = await adapter.upload({
      filename: 'photo.jpg',
      buffer: Buffer.from('image bytes'),
      mimeType: 'image/jpeg',
    })
    expect(result.url).toBe('https://cdn.example.com/assets/photo.jpg')
  })

  it('handles nested directory in filename', async () => {
    const adapter = localStorage({ uploadDir: tmpDir })

    const result = await adapter.upload({
      filename: 'nested/dir/doc.pdf',
      buffer: Buffer.from('pdf data'),
      mimeType: 'application/pdf',
    })

    expect(result.url).toBe('/uploads/nested/dir/doc.pdf')
    const written = await fs.readFile(path.join(tmpDir, 'nested/dir/doc.pdf'), 'utf8')
    expect(written).toBe('pdf data')
  })

  it('deletes an existing file', async () => {
    const adapter = localStorage({ uploadDir: tmpDir })
    await adapter.upload({
      filename: 'to-delete.txt',
      buffer: Buffer.from('temp'),
      mimeType: 'text/plain',
    })

    const filePath = path.join(tmpDir, 'to-delete.txt')
    await expect(fs.stat(filePath)).resolves.toBeDefined()

    await adapter.delete('to-delete.txt')
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  it('does not throw when deleting a non-existent file (idempotent)', async () => {
    const adapter = localStorage({ uploadDir: tmpDir })
    await expect(adapter.delete('does-not-exist.txt')).resolves.toBeUndefined()
  })

  it('integrates with uploadMedia from @lontar/core', async () => {
    const adapter = localStorage({ uploadDir: tmpDir, baseUrl: '/media' })

    const doc = await uploadMedia({
      storage: adapter,
      file: {
        filename: 'document.txt',
        buffer: Buffer.from('hello'),
        mimeType: 'text/plain',
      },
    })

    expect(doc.filename).toBe('document.txt')
    expect(doc.url).toBe('/media/document.txt')
    expect(doc.filesize).toBe(5)
  })
})
