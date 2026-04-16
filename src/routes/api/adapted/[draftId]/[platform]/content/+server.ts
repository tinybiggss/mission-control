import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { updateAdaptedContent, readAdapted } from '$lib/server/adapted';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const { draftId, platform } = params;
  if (!draftId || !platform) throw error(400, 'Missing draftId or platform');

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (typeof body.content !== 'string') {
    throw error(400, 'content field must be a string');
  }

  try {
    await updateAdaptedContent(getVaultRoot(), draftId, platform, body.content);
    const updated = await readAdapted(getVaultRoot(), draftId, platform);
    return json({ ok: true, version: updated });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) throw error(404, msg);
    throw error(500, msg);
  }
};
