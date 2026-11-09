import { defineConfig, devices } from '@playwright/test'

const port = process.env.PORT || '3005'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm start -p ${port}`,
    url: `http://127.0.0.1:${port}/api/_lontar/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      LONTAR_URL: `http://127.0.0.1:${port}`,
      BETTER_AUTH_TRUSTED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
      PLAYWRIGHT: 'true',
      DISABLE_AUTH_RATE_LIMIT: 'true',
    },
  },
})
