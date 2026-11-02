# 0016: Storage URL resolution, file serving endpoint, and S3 adapter fixes

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Handling media storage and URL resolution in Lontar revealed several issues:

1. **Local Storage Default URLs Did Not Resolve Out of the Box**:
   - The `@lontar/storage-local` adapter defaulted returned URLs to `/uploads/${filename}`.
   - Unless a host application (such as Next.js or an Express server) explicitly configured a static file server at `/uploads`, media URLs returned 404 in admin previews and API responses.
   - The core engine had no route to serve uploaded files, and `StorageAdapter` lacked a method for reading stored file contents.

2. **S3 Region Resolution with Preconfigured Client**:
   - When users passed a custom `client: new S3Client(...)` to `s3Storage` without explicitly repeating `region: '...'` in the options, URL resolution defaulted to `us-east-1` instead of inspecting the client's configured region.
   - In AWS SDK v3, `client.config.region()` is an asynchronous function returning a Promise, while `getUrl` in the storage adapter interface is synchronous.

3. **S3 Key Normalization & Path Traversal**:
   - Keys passed to S3 with leading slashes could result in malformed URLs (e.g. `https://bucket.s3.region.amazonaws.com//filename`) or failed lookups.
   - File serving endpoints must rigorously reject path traversal attempts (`..` or null bytes).

## Decision

1. **StorageAdapter Read Capability (`packages/core/src/storage/adapter.ts`)**:
   - Added an optional `read?(filename: string): Promise<Buffer | null>` method to `StorageAdapter`.
   - Updated `StorageAdapter.upload` and `getUrl` signatures to optionally accept `collectionSlug?: string`.
   - Implemented `read` in `@lontar/storage-local` with path traversal validation (`assertSafePath`).

2. **Core File Serving Route (`packages/core/src/server/routes/collection.ts`, `collection-upload.ts`)**:
   - Registered `GET /:collection/file/:filename{.+$}` in core collection routing.
   - Rejects missing filenames and path traversal attempts (`..` or null bytes) with 400.
   - Validates that the collection has `upload: true` (404 otherwise).
   - Validates collection read access permissions (`collection.access?.read`) (401/403 if denied).
   - Retrieves the file buffer via `config.storage.read(filename)`.
   - Sniffs the MIME type via `file-type` (defaulting to `application/octet-stream`).
   - Sets `Content-Disposition: inline` for images and `Content-Disposition: attachment; filename="..."` for other files.
   - Sets cache headers: `Cache-Control: public, max-age=31536000, immutable`.

3. **Local Storage URL Generation (`packages/storage-local/src/index.ts`)**:
   - When `options.baseUrl` is provided, files continue to resolve to `${baseUrl}/${encodedFilename}`.
   - When `options.baseUrl` is omitted and `collectionSlug` is provided, URLs resolve to `/api/${collectionSlug}/file/${encodedFilename}`.
   - Updated `uploadMedia` pipeline in core to forward `collectionSlug` from collection upload handlers to `storage.upload(...)`.

4. **S3 Storage Key Normalization & Async Region Resolution (`packages/storage-s3/src/index.ts`)**:
   - Added `normalizeS3Key` stripping any leading `/` characters from object keys.
   - When `options.client` is passed without an explicit `region`, asynchronously calls `client.config.region()` during initialization and `upload` to cache the resolved region for URL formatting.

## Consequences

- Media files stored locally resolve and display in the admin panel and API out of the box without requiring manual static route configuration.
- Access control on uploaded files is enforced at the route level via collection read permissions.
- Preconfigured S3 clients automatically generate valid URLs matching their true AWS region.
