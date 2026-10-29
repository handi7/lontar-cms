import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * docs/adr/0003-client-config-format.md: everything under src/client is bundled
 * into the admin and shipped to the browser. A stray import from the server half
 * of core would drag the database adapter, Hono, or the config into that bundle,
 * which is architecture rule 1 in AGENTS.md.
 *
 * This guards the boundary statically, so breaking it fails here rather than
 * showing up as a mysterious admin bundle size.
 */

const CLIENT_DIR = import.meta.dirname

/** Third-party packages the client half is allowed to depend on. */
const ALLOWED_PACKAGES = new Set(['zod'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

function importsOf(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import x from 'y' / export x from 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('y')
    /\bimport\s+['"]([^'"]+)['"]/g, // side-effect import 'y'
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

describe('@lontar/core/client', () => {
  const files = sourceFiles(CLIENT_DIR)

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s imports nothing outside the client boundary', (file) => {
    const offenders = importsOf(readFileSync(file, 'utf8')).filter((specifier) => {
      if (specifier.startsWith('.')) {
        // A relative import must stay inside src/client.
        const target = resolve(file, '..', specifier)
        return relative(CLIENT_DIR, target).startsWith('..')
      }
      // Bare specifiers must be explicitly allowed. Node builtins are server-only.
      return !ALLOWED_PACKAGES.has(specifier.split('/')[0] ?? specifier)
    })

    expect(offenders).toEqual([])
  })
})
