import { getVaultRoot } from '$lib/server/vault';
import { listAllDrafts } from '$lib/server/drafts';
import { listAllAdapted } from '$lib/server/adapted';
import type { PageServerLoad } from './$types';

export interface CalendarEvent {
  draftId: string;
  platform: string;
  status: 'scheduled' | 'published';
  scheduled_date: string;
  source_signal: string;
  pillar: string;
  character_count: number;
}

export const load: PageServerLoad = async () => {
  const vaultRoot = getVaultRoot();
  const [drafts, versions] = await Promise.all([
    listAllDrafts(vaultRoot),
    listAllAdapted(vaultRoot)
  ]);

  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const events: CalendarEvent[] = versions
    .filter(
      (v) =>
        (v.status === 'scheduled' || v.status === 'published') &&
        !!v.scheduled_date &&
        draftById.has(v.draftId)
    )
    .map((v) => {
      const d = draftById.get(v.draftId)!;
      return {
        draftId: v.draftId,
        platform: v.platform,
        status: v.status as 'scheduled' | 'published',
        scheduled_date: v.scheduled_date,
        source_signal: d.source_signal,
        pillar: d.pillar,
        character_count: v.character_count
      };
    });

  return { events };
};
