import { join } from 'node:path';
import { env } from '$env/dynamic/private';

export function getVaultRoot(): string {
  // $env/dynamic/private falls back to process.env when SvelteKit's runtime env isn't populated.
  // This makes the function work both under `pnpm dev` (reads .env) and in Playwright/Node contexts.
  const root = env.VAULT_ROOT || process.env.VAULT_ROOT;
  if (!root) {
    throw new Error('VAULT_ROOT environment variable is not set');
  }
  return root;
}

export function draftsDir(vaultRoot: string): string {
  return join(vaultRoot, 'Resilient Tomorrow', 'Content Drafts');
}

export function adaptedDir(vaultRoot: string): string {
  return join(vaultRoot, 'Resilient Tomorrow', 'Content Adapted');
}
