const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox'],
    },
    // Authentication tokens and passwords must not enter test artifacts.
    trace: 'off', screenshot: 'off', video: 'off',
  },
  webServer: {
    command: 'node src/server.js',
    env: { PORT: '4200' },
    url: 'http://127.0.0.1:4200/api/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
