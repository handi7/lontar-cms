import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // package.json "exports" is hand-written, so keep output extensions predictable.
  // publint then fails the build if the two ever drift apart.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  publint: true,
})
