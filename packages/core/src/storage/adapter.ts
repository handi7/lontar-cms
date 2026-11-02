export interface UploadFile {
  filename: string
  buffer: Buffer
  mimeType: string
  contentDisposition?: string
}

export interface UploadResult {
  filename: string
  url: string
}

export interface StorageAdapter {
  /** Name of the adapter, e.g. 'local' or 's3' */
  readonly name: string

  /**
   * Upload a file buffer to storage.
   * Returns the final stored filename and its public URL.
   */
  upload(file: UploadFile, collectionSlug?: string): Promise<UploadResult>

  /**
   * Delete a file from storage.
   * Should be idempotent (not throw if file is already deleted/missing).
   */
  delete(filename: string): Promise<void>

  /**
   * Get the public URL for a given stored filename.
   */
  getUrl(filename: string, collectionSlug?: string): string | Promise<string>

  /**
   * Read file contents from storage as a Buffer.
   * Returns null if file is not found.
   */
  read?(filename: string): Promise<Buffer | null>
}
