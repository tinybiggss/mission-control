import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { updateAdaptedStatus, readAdapted } from '$lib/server/adapted';
import type { AdaptedStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID: AdaptedStatus[] = ['pending-approval', 'approved', 'rejected', 'scheduled', 'published'];

export const POST: RequestHandler = async ({ params, request }) => {
  const { draftId, platform } = params;
  if (!draftId || !platform) throw error(400, 'Missing draftId or platform');

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const newStatus = body.status;
  if (!newStatus || !VALID.includes(newStatus as AdaptedStatus)) {
    throw error(400, `Status must be one of: ${VALID.join(', ')}`);
  }

  try {
    await updateAdaptedStatus(getVaultRoot(), draftId, platform, newStatus as AdaptedStatus);
    const updated = await readAdapted(getVaultRoot(), draftId, platform);
    return json({ ok: true, version: updated });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) throw error(404, msg);
    throw error(500, msg);
  }
};
