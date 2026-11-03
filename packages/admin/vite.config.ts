import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import dts from 'vite-plugin-dts'

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
    dts({ entryRoot: 'src', include: ['src'], exclude: ['**/*.test.*'], pathsToAliases: false }),
    cssDts(),
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
