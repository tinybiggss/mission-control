import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = resolve(__dirname, 'tests/fixtures/vault');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // file writes need serial execution
  workers: 1,
  use: {
    baseURL: 'http://localhost:4322',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'pnpm dev --port 4322',
    port: 4322,
    reuseExistingServer: false,
    env: {
      VAULT_ROOT: FIXTURE_VAULT
    }
  }
});
