import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { runPublisher } from '$lib/server/publisher';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let date: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.date === 'string') date = body.date;
  } catch { /* no body — use today */ }

  try {
    const result = await runPublisher(getVaultRoot(), date);
    return json(result);
  } catch (err) {
    throw error(500, (err as Error).message);
  }
};
