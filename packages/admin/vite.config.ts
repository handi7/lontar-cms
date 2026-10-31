import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// The admin ships prebuilt (docs/adr/0001-spa-admin.md): everything is bundled
// except React, which must come from the host app so there is only one copy.
export default defineConfig({
  plugins: [react(), dts({ entryRoot: 'src', exclude: ['**/*.test.*'] })],
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
