import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { runScheduler } from '$lib/server/scheduler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  try {
    const result = await runScheduler(getVaultRoot());
    return json(result);
  } catch (err) {
    throw error(500, (err as Error).message);
  }
};
