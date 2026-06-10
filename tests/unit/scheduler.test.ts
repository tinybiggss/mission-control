import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScheduler } from '../../src/lib/server/scheduler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = resolve(__dirname, '../fixtures/vault');

// Fixtures we'll mutate — save/restore per test
const LINKEDIN_001 = resolve(FIXTURE_VAULT, 'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-001/linkedin.md');
const XTWITTER_001 = resolve(FIXTURE_VAULT, 'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-001/x-twitter.md');
const LINKEDIN_002 = resolve(FIXTURE_VAULT, 'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/linkedin.md');
const BLUESKY_002  = resolve(FIXTURE_VAULT, 'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/bluesky.md');
const THREADS_002  = resolve(FIXTURE_VAULT, 'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/threads.md');

let savedContent: Map<string, string>;

async function readAll() {
  const paths = [LINKEDIN_001, XTWITTER_001, LINKEDIN_002, BLUESKY_002, THREADS_002];
  const map = new Map<string, string>();
  for (const p of paths) {
    map.set(p, await readFile(p, 'utf-8'));
  }
  return map;
}

beforeEach(async () => {
  savedContent = await readAll();
});

afterEach(async () => {
  // Restore all fixtures
  for (const [path, content] of savedContent) {
    await writeFile(path, content, 'utf-8');
  }
});

/** Reset a single fixture to status: approved with no scheduled_date */
async function setApproved(filePath: string) {
  const raw = savedContent.get(filePath)!;
  // Replace status line
  const updated = raw
    .replace(/^status:.*$/m, 'status: approved')
    .replace(/^scheduled_date:.*$/m, 'scheduled_date: ""');
  await writeFile(filePath, updated, 'utf-8');
}

describe('runScheduler', () => {
  it('schedules approved linkedin version and writes status: scheduled', async () => {
    await setApproved(LINKEDIN_002);

    const result = await runScheduler(FIXTURE_VAULT);

    const liResult = result.scheduled.find(
      (s) => s.draftId === 'draft-2026-04-15-002' && s.platform === 'linkedin'
    );
    expect(liResult).toBeDefined();
    expect(liResult!.scheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const written = await readFile(LINKEDIN_002, 'utf-8');
    expect(written).toMatch(/status:\s*scheduled/);
    expect(written).toMatch(/scheduled_date:\s*['"]?\d{4}-\d{2}-\d{2}['"]?/);
  });

  it('does not re-schedule versions that are already scheduled', async () => {
    // BLUESKY_002 is already scheduled in fixture (2026-04-20)
    const result = await runScheduler(FIXTURE_VAULT);
    const blueskyResult = result.scheduled.find(
      (s) => s.draftId === 'draft-2026-04-15-002' && s.platform === 'bluesky'
    );
    expect(blueskyResult).toBeUndefined();
  });

  it('skips pending-approval versions', async () => {
    // LINKEDIN_001 is pending-approval by default
    const result = await runScheduler(FIXTURE_VAULT);
    const found = result.scheduled.find(
      (s) => s.draftId === 'draft-2026-04-15-001' && s.platform === 'linkedin'
    );
    expect(found).toBeUndefined();
  });

  it('schedules multiple approved versions on different dates respecting minGap', async () => {
    await setApproved(BLUESKY_002);
    // Also make a second bluesky candidate by temporarily writing an extra approved file
    const extraPath = resolve(FIXTURE_VAULT, 'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-001/bluesky.md');
    const extraContent = (await readFile(XTWITTER_001, 'utf-8'))
      .replace(/platform:\s*x-twitter/, 'platform: bluesky')
      .replace(/id:\s*draft-2026-04-15-001\/x-twitter/, 'id: draft-2026-04-15-001/bluesky')
      .replace(/^status:.*$/m, 'status: approved')
      .replace(/^scheduled_date:.*$/m, 'scheduled_date: ""');
    await writeFile(extraPath, extraContent, 'utf-8');

    try {
      const result = await runScheduler(FIXTURE_VAULT);
      const blueskies = result.scheduled.filter((s) => s.platform === 'bluesky');
      expect(blueskies.length).toBeGreaterThanOrEqual(2);

      // Dates must differ by at least 2 days (bluesky minGapDays)
      const dates = blueskies.map((s) => s.scheduledDate).sort();
      const d0 = new Date(dates[0]);
      const d1 = new Date(dates[1]);
      const gap = Math.round((d1.getTime() - d0.getTime()) / 86_400_000);
      expect(gap).toBeGreaterThanOrEqual(2);
    } finally {
      // Clean up extra file
      const { unlink } = await import('node:fs/promises');
      if (existsSync(extraPath)) await unlink(extraPath);
    }
  });

  it('returns a platformSummary with scheduled count', async () => {
    await setApproved(LINKEDIN_002);
    const result = await runScheduler(FIXTURE_VAULT);
    expect(result.platformSummary.linkedin).toBeDefined();
    expect(result.platformSummary.linkedin.scheduled).toBeGreaterThanOrEqual(1);
  });

  it('result has a valid ISO timestamp', async () => {
    const result = await runScheduler(FIXTURE_VAULT);
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
