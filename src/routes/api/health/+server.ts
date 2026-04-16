import { json } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { existsSync } from 'node:fs';

export async function GET() {
  try {
    const vaultRoot = getVaultRoot();
    const vaultReachable = existsSync(vaultRoot);
    return json({
      status: vaultReachable ? 'ok' : 'degraded',
      vaultRoot,
      vaultReachable,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return json(
      { status: 'error', message: (err as Error).message },
      { status: 500 }
    );
  }
}
