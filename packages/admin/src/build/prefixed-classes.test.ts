// Guards against writing Tailwind variants before the prefix (e.g. `lg:lt:flex-row`).
// With Tailwind v4's `prefix(lt)`, the prefix must come first: `lt:lg:flex-row`.
// Writing `<variant>:lt:` causes Tailwind to silently omit the utility from the
// emitted stylesheet. See issue #230 and docs/adr/0019.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = resolve(import.meta.dirname, '..')

function getSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getSourceFiles(fullPath))
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

describe('admin class prefixing', () => {
  it('never writes variants before the lt: prefix (<variant>:lt:)', () => {
    const files = getSourceFiles(srcDir)
    const invertedVariantRegex = /\b([a-zA-Z0-9_-]+):lt:/g
    const violations: { file: string; line: number; match: string }[] = []

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      lines.forEach((lineText, index) => {
        // Skip comments in this test file itself
        if (file.endsWith('prefixed-classes.test.ts')) return

        let match: RegExpExecArray | null
        while ((match = invertedVariantRegex.exec(lineText)) !== null) {
          violations.push({
            file: file.replace(srcDir, 'packages/admin/src'),
            line: index + 1,
            match: match[0],
          })
        }
      })
    }

    expect(
      violations,
      `Found classes with inverted prefix (expected \`lt:<variant>:...\`): \n${violations
        .map((v) => `  ${v.file}:${v.line} -> ${v.match}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
