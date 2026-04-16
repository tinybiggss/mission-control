import { join } from 'node:path';

export function getVaultRoot(): string {
  const root = process.env.VAULT_ROOT;
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
