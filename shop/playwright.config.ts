import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'ADMIN_PASSWORD=e2e SESSION_SECRET=e2e-session-secret-that-is-at-least-32-chars npm run dev -- -H 127.0.0.1 -p 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: true, timeout: 60_000 },
})
