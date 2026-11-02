# 0015: Storage and database synchronization on upload failure

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

When uploading media files (via `POST /api/:collection` or `PATCH /api/:collection/:id`), the process involves multiple stages across storage and database:

1. **Multi-Variant Upload Partial Failures**:
   - `uploadMedia` uploads the original file and then each configured size variant sequentially.
   - If an error occurred on a subsequent variant (e.g. S3 timeout or network glitch on variant 2), previously uploaded variants and the original file were orphaned in storage with no automatic cleanup.
2. **Post-Write Hook (`afterChange`) Failure vs Storage Rollback**:
   - If an `afterChange` hook threw an exception during create or update on an upload collection:
     - The upload route caught the exception and invoked `safeDeleteMedia` / `rollbackNewMedia`, deleting the uploaded file from storage.
     - However, if the database write had already been executed without transaction rollback (or on database adapters without transactions), the committed row was left pointing to deleted files, causing broken links and data inconsistency.
     - On update, the newly uploaded file would be deleted while the database row was updated, and the previous media file was orphaned or broken.

## Decision

1. **Atomic Storage Upload Cleanup & `StorageUploadError` (`packages/core/src/storage/pipeline.ts`)**:
   - Added a typed error class `StorageUploadError` carrying `uploadedKeys: readonly string[]` and optional `cause`.
   - `uploadMedia` tracks all uploaded filenames across the original and size variants.
   - If any variant or original upload fails, `uploadMedia` immediately cleans up all already-uploaded keys using `storage.delete(key)` before rethrowing `StorageUploadError`.
   - The collection upload route catches `StorageUploadError` and cleanly returns `500 { error: 'Upload failed' }` JSON.
2. **Database Mutation Compensation on Hook Failure (`packages/core/src/server/routes/collection.ts`)**:
   - If `db.transaction` is supported (e.g. `@lontar/db-mysql`), any error in `runAfterChangeHooks` triggers a transaction rollback, reverting all database writes.
   - If `db.transaction` is not supported (fallback / custom adapters), `executeCreate` and `executeUpdate` perform compensating operations:
     - On `create`: Deletes the created row via `db.delete({ id: created.id })` if `afterChange` throws.
     - On `update`: Reverts the document to `originalDoc` via `db.update({ data: buildRevertData(originalDoc, data) })` if `afterChange` throws.
3. **Storage Rollback on Mutation Failure (`packages/core/src/server/routes/collection-upload.ts`)**:
   - On `create`: When `executeCreate` fails or throws, `safeDeleteMedia` deletes the newly uploaded files. Combined with DB rollback/compensation, neither the row nor the files exist.
   - On `update`: When `executeUpdate` fails or throws, `rollbackNewMedia` deletes the newly uploaded files without calling `cleanupReplacedMedia`. The original row and original files remain completely intact.

## Consequences

- Prevents orphan files in storage when variant generation/upload encounters transient errors.
- Prevents database rows from pointing to deleted media when post-change hooks throw errors.
- Guarantees transactional or compensated rollback across both database state and file storage on upload errors.
