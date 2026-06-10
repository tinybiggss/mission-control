import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { updateAdaptedStatus, readAdapted } from '$lib/server/adapted';
import { readDraft } from '$lib/server/drafts';
import { logApproval, logRejection } from '$lib/server/preference-log';
import type { AdaptedStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID: AdaptedStatus[] = ['pending-approval', 'approved', 'rejected', 'scheduled', 'published'];

export const POST: RequestHandler = async ({ params, request }) => {
  const { draftId, platform } = params;
  if (!draftId || !platform) throw error(400, 'Missing draftId or platform');

  let body: { status?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const newStatus = body.status;
  if (!newStatus || !VALID.includes(newStatus as AdaptedStatus)) {
    throw error(400, `Status must be one of: ${VALID.join(', ')}`);
  }

  const vaultRoot = getVaultRoot();
  try {
    await updateAdaptedStatus(vaultRoot, draftId, platform, newStatus as AdaptedStatus);
    const updated = await readAdapted(vaultRoot, draftId, platform);

    // Preference learning capture (spec §3.8). Only log the two decisions that
    // carry editorial signal — approve/reject. Revert-to-pending, schedule,
    // and publish are workflow moves, not editorial judgments.
    if (updated && (newStatus === 'approved' || newStatus === 'rejected')) {
      const draft = await readDraft(vaultRoot, draftId);
      if (draft) {
        try {
          if (newStatus === 'approved') {
            await logApproval(vaultRoot, draft, updated);
          } else {
            await logRejection(vaultRoot, draft, updated, (body.reason || '').trim());
          }
        } catch (logErr) {
          // Log failure is non-fatal — the primary mutation already succeeded.
          // Surface in server logs so we can catch the pattern.
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
