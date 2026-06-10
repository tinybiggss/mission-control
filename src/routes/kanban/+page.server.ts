import { getVaultRoot } from '$lib/server/vault';
import { listAllDrafts } from '$lib/server/drafts';
import { listAllAdapted } from '$lib/server/adapted';
import type { PageServerLoad } from './$types';

/**
 * Kanban consumes a flat list of adapted versions. Drafts are loaded too so we
 * can attach source_signal/pillar context onto each card.
 */
export const load: PageServerLoad = async () => {
  const vaultRoot = getVaultRoot();
  const [drafts, versions] = await Promise.all([
    listAllDrafts(vaultRoot),
    listAllAdapted(vaultRoot)
  ]);

  const draftById = new Map(drafts.map((d) => [d.id, d]));
  // Enrich each version with the parent draft's display fields so the card can
  // render without a second lookup.
  const cards = versions
    .filter((v) => draftById.has(v.draftId))
    .map((v) => {
      const d = draftById.get(v.draftId)!;
      return {
        draftId: v.draftId,
        platform: v.platform,
        status: v.status,
        scheduled_date: v.scheduled_date,
        character_count: v.character_count,
        source_signal: d.source_signal,
        pillar: d.pillar,
        source_score: d.source_score
      };
    });

  return { cards };
};
