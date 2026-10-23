// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4174;

module.exports = defineConfig({
  testDir: './specs',
  timeout: 90000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'block'
  },
  projects: [
    { name: 'desktop', testIgnore: /ipad\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    // Safari's engine at iPad size (specs/ipad.spec.js). Needs `npx playwright install webkit`.
    { name: 'ipad-landscape', testMatch: /ipad\.spec\.js/, use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'ipad-portrait', testMatch: /ipad\.spec\.js/, use: { ...devices['iPad Pro 11'] } }
  ],
  webServer: {
    command: 'node serve.js',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI
  }
});
