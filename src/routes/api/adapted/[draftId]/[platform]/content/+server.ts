import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { updateAdaptedContent, readAdapted } from '$lib/server/adapted';
import { readDraft } from '$lib/server/drafts';
import { logEdit } from '$lib/server/preference-log';
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

  const vaultRoot = getVaultRoot();
  try {
    // Capture the pre-edit body so the preference log can record before/after.
    const before = await readAdapted(vaultRoot, draftId, platform);
    const bodyBefore = before?.body ?? '';

    await updateAdaptedContent(vaultRoot, draftId, platform, body.content);
    const updated = await readAdapted(vaultRoot, draftId, platform);

    if (updated && before) {
      const draft = await readDraft(vaultRoot, draftId);
      if (draft) {
        try {
          await logEdit(vaultRoot, draft, updated, bodyBefore, updated.body);
        } catch (logErr) {
          console.warn(`[preference-log] failed to append: ${(logErr as Error).message}`);
        }
      }
    }

    return json({ ok: true, version: updated });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) throw error(404, msg);
    throw error(500, msg);
  }
};
