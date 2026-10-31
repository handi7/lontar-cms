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
export default defineConfig({
  plugins: [react(), dts({ entryRoot: 'src', exclude: ['**/*.test.*'] }), cssDts()],
  resolve: {
    alias: {
      'use-sync-external-store/shim/with-selector': resolve(
        import.meta.dirname,
        'src/shims/use-sync-external-store.ts',
      ),
      'use-sync-external-store/shim': resolve(
        import.meta.dirname,
        'src/shims/use-sync-external-store.ts',
      ),
      'use-sync-external-store': resolve(
        import.meta.dirname,
        'src/shims/use-sync-external-store.ts',
      ),
    },
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
