import { getVaultRoot } from '$lib/server/vault';
import { listAllDrafts } from '$lib/server/drafts';
import { listAllAdapted } from '$lib/server/adapted';
import { groupAdaptedByDraft } from '$lib/server/grouping';
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

  return { groups, counts, platforms };
};
