import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // These specs keep several WebGL/Rapier scenes alive. Capping workers avoids
  // browser GPU-context starvation that otherwise presents as a missing canvas.
  workers: 2,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
