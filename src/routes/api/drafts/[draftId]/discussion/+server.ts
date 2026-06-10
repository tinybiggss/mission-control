import { json, error } from '@sveltejs/kit';
import { getVaultRoot } from '$lib/server/vault';
import { readDraft, setDraftDiscussionUrl } from '$lib/server/drafts';
import { createThread } from '$lib/server/discord';
import type { RequestHandler } from './$types';

/**
 * Idempotent: if the draft already has a discord_thread_url, returns it without
 * touching Discord. Otherwise creates a new public thread in #rt-content, persists
 * the URL into the draft's frontmatter, and returns it.
 */
export const POST: RequestHandler = async ({ params }) => {
  const { draftId } = params;
  if (!draftId) throw error(400, 'Missing draftId');

  const vaultRoot = getVaultRoot();
  const draft = await readDraft(vaultRoot, draftId);
  if (!draft) throw error(404, `Draft not found: ${draftId}`);

  // Idempotent short-circuit
  if (draft.discord_thread_url) {
    return json({ ok: true, threadUrl: draft.discord_thread_url, created: false });
  }

  // Thread name: "Draft: <source signal>" — source_signal is the headline-ish
  // summary the skill records, which matches the spec's "named after the draft".
  const threadName = `Draft: ${draft.source_signal || draft.id}`;

  try {
    const { threadUrl } = await createThread(threadName);
    await setDraftDiscussionUrl(vaultRoot, draftId, threadUrl);
    return json({ ok: true, threadUrl, created: true });
  } catch (err) {
    throw error(500, (err as Error).message);
  }
};
