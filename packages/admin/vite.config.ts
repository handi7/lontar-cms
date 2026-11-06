import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import dts from 'vite-plugin-dts'
import { scopeEmittedCss } from './src/build/scoped-css.ts'

// Rewrites the `:root` block Tailwind emits its theme variables on to the admin
// wrapper, then fails the build if any selector could still match an element in
// the host app (AGENTS.md architecture rule 7, docs/adr/0019).
function scopedCss(): Plugin {
  return {
    name: 'scoped-css',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue
        asset.source = scopeEmittedCss(asset.source.toString(), asset.fileName)
      }
    },
  }
}

function cssDts(): Plugin {
  return {
    name: 'css-dts',
    closeBundle() {
      writeFileSync(
        resolve(import.meta.dirname, 'dist/styles.css.d.ts'),
        'declare const styles: string\nexport default styles\n',
      )
    },
  }
}

// The admin ships prebuilt (docs/adr/0001-spa-admin.md): everything is bundled
// except React, which must come from the host app so there is only one copy.
// That's why the bundled libraries are devDependencies in package.json.
// `pathsToAliases: false` keeps `@lontar/core/client` a bare import in the
// emitted .d.ts instead of a relative path into the monorepo's source.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({
      entryRoot: 'src',
      include: ['src'],
      // `src/build` is build tooling and `src/test` holds test helpers; neither
      // is part of the published surface.
      exclude: ['**/*.test.*', 'src/build/**', 'src/test/**'],
      pathsToAliases: false,
    }),
    cssDts(),
    scopedCss(),
  ],
  resolve: {
    alias: [
      {
        find: /^use-sync-external-store(\/.*)?$/,
        replacement: resolve(import.meta.dirname, 'src/shims/use-sync-external-store.ts'),
      },
    ],
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
