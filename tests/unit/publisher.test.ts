import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = resolve(__dirname, '../fixtures/vault');

const BLUESKY_FIXTURE = resolve(
  FIXTURE_VAULT,
  'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/bluesky.md'
);

// ---------------------------------------------------------------------------
// Mock fetch so we never hit real Bluesky API in tests
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockBskySuccess() {
  mockFetch
    // createSession
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessJwt: 'test-jwt', did: 'did:plc:testdid' })
    })
    // createRecord
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ uri: 'at://did:plc:testdid/app.bsky.feed.post/abc123', cid: 'cid123' })
    });
}

function mockBskyAuthFailure() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    text: async () => 'Invalid identifier or password'
  });
}

// ---------------------------------------------------------------------------
// Mock secrets so tests don't depend on ~/.openclaw existing
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/server/secrets.ts', () => ({
  getBlueskyCredentials: async () => ({
    handle: 'test.bsky.social',
    appPassword: 'test-app-password'
  })
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let originalContent: string;

beforeEach(async () => {
  originalContent = await readFile(BLUESKY_FIXTURE, 'utf-8');
  mockFetch.mockReset();
});

afterEach(async () => {
  await writeFile(BLUESKY_FIXTURE, originalContent, 'utf-8');
});

// Set bluesky fixture to scheduled for today
async function setScheduledToday(filePath: string) {
  const today = new Date().toISOString().slice(0, 10);
  const updated = originalContent
    .replace(/^status:.*$/m, 'status: scheduled')
    .replace(/^scheduled_date:.*$/m, `scheduled_date: '${today}'`);
  await writeFile(filePath, updated, 'utf-8');
}

describe('runPublisher', () => {
  it('publishes a scheduled bluesky post and marks it published', async () => {
    await setScheduledToday(BLUESKY_FIXTURE);
    mockBskySuccess();

    const { runPublisher } = await import('../../src/lib/server/publisher');
    const result = await runPublisher(FIXTURE_VAULT);

    expect(result.published).toHaveLength(1);
    expect(result.published[0].platform).toBe('bluesky');
    expect(result.published[0].postId).toContain('at://');
    expect(result.failed).toHaveLength(0);

    const written = await readFile(BLUESKY_FIXTURE, 'utf-8');
    expect(written).toMatch(/status:\s*published/);
    expect(written).toMatch(/published_date:/);
    expect(written).toMatch(/platform_post_id:/);
  });

  it('marks post as publish-failed when Bluesky auth fails', async () => {
    await setScheduledToday(BLUESKY_FIXTURE);
    mockBskyAuthFailure();

    const { runPublisher } = await import('../../src/lib/server/publisher');
    const result = await runPublisher(FIXTURE_VAULT);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].platform).toBe('bluesky');
    expect(result.published).toHaveLength(0);

    const written = await readFile(BLUESKY_FIXTURE, 'utf-8');
    expect(written).toMatch(/status:\s*publish-failed/);
    expect(written).toMatch(/publish_error:/);
  });

  it('skips posts not scheduled for today', async () => {
    // Fixture has scheduled_date: 2026-04-20 — not today
    const { runPublisher } = await import('../../src/lib/server/publisher');
    const result = await runPublisher(FIXTURE_VAULT);

    expect(result.published).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips unsupported platforms without calling fetch', async () => {
    const THREADS_FIXTURE = resolve(
      FIXTURE_VAULT,
      'Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/threads.md'
    );
    const originalThreads = await readFile(THREADS_FIXTURE, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const updated = originalThreads
      .replace(/^status:.*$/m, 'status: scheduled')
      .replace(/^scheduled_date:.*$/m, `scheduled_date: '${today}'`);
    await writeFile(THREADS_FIXTURE, updated, 'utf-8');

    try {
      const { runPublisher } = await import('../../src/lib/server/publisher');
      const result = await runPublisher(FIXTURE_VAULT);
      const threadsSkip = result.skipped.find((s) => s.platform === 'threads');
      expect(threadsSkip).toBeDefined();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      await writeFile(THREADS_FIXTURE, originalThreads, 'utf-8');
    }
  });

  it('result has a valid ISO timestamp and date', async () => {
    const { runPublisher } = await import('../../src/lib/server/publisher');
    const result = await runPublisher(FIXTURE_VAULT);
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
