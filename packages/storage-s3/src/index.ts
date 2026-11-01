import type { ObjectCannedACL, S3ClientConfig } from '@aws-sdk/client-s3'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { StorageAdapter, UploadFile, UploadResult } from '@lontar/core'

export interface S3StorageOptions {
  /** The S3 bucket name */
  bucket: string
  /** S3 endpoint URL (e.g. for MinIO, Cloudflare R2, LocalStack) */
  endpoint?: string
  /** AWS region, defaults to process.env.AWS_REGION or 'us-east-1' */
  region?: string
  /** AWS credentials */
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
  /** Whether to force path style URLs (e.g. http://localhost:9000/bucket/file) */
  forcePathStyle?: boolean
  /** Public base URL prefix (e.g. 'https://cdn.example.com') */
  baseUrl?: string
  /** ACL for uploaded objects (e.g. 'public-read') */
  acl?: ObjectCannedACL
  /** Preconfigured S3Client instance */
  client?: S3Client
}

function resolveEndpointUrl(
  endpoint: string,
  bucket: string,
  filename: string,
  forcePathStyle?: boolean,
): string {
  const cleanEndpoint = endpoint.replace(/\/+$/, '')
  if (forcePathStyle) {
    return `${cleanEndpoint}/${bucket}/${filename}`
  }
  try {
    const parsed = new URL(cleanEndpoint)
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.protocol}//${bucket}.${parsed.host}${pathname}/${filename}`
  } catch {
    return `${cleanEndpoint}/${bucket}/${filename}`
  }
}

function resolveS3Url(
  filename: string,
  options: {
    bucket: string
    region: string
    endpoint?: string
    baseUrl?: string
    forcePathStyle?: boolean
  },
): string {
  const cleanFilename = filename.replace(/^\/+/, '')
  if (options.baseUrl) {
    return `${options.baseUrl.replace(/\/+$/, '')}/${cleanFilename}`
  }
  if (options.endpoint) {
    return resolveEndpointUrl(
      options.endpoint,
      options.bucket,
      cleanFilename,
      options.forcePathStyle,
    )
  }
  return `https://${options.bucket}.s3.${options.region}.amazonaws.com/${cleanFilename}`
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404
  )
}

function createS3Client(options: S3StorageOptions): S3Client {
  if (options.client) return options.client

  const clientConfig: S3ClientConfig = {
    region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
  }
  if (options.endpoint) {
    clientConfig.endpoint = options.endpoint
  }
  if (options.credentials) {
    clientConfig.credentials = options.credentials
  }
  if (options.forcePathStyle !== undefined) {
    clientConfig.forcePathStyle = options.forcePathStyle
  }
  return new S3Client(clientConfig)
}

export function s3Storage(options: S3StorageOptions): StorageAdapter {
  const bucket = options.bucket
  const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1'
  const client = createS3Client(options)

  function getUrl(filename: string): string {
    return resolveS3Url(filename, {
      bucket,
      region,
      endpoint: options.endpoint,
      baseUrl: options.baseUrl,
      forcePathStyle: options.forcePathStyle,
    })
  }

  async function upload(file: UploadFile): Promise<UploadResult> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: file.filename,
        Body: file.buffer,
        ContentType: file.mimeType,
        ACL: options.acl,
      }),
    )
    return {
      filename: file.filename,
      url: getUrl(file.filename),
    }
  }

  async function remove(filename: string): Promise<void> {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: filename,
        }),
      )
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }
  }

  return {
    name: 's3',
    upload,
    delete: remove,
    getUrl,
  }
}
