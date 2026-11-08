/**
 * Generates a stable, URL-safe 16-character hexadecimal row ID for array and block rows.
 * Per ADR 0021.
 */
export function generateRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  let hex = ''
  for (let i = 0; i < 16; i++) {
    hex += Math.floor(Math.random() * 16).toString(16)
  }
  return hex
}
