// Shared helpers for the release scripts (see docs/releasing.md).
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Every non-private package under packages/, as `{ name, version, dir, manifest }`. */
export function listPublicPackages() {
  const packagesDir = join(repoRoot, 'packages')
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(packagesDir, entry.name)
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      return { name: manifest.name, version: manifest.version, dir, manifest }
    })
    .filter((pkg) => !pkg.manifest.private)
}

/** Runs a command, streaming its output. Throws if it exits non-zero. */
export function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

/** Runs a command and returns its stdout. Throws if it exits non-zero. */
export function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })
}

/** Absolute paths of the .tgz files in `dir`, @lontar/core first so dependents publish after it. */
export function listTarballs(dir) {
  const tarballs = readdirSync(dir)
    .filter((file) => file.endsWith('.tgz'))
    .sort(
      (a, b) => Number(b.includes('-core-')) - Number(a.includes('-core-')) || a.localeCompare(b),
    )
    .map((file) => join(dir, file))
  if (tarballs.length === 0) fail(`No .tgz files in ${dir}. Run pack.mjs first.`)
  return tarballs
}

/** The package.json inside a tarball made by `pnpm pack`. */
export function readTarballManifest(tarball) {
  return JSON.parse(capture('tar', ['-xzOf', tarball, 'package/package.json']))
}

/** File paths inside a tarball, relative to the package root. */
export function listTarballFiles(tarball) {
  return capture('tar', ['-tzf', tarball])
    .split('\n')
    .filter(Boolean)
    .map((path) => path.replace(/^package\//, ''))
}

export function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}
