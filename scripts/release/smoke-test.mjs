// Installs the packed tarballs into a fresh project outside the workspace and checks that
// they work the way a user would consume them: manifests without `workspace:` ranges,
// every `exports` entry resolvable (and importable for JS), every bin runnable, and the
// published types compiling with skipLibCheck off.
//
// Usage: node scripts/release/smoke-test.mjs <tarballDir>
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fail, listTarballFiles, listTarballs, readTarballManifest, repoRoot, run } from './lib.mjs'

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']
const REQUIRED_FILES = ['package.json', 'LICENSE', 'README.md']
// Peers the packages expect the host app to provide, plus types for the typecheck.
const HOST_PACKAGES = [
  'react@19',
  'react-dom@19',
  '@types/react@19',
  '@types/react-dom@19',
  '@types/node@22',
]

const dirArg = process.argv[2]
if (!dirArg) fail('Usage: node scripts/release/smoke-test.mjs <tarballDir>')

const tarballs = listTarballs(resolve(dirArg))
const packages = tarballs.map((tarball) => ({ tarball, manifest: readTarballManifest(tarball) }))

const problems = packages.flatMap(checkTarball)
if (problems.length > 0) fail(`Tarball problems:\n  - ${problems.join('\n  - ')}`)
console.log(`✔ ${packages.length} tarballs have complete manifests and files`)

const project = mkdtempSync(join(tmpdir(), 'lontar-smoke-'))
try {
  installProject(project)
  const entries = packages.flatMap(({ manifest }) => listEntries(manifest))
  for (const entry of entries) checkEntry(project, entry)
  console.log(`✔ ${entries.length} export entries resolve`)
  for (const { manifest } of packages) checkBins(project, manifest)
  typecheck(project, entries)
  console.log('✔ Published types compile (moduleResolution: bundler, skipLibCheck: false)')
} finally {
  rmSync(project, { recursive: true, force: true })
}
console.log('\n✔ Smoke test passed')

function checkTarball({ tarball, manifest }) {
  const id = `${manifest.name}@${manifest.version}`
  const files = new Set(listTarballFiles(tarball))
  const missing = REQUIRED_FILES.filter((file) => !files.has(file)).map(
    (f) => `${id}: missing ${f}`,
  )
  if (![...files].some((file) => file.startsWith('dist/'))) missing.push(`${id}: no dist/ files`)
  return [...missing, ...findWorkspaceRanges(manifest).map((dep) => `${id}: ${dep}`)]
}

function findWorkspaceRanges(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, range]) => range.startsWith('workspace:'))
      .map(([name, range]) => `${field}.${name} is "${range}"`),
  )
}

function installProject(project) {
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({ name: 'lontar-smoke', private: true, type: 'module' }),
  )
  console.log(`\n▶ Installing tarballs into ${project}`)
  // npm rather than pnpm: closer to what most users run, and nothing can leak in from the workspace.
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs, ...HOST_PACKAGES],
    { cwd: project },
  )
}

/** One `{ specifier, target, hasTypes }` per `exports` key. */
function listEntries(manifest) {
  const exportsMap =
    typeof manifest.exports === 'string' ? { '.': manifest.exports } : manifest.exports
  return Object.entries(exportsMap ?? {}).map(([key, value]) => ({
    specifier: key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`,
    target: typeof value === 'string' ? value : (value.import ?? value.default),
    hasTypes: typeof value === 'object' && 'types' in value,
  }))
}

function checkEntry(project, { specifier, target }) {
  const isJs = /\.[cm]?js$/.test(target)
  // Resolving checks the exports map points at a real file; importing also loads it, which
  // catches dependencies that are imported but not declared.
  const script = isJs
    ? `await import(${JSON.stringify(specifier)})`
    : `import { existsSync } from 'node:fs'
       import { fileURLToPath } from 'node:url'
       const file = fileURLToPath(import.meta.resolve(${JSON.stringify(specifier)}))
       if (!existsSync(file)) throw new Error('missing ' + file)`
  console.log(`  ${isJs ? 'import ' : 'resolve'} ${specifier}`)
  run('node', ['--input-type=module', '-e', script], { cwd: project })
}

function checkBins(project, manifest) {
  const bins = typeof manifest.bin === 'string' ? { [manifest.name]: manifest.bin } : manifest.bin
  for (const name of Object.keys(bins ?? {})) {
    console.log(`  run     ${name} --help`)
    run('npx', ['--no-install', name, '--help'], { cwd: project, stdio: 'ignore' })
  }
}

function typecheck(project, entries) {
  const typed = entries.filter((entry) => entry.hasTypes)
  const source = typed.map((e, i) => `export * as e${i} from ${JSON.stringify(e.specifier)}`)
  writeFileSync(join(project, 'check.ts'), `${source.join('\n')}\n`)
  writeFileSync(
    join(project, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        // nodenext is not checked yet: @lontar/admin's declarations still use extensionless
        // relative imports (#91, item 4).
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ['check.ts'],
    }),
  )
  const tsc = join(repoRoot, 'node_modules/typescript/bin/tsc')
  if (!existsSync(tsc)) fail('TypeScript is not installed at the repo root. Run pnpm install.')
  const { stdout } = spawnSync('node', [tsc, '-p', project, '--pretty', 'false'], {
    encoding: 'utf8',
  })
  // skipLibCheck stays off so errors inside our own .d.ts files (like the unresolvable
  // imports in #91) surface, but third-party declarations (drizzle-orm, better-auth) have
  // errors of their own that users skip too, so only diagnostics in our files fail the run.
  const diagnostics = stdout.split('\n').filter((line) => /: error TS\d+:/.test(line))
  const ours = diagnostics.filter((line) => /^check\.ts\(|node_modules\/@lontar\//.test(line))
  if (diagnostics.length > ours.length) {
    console.log(
      `  (ignored ${diagnostics.length - ours.length} errors in third-party declarations)`,
    )
  }
  if (ours.length > 0) fail(`Type errors in published declarations:\n${ours.join('\n')}`)
}
