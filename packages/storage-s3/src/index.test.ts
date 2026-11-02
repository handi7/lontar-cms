import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { uploadMedia } from '@lontar/core'
import { s3Storage } from './index'

describe('@lontar/storage-s3', () => {
  const s3Mock = mockClient(S3Client)

  beforeEach(() => {
    s3Mock.reset()
  })

  it('uploads a file and sends PutObjectCommand to S3', async () => {
    s3Mock.on(PutObjectCommand).resolves({})

    const adapter = s3Storage({
      bucket: 'test-bucket',
      region: 'us-west-2',
      acl: 'public-read',
    })

    expect(adapter.name).toBe('s3')

    const file = {
      filename: 'sample.png',
      buffer: Buffer.from('fake image content'),
      mimeType: 'image/png',
    }

    const result = await adapter.upload(file)

    expect(result.filename).toBe('sample.png')
    expect(result.url).toBe('https://test-bucket.s3.us-west-2.amazonaws.com/sample.png')

    const calls = s3Mock.commandCalls(PutObjectCommand)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args[0].input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'sample.png',
      ContentType: 'image/png',
      ACL: 'public-read',
    })
  })

  it('deletes a file and sends DeleteObjectCommand to S3', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({})

    const adapter = s3Storage({
      bucket: 'test-bucket',
      region: 'us-east-1',
    })

    await adapter.delete('old-file.jpg')

    const calls = s3Mock.commandCalls(DeleteObjectCommand)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args[0].input).toEqual({
      Bucket: 'test-bucket',
      Key: 'old-file.jpg',
    })
  })

  it('ignores NoSuchKey error when deleting', async () => {
    const error = new Error('The specified key does not exist.')
    error.name = 'NoSuchKey'
    s3Mock.on(DeleteObjectCommand).rejects(error)

    const adapter = s3Storage({
      bucket: 'test-bucket',
      region: 'us-east-1',
    })

    await expect(adapter.delete('missing.jpg')).resolves.toBeUndefined()
  })

  describe('URL resolution', () => {
    it('uses custom baseUrl when provided', () => {
      const adapter = s3Storage({
        bucket: 'media',
        baseUrl: 'https://cdn.example.com/assets/',
      })
      expect(adapter.getUrl('avatar.png')).toBe('https://cdn.example.com/assets/avatar.png')
    })

    it('uses endpoint with forcePathStyle', () => {
      const adapter = s3Storage({
        bucket: 'media',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
      })
      expect(adapter.getUrl('avatar.png')).toBe('http://localhost:9000/media/avatar.png')
    })

    it('uses endpoint with virtual hosted style', () => {
      const adapter = s3Storage({
        bucket: 'media',
        endpoint: 'https://storage.example.com',
      })
      expect(adapter.getUrl('avatar.png')).toBe('https://media.storage.example.com/avatar.png')
    })

    it('defaults to standard AWS S3 URL', () => {
      const adapter = s3Storage({
        bucket: 'my-bucket',
        region: 'ap-southeast-1',
      })
      expect(adapter.getUrl('photo.jpg')).toBe(
        'https://my-bucket.s3.ap-southeast-1.amazonaws.com/photo.jpg',
      )
    })

    it('encodes special characters in getUrl', () => {
      const adapter = s3Storage({
        bucket: 'my-bucket',
        region: 'us-east-1',
      })
      expect(adapter.getUrl('cover #1.jpg')).toBe(
        'https://my-bucket.s3.us-east-1.amazonaws.com/cover%20%231.jpg',
      )
      expect(adapter.getUrl('100%.png')).toBe(
        'https://my-bucket.s3.us-east-1.amazonaws.com/100%25.png',
      )
    })
  })

  it('integrates with uploadMedia from @lontar/core', async () => {
    s3Mock.on(PutObjectCommand).resolves({})

    const adapter = s3Storage({
      bucket: 'my-bucket',
      region: 'us-east-1',
    })

    const doc = await uploadMedia({
      storage: adapter,
      file: {
        filename: 'text.txt',
        buffer: Buffer.from('hello s3'),
        mimeType: 'text/plain',
      },
    })

    expect(doc.filename).toBe('text.txt')
    expect(doc.url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/text.txt')
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1)
  })
})
