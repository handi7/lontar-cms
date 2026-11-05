// Publishes the tarballs in <tarballDir> with the npm CLI. In GitHub Actions, npm >= 11.5.1
// authenticates through trusted publishing (OIDC) and adds provenance on its own, so no token
// is needed. Versions already on the registry are skipped, so re-running after a partial
// publish is safe.
//
// Usage: node scripts/release/publish.mjs <tarballDir> [--dry-run]
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fail, listTarballs, readTarballManifest, run } from './lib.mjs'

const [dirArg, ...flags] = process.argv.slice(2)
if (!dirArg) fail('Usage: node scripts/release/publish.mjs <tarballDir> [--dry-run]')
const dryRun = flags.includes('--dry-run')

for (const tarball of listTarballs(resolve(dirArg))) {
  const { name, version } = readTarballManifest(tarball)
  const id = `${name}@${version}`
  // Also skipped in a dry run: npm 11 rejects `publish --dry-run` for an existing version.
  if (isPublished(id)) {
    console.log(`- ${id} is already on npm, skipping`)
    continue
  }
  console.log(`\n▶ ${dryRun ? 'Dry-run publishing' : 'Publishing'} ${id}`)
  run('npm', ['publish', tarball, '--access', 'public', ...(dryRun ? ['--dry-run'] : [])])
}

console.log(`\n✔ ${dryRun ? 'Dry run finished' : 'Publish finished'}`)

function isPublished(id) {
  const result = spawnSync('npm', ['view', id, 'version'], { encoding: 'utf8' })
  if (result.status === 0) return result.stdout.trim() !== ''
  if (/E404|is not in this registry/.test(result.stderr)) return false
  fail(`Could not check whether ${id} is on npm:\n${result.stderr}`)
}
