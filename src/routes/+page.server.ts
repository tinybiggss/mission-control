import { getVaultRoot } from '$lib/server/vault';
import { listAllDrafts } from '$lib/server/drafts';
import { listAllAdapted } from '$lib/server/adapted';
import { groupAdaptedByDraft } from '$lib/grouping';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const vaultRoot = getVaultRoot();
  const [drafts, versions] = await Promise.all([
    listAllDrafts(vaultRoot),
    listAllAdapted(vaultRoot)
  ]);
  const groups = groupAdaptedByDraft(drafts, versions);

  // Compute filter aggregates
  const allVersions = groups.flatMap((g) => g.versions);
  const counts = {
    all: allVersions.length,
    pending: allVersions.filter((v) => v.status === 'pending-approval').length,
    approved: allVersions.filter((v) => v.status === 'approved').length,
    rejected: allVersions.filter((v) => v.status === 'rejected').length
  };
  const platforms = Array.from(new Set(allVersions.map((v) => v.platform))).sort();
  const pillars = Array.from(new Set(groups.map((g) => g.draft.pillar).filter(Boolean))).sort();
  const scores = groups.map((g) => g.draft.source_score).filter(Number.isFinite);
  const scoreBounds = {
    min: scores.length ? Math.floor(Math.min(...scores) * 10) / 10 : 0,
    max: scores.length ? Math.ceil(Math.max(...scores) * 10) / 10 : 10
  };

  return { groups, counts, platforms, pillars, scoreBounds };
};
