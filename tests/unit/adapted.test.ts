import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  listAllAdapted,
  readAdapted,
  updateAdaptedStatus,
  updateAdaptedContent
} from '../../src/lib/server/adapted';

const FIXTURE_VAULT = resolve(__dirname, '../fixtures/vault');
const TEST_FILE = resolve(
  FIXTURE_VAULT,
  'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-001/linkedin.md'
);

let originalContent: string;

beforeEach(async () => {
  originalContent = await readFile(TEST_FILE, 'utf-8');
});

afterEach(async () => {
  // Restore fixture after mutation tests
  await writeFile(TEST_FILE, originalContent, 'utf-8');
});

describe('listAllAdapted', () => {
  it('returns all adapted versions across all date/draft directories', async () => {
    const versions = await listAllAdapted(FIXTURE_VAULT);
    expect(versions).toHaveLength(5);
    const ids = versions.map((v) => v.id).sort();
    expect(ids).toEqual([
      'draft-2026-04-15-001/linkedin',
      'draft-2026-04-15-001/x-twitter',
      'draft-2026-04-15-002/bluesky',
      'draft-2026-04-15-002/linkedin',
      'draft-2026-04-15-002/threads'
    ]);
  });
});

describe('readAdapted', () => {
  it('reads a specific adapted version by draftId + platform', async () => {
    const version = await readAdapted(FIXTURE_VAULT, 'draft-2026-04-15-001', 'linkedin');
    expect(version).not.toBeNull();
    expect(version!.status).toBe('pending-approval');
    expect(version!.character_count).toBe(450);
  });

  it('returns null for missing combination', async () => {
    const version = await readAdapted(FIXTURE_VAULT, 'draft-999', 'linkedin');
    expect(version).toBeNull();
  });
});

describe('updateAdaptedStatus', () => {
  it('updates the status field and preserves body', async () => {
    await updateAdaptedStatus(FIXTURE_VAULT, 'draft-2026-04-15-001', 'linkedin', 'approved');
    const updated = await readAdapted(FIXTURE_VAULT, 'draft-2026-04-15-001', 'linkedin');
    expect(updated!.status).toBe('approved');
    expect(updated!.body.trim()).toBe('# Adapted for LinkedIn\n\nLinkedIn body.');
  });

  it('rejects invalid status values', async () => {
    await expect(
      updateAdaptedStatus(FIXTURE_VAULT, 'draft-2026-04-15-001', 'linkedin', 'bogus' as never)
    ).rejects.toThrow('Invalid status');
  });

  it('throws for missing file', async () => {
    await expect(
      updateAdaptedStatus(FIXTURE_VAULT, 'draft-999', 'linkedin', 'approved')
    ).rejects.toThrow('Adapted version not found');
  });
});

describe('updateAdaptedContent', () => {
  it('updates the body and recomputes character_count', async () => {
    await updateAdaptedContent(
      FIXTURE_VAULT,
      'draft-2026-04-15-001',
      'linkedin',
      '# New Headline\n\nCompletely new body content here.'
    );
    const updated = await readAdapted(FIXTURE_VAULT, 'draft-2026-04-15-001', 'linkedin');
    expect(updated!.body.trim()).toBe('# New Headline\n\nCompletely new body content here.');
    expect(updated!.character_count).toBe(49); // length of the new body
  });
});
