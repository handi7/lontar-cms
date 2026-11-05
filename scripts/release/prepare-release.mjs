// Checks that a release tag matches the version of the root package.json and every public
// package, and writes that version's CHANGELOG.md section to <notesOut> for the GitHub Release.
//
// Usage: node scripts/release/prepare-release.mjs <tag> <notesOut>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail, listPublicPackages, repoRoot } from './lib.mjs'

const [tag, notesOut] = process.argv.slice(2)
if (!tag || !notesOut) fail('Usage: node scripts/release/prepare-release.mjs <tag> <notesOut>')

// Prereleases would need their own npm dist-tag so they don't become `latest`; not supported yet.
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag)
if (!match) fail(`Tag "${tag}" is not a release tag like v1.2.3.`)
const version = match[1]

const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const versions = [{ name: 'root package.json', version: root.version }, ...listPublicPackages()]
const mismatched = versions.filter((pkg) => pkg.version !== version)
if (mismatched.length > 0) {
  const list = mismatched.map((pkg) => `${pkg.name} is ${pkg.version}`).join(', ')
  fail(`Tag ${tag} does not match package versions: ${list}. Bump them before tagging.`)
}

const notes = extractChangelogSection(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8'), version)
if (!notes) fail(`CHANGELOG.md has no "## [${version}]" section with content.`)
writeFileSync(notesOut, `${absolutizeLinks(notes, tag)}\n`)
console.log(
  `✔ ${tag} matches ${versions.length - 1} packages; release notes written to ${notesOut}`,
)

function extractChangelogSection(changelog, wanted) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## [${wanted}]`))
  if (start === -1) return ''
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
}

/** Relative links like `(docs/adr/0018-license-mit.md)` only work inside the repo, not in a GitHub Release. */
function absolutizeLinks(markdown, ref) {
  const repoUrl = root.repository?.url ?? listPublicPackages()[0].manifest.repository.url
  const base = repoUrl.replace(/^git\+/, '').replace(/\.git$/, '')
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, `](${base}/blob/${ref}/$1)`)
}
