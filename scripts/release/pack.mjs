// Packs every public package into <outDir> with `pnpm pack`, which rewrites `workspace:`
// ranges to real versions. Run `pnpm build` first.
//
// Usage: node scripts/release/pack.mjs <outDir>
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fail, listPublicPackages, run } from './lib.mjs'

const outArg = process.argv[2]
if (!outArg) fail('Usage: node scripts/release/pack.mjs <outDir>')
const outDir = resolve(outArg)

mkdirSync(outDir, { recursive: true })
// Old tarballs would otherwise be smoke-tested or published alongside the new ones.
for (const file of readdirSync(outDir).filter((f) => f.endsWith('.tgz'))) {
  rmSync(join(outDir, file))
}

for (const pkg of listPublicPackages()) {
  console.log(`\n▶ Packing ${pkg.name}@${pkg.version}`)
  run('pnpm', ['pack', '--pack-destination', outDir], { cwd: pkg.dir })
}

console.log(
  `\n✔ Packed ${readdirSync(outDir).filter((f) => f.endsWith('.tgz')).length} tarballs into ${outDir}`,
)
