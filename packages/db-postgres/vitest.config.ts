import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests create isolated databases via setupTestDatabase(), so parallel execution is safe.
  },
})
