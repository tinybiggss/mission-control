import type { Draft, AdaptedVersion, DraftGroup, FilterState } from '$lib/types';

export function groupAdaptedByDraft(
  drafts: Draft[],
  versions: AdaptedVersion[]
): DraftGroup[] {
  const byDraftId = new Map<string, AdaptedVersion[]>();
  for (const v of versions) {
    if (!byDraftId.has(v.draftId)) byDraftId.set(v.draftId, []);
    byDraftId.get(v.draftId)!.push(v);
  }

  const groups: DraftGroup[] = drafts.map((draft) => ({
    draft,
    versions: byDraftId.get(draft.id) ?? []
  }));

  groups.sort((a, b) => b.draft.source_score - a.draft.source_score);
  return groups;
}

export function filterGroups(groups: DraftGroup[], filter: FilterState): DraftGroup[] {
  return groups
    .filter((g) => {
      const pillarMatch = filter.pillar === 'all' || g.draft.pillar === filter.pillar;
      const scoreMin = filter.scoreMin ?? -Infinity;
      const scoreMax = filter.scoreMax ?? Infinity;
      const scoreMatch = g.draft.source_score >= scoreMin && g.draft.source_score <= scoreMax;
      return pillarMatch && scoreMatch;
    })
    .map((g) => {
      const filtered = g.versions.filter((v) => {
        const statusMatch = filter.status === 'all' || v.status === filter.status;
        const platformMatch = filter.platform === 'all' || v.platform === filter.platform;
        return statusMatch && platformMatch;
      });
      return { draft: g.draft, versions: filtered };
    })
    .filter((g) => g.versions.length > 0);
}
