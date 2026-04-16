import { describe, it, expect } from 'vitest';
import { groupAdaptedByDraft, filterGroups } from '../../src/lib/server/grouping';
import type { Draft, AdaptedVersion, DraftGroup } from '../../src/lib/types';

const DRAFT_1: Draft = {
  id: 'draft-001',
  filePath: '/fake/draft-001.md',
  status: 'draft',
  created: '2026-04-15',
  source_signal: 'Signal 1',
  source_signal_url: '',
  source_score: 4.0,
  pillar: 'Food',
  target_platforms: ['linkedin', 'x-twitter'],
  headline_formula: '',
  content_type: 'text-draft',
  visual_brief: '',
  video_brief: '',
  napkin_asset: '',
  gamma_asset: '',
  body: 'body'
};

const DRAFT_2: Draft = { ...DRAFT_1, id: 'draft-002', source_signal: 'Signal 2' };

const V_LI_1: AdaptedVersion = {
  id: 'draft-001/linkedin',
  draftId: 'draft-001',
  platform: 'linkedin',
  filePath: '/fake/linkedin.md',
  status: 'pending-approval',
  scheduled_date: '',
  character_count: 400,
  visual_required: false,
  visual_brief: '',
  subreddit: '',
  body: 'linkedin body'
};
const V_X_1: AdaptedVersion = { ...V_LI_1, id: 'draft-001/x-twitter', platform: 'x-twitter' };
const V_LI_2: AdaptedVersion = {
  ...V_LI_1,
  id: 'draft-002/linkedin',
  draftId: 'draft-002',
  status: 'approved'
};

describe('groupAdaptedByDraft', () => {
  it('groups versions under their parent drafts', () => {
    const groups = groupAdaptedByDraft([DRAFT_1, DRAFT_2], [V_LI_1, V_X_1, V_LI_2]);
    expect(groups).toHaveLength(2);

    const g1 = groups.find((g) => g.draft.id === 'draft-001');
    expect(g1).toBeDefined();
    expect(g1!.versions).toHaveLength(2);
    expect(g1!.versions.map((v) => v.platform).sort()).toEqual(['linkedin', 'x-twitter']);

    const g2 = groups.find((g) => g.draft.id === 'draft-002');
    expect(g2!.versions).toHaveLength(1);
  });

  it('returns empty versions array for drafts with no adapted versions', () => {
    const orphan: Draft = { ...DRAFT_1, id: 'draft-orphan' };
    const groups = groupAdaptedByDraft([orphan], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].versions).toEqual([]);
  });

  it('skips adapted versions whose draft is missing', () => {
    const orphanVersion: AdaptedVersion = { ...V_LI_1, draftId: 'draft-missing' };
    const groups = groupAdaptedByDraft([DRAFT_1], [V_LI_1, orphanVersion]);
    expect(groups).toHaveLength(1);
    expect(groups[0].versions).toHaveLength(1);
  });

  it('sorts groups by source_score descending', () => {
    const high: Draft = { ...DRAFT_1, id: 'draft-high', source_score: 5.0 };
    const low: Draft = { ...DRAFT_1, id: 'draft-low', source_score: 3.0 };
    const groups = groupAdaptedByDraft([low, high], []);
    expect(groups[0].draft.id).toBe('draft-high');
    expect(groups[1].draft.id).toBe('draft-low');
  });
});

describe('filterGroups', () => {
  const groups: DraftGroup[] = [
    { draft: DRAFT_1, versions: [V_LI_1, V_X_1] },
    { draft: DRAFT_2, versions: [V_LI_2] }
  ];

  it('returns all groups when status filter is "all"', () => {
    const result = filterGroups(groups, { status: 'all', platform: 'all' });
    expect(result).toHaveLength(2);
  });

  it('filters versions by status, removing groups left empty', () => {
    const result = filterGroups(groups, { status: 'approved', platform: 'all' });
    expect(result).toHaveLength(1);
    expect(result[0].draft.id).toBe('draft-002');
    expect(result[0].versions).toHaveLength(1);
  });

  it('filters versions by platform', () => {
    const result = filterGroups(groups, { status: 'all', platform: 'x-twitter' });
    expect(result).toHaveLength(1);
    expect(result[0].draft.id).toBe('draft-001');
    expect(result[0].versions).toHaveLength(1);
    expect(result[0].versions[0].platform).toBe('x-twitter');
  });

  it('combines status and platform filters', () => {
    const result = filterGroups(groups, { status: 'pending-approval', platform: 'linkedin' });
    expect(result).toHaveLength(1);
    expect(result[0].draft.id).toBe('draft-001');
    expect(result[0].versions).toHaveLength(1);
    expect(result[0].versions[0].platform).toBe('linkedin');
  });
});
