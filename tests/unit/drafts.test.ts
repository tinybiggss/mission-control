import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { listAllDrafts, readDraft } from '../../src/lib/server/drafts';

const FIXTURE_VAULT = resolve(__dirname, '../fixtures/vault');

describe('listAllDrafts', () => {
  it('returns all drafts across all date directories', async () => {
    const drafts = await listAllDrafts(FIXTURE_VAULT);
    expect(drafts).toHaveLength(2);
    const ids = drafts.map((d) => d.id).sort();
    expect(ids).toEqual(['draft-2026-04-15-001', 'draft-2026-04-15-002']);
  });

  it('returns empty array when no drafts exist', async () => {
    const drafts = await listAllDrafts('/nonexistent/path');
    expect(drafts).toEqual([]);
  });
});

describe('readDraft', () => {
  it('reads a specific draft by id', async () => {
    const draft = await readDraft(FIXTURE_VAULT, 'draft-2026-04-15-001');
    expect(draft).not.toBeNull();
    expect(draft!.id).toBe('draft-2026-04-15-001');
    expect(draft!.source_score).toBe(4.2);
  });

  it('returns null for missing draft id', async () => {
    const draft = await readDraft(FIXTURE_VAULT, 'draft-nonexistent');
    expect(draft).toBeNull();
  });
});
