# 0007: Upload validation, size limits, and access check order

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Upload endpoints were vulnerable to multiple security and denial-of-service issues:

1. **Unvalidated MIME types and missing magic bytes verification**: MIME type checks compared only the client-supplied `file.type` against `upload.mimeTypes`. A client could upload an HTML document or executable script disguised as `image/png` or `image/x-foo`. With local storage served from the application origin, stored HTML/SVG files presented a stored Cross-Site Scripting (XSS) risk against the admin interface and users.
2. **Missing file size limits**: `UploadConfig` lacked a `maxFileSize` property and routes had no body limit middleware. A caller could transmit arbitrarily large payloads, exhausting server memory (OOM).
3. **Improper check order (body parsed before access check)**: `handleUploadCreate` and `handleUploadUpdate` called `c.req.parseBody()` before verifying user access permissions. An unauthenticated or unauthorized caller could force the server to buffer multi-megabyte uploads before receiving a `401 Unauthorized`.
4. **Sharp decode errors becoming 500s**: Uploading invalid or corrupt image bytes caused Sharp to throw unhandled exceptions, resulting in default 500 internal server errors rather than a client-safe 400 Bad Request.

## Decision

1. **Access check precedes body reading**:
   - Preliminary access checks run using the session alone (`{ user }` for create, `{ user, id }` for update).
   - If unauthorized, the server immediately returns `401/403` without reading or buffering request body data.
   - Secondary checks evaluate field-level data only after preliminary authorization and parsing succeed.

2. **File size limits and body limit middleware**:
   - Added `maxFileSize?: number` to `UploadConfig` (defaulting to 10 MB via `DEFAULT_MAX_FILE_SIZE`).
   - Enforced route-level size limits using Hono's `bodyLimit` middleware on upload endpoints (`POST /:collection`, `PATCH /:collection/:id`). Payloads exceeding limits return `413 Payload Too Large`.
   - Exposed `maxFileSize` in `ClientUploadConfig` so the admin SPA pre-checks file sizes before transmitting.

3. **Magic byte sniffing and dangerous type restrictions**:
   - Used `file-type` (`fileTypeFromBuffer`) to sniff real file formats from magic bytes.
   - Rejected spoofed images where declared MIME type is `image/*` but buffer bytes do not match an image signature.
   - Normalized stored filename extensions based on the sniffed format.
   - Denied active/dangerous MIME types (`text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/javascript`) by default and through wildcards (`*/*`, `image/*`), requiring explicit inclusion in `upload.mimeTypes` to be accepted.
   - Inspected buffer content for embedded `<script>` tags, rejecting executable scripts.
   - Set `Content-Disposition: attachment; filename="..."` on all non-image uploads.

4. **Safe error mapping for image processing**:
   - Wrapped Sharp decoding and resizing in `InvalidImageError`.
   - Mapped decode failures to `400 { error: 'Invalid image' }`.

## Consequences

- Prevents memory exhaustion attacks by unauthorized callers and oversized uploads.
- Eliminates stored XSS vectors via disguised HTML or malicious SVGs.
- Standardizes stored extensions to verified magic byte formats.
- Ensures graceful 400 client errors instead of 500 crashes when corrupted media is submitted.
