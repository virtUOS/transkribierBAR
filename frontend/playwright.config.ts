import { defineConfig } from '@playwright/test'
import { API_PORT, WEB_PORT, frontendDir } from './e2e/ports.ts'

// End-to-end tests: the real backend and the Vite dev server, with fake ASR/LLM
// services standing in for the remote servers (see e2e/stack.ts). Run with
// `npm run test:e2e`; needs ffmpeg, the backend requirements (see e2e/ports.ts
// for how the Python interpreter is found) and `npx playwright install chromium firefox`.
const CI = !!process.env.CI
const VIEWPORT = { width: 1280, height: 720 }

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  // No device presets: they replace the user agent with a Windows one, and the
  // recorder adapts to the real browser and OS (src/utils/platformDetect.ts).
  // Both browsers get fake media devices and no permission prompt.
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: VIEWPORT,
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
    {
      // Only the browser-dependent flows run in Firefox as well.
      name: 'firefox',
      testMatch: /recorder\.spec\.ts/,
      use: {
        browserName: 'firefox',
        viewport: VIEWPORT,
        launchOptions: {
          firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true },
        },
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/stack.ts',
      cwd: frontendDir,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: frontendDir,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      env: { VITE_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
