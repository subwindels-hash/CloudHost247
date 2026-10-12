/**
 * Browser end-to-end tests for the client-side tools (SalarioPay business tools, Employee ID Card,
 * MRZ page controls). The specs run against the production build served by `vite preview`, so
 * they exercise the same bundle that ships, not the dev server.
 *
 * Run locally:  npm run e2e
 * Chromium:     Playwright downloads its own build with `npx playwright install chromium`. Where
 *               that download is blocked, set CH247_CHROMIUM_PATH to an existing Chromium binary.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.CH247_E2E_PORT ?? 4173);
const executablePath = process.env.CH247_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --config frontend/vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
