import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Kept in step with `resolve.alias` in vite.config.ts and `paths` in
    // tsconfig.json: the copied shadcn sources import `@/lib/utils`.
    alias: [{ find: /^@\//, replacement: `${resolve(import.meta.dirname, 'src')}/` }],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
