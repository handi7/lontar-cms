import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter } from '../database/adapter'
import type { Where } from '../query/types'

export interface SanitizedFilename {
  base: string
  ext: string
  sanitized: string
}

function stripControlChars(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code > 31 && (code < 127 || code > 159)) {
      result += str[i]
    }
  }
  return result
}

/**
 * Sanitizes a client-provided filename into a safe, traversal-free base and extension.
 * Strips path separators, null bytes, control characters, leading dots, and slugifies.
 */
export function sanitizeFilename(raw: string): SanitizedFilename {
  const normalized = raw.replace(/\\/g, '/')
  const baseNameWithExt = normalized.split('/').filter(Boolean).pop() ?? 'file'

  // Strip null bytes and control chars
  const stripped = stripControlChars(baseNameWithExt)

  // Strip leading dots to prevent hidden files (.env, etc.)
  const noLeadingDots = stripped.replace(/^\.+/, '')

  const lastDot = noLeadingDots.lastIndexOf('.')
  const rawBase = lastDot > 0 ? noLeadingDots.slice(0, lastDot) : noLeadingDots
  const rawExt = lastDot > 0 ? noLeadingDots.slice(lastDot + 1) : ''

  // Slugify base name: lowercase, replace spaces/symbols with '-', keep [a-z0-9_-]
  const cleanBase =
    rawBase
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file'

  // Extension: lowercase alphanumeric only
  const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '')

  const sanitized = cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase

  return { base: cleanBase, ext: cleanExt, sanitized }
}

function formatCandidateFilename(base: string, ext: string, counter: number): string {
  const suffix = counter === 0 ? '' : `-${counter}`
  return ext ? `${base}${suffix}.${ext}` : `${base}${suffix}`
}

function isDocOwner(existing: { id?: unknown } | undefined, excludeDocId?: number): boolean {
  if (!existing || excludeDocId === undefined) return false
  return Number(existing.id) === Number(excludeDocId)
}

export async function getUniqueFilename(args: {
  db: DatabaseAdapter
  collection: CollectionConfig
  base: string
  ext: string
  excludeDocId?: number
}): Promise<string> {
  const { db, collection, base, ext, excludeDocId } = args

  for (let counter = 0; counter < 1000; counter++) {
    const candidate = formatCandidateFilename(base, ext, counter)
    const where: Where = {
      filename: { equals: candidate },
    }
    const result = await db.find({ collection, where, limit: 1, page: 1 })
    const existing = result.docs[0]
    if (!existing || isDocOwner(existing, excludeDocId)) {
      return candidate
    }
  }

  const timestamp = Date.now()
  return ext ? `${base}-${timestamp}.${ext}` : `${base}-${timestamp}`
}
