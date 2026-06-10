import { writeFile, readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { listAllAdapted } from './adapted';
import { listAllDrafts } from './drafts';
import { serializeFrontmatter } from './frontmatter';
import { loadCadenceConfig } from './cadence-config';
import type { AdaptedVersion, Draft } from '$lib/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScheduledItem {
  draftId: string;
  platform: string;
  scheduledDate: string;
  pillar: string;
  source_signal: string;
  contentType: string;
}

export interface SkippedItem {
  draftId: string;
  platform: string;
  reason: string;
}

export interface ScheduleRunResult {
  timestamp: string;
  scheduled: ScheduledItem[];
  skipped: SkippedItem[];
  platformSummary: Record<string, { scheduled: number; nextSlot: string | null }>;
}

// ---------------------------------------------------------------------------
// Date helpers (pure, no Date mutation side-effects)
// ---------------------------------------------------------------------------

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

function todayIso(): string {
  return toIso(new Date());
}

// ---------------------------------------------------------------------------
// Variety scoring
// ---------------------------------------------------------------------------

interface ContentMeta {
  pillar: string;
  contentType: string;
}

/**
 * Score a candidate for variety relative to the last-assigned item on this
 * platform. Lower score = less desirable (more repetition).
 */
function varietyScore(candidate: ContentMeta, last: ContentMeta | null): number {
  if (!last) return 0;
  let score = 0;
  if (candidate.pillar === last.pillar) score -= 1;
  if (candidate.contentType === last.contentType) score -= 1;
  return score;
}

/**
 * Sort candidates to maximise content variety. Mutates ordering only — never
 * picks one; the caller iterates the returned array in order.
 */
function sortByVariety(
  candidates: Array<AdaptedVersion & { draft: Draft }>,
  last: ContentMeta | null
): Array<AdaptedVersion & { draft: Draft }> {
  return [...candidates].sort((a, b) => {
    const sa = varietyScore({ pillar: a.draft.pillar, contentType: a.draft.content_type }, last);
    const sb = varietyScore({ pillar: b.draft.pillar, contentType: b.draft.content_type }, last);
    // Higher score first; break ties by source_score descending
    if (sb !== sa) return sb - sa;
    return b.draft.source_score - a.draft.source_score;
  });
}

// ---------------------------------------------------------------------------
// Slot finder
// ---------------------------------------------------------------------------

/**
 * Find the next date >= startIso that is not in occupiedDates and satisfies
 * minGapDays from the most recent date in occupiedDates that precedes it.
 * Returns null if no slot is found within maxLookaheadDays of today.
 */
function findNextSlot(
  startIso: string,
  occupiedDates: Set<string>,
  minGapDays: number,
  maxLookaheadDays: number
): string | null {
  const cutoff = addDays(todayIso(), maxLookaheadDays);
  let candidate = startIso;

  while (candidate <= cutoff) {
    if (!occupiedDates.has(candidate)) {
      // Check min gap: no occupied date within minGapDays before this candidate
      let gapOk = true;
      for (let i = 1; i < minGapDays; i++) {
        const prior = addDays(candidate, -i);
        if (occupiedDates.has(prior)) {
          gapOk = false;
          break;
        }
      }
      if (gapOk) return candidate;
    }
    candidate = addDays(candidate, 1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core scheduler
// ---------------------------------------------------------------------------

export async function runScheduler(vaultRoot: string): Promise<ScheduleRunResult> {
  const [drafts, versions, PLATFORM_RULES] = await Promise.all([
    listAllDrafts(vaultRoot),
    listAllAdapted(vaultRoot),
    loadCadenceConfig()
  ]);

  const draftById = new Map(drafts.map((d) => [d.id, d]));

  // Enrich versions with their parent draft
  const enriched = versions
    .filter((v) => draftById.has(v.draftId))
    .map((v) => ({ ...v, draft: draftById.get(v.draftId)! }));

  const scheduled: ScheduledItem[] = [];
  const skipped: SkippedItem[] = [];
  const platformSummary: ScheduleRunResult['platformSummary'] = {};
  const today = todayIso();
  const tomorrow = addDays(today, 1);

  for (const [platform, rule] of Object.entries(PLATFORM_RULES)) {
    const platformVersions = enriched.filter((v) => v.platform === platform);

    // Build occupied set from already-scheduled and published versions
    const occupiedDates = new Set(
      platformVersions
        .filter((v) => (v.status === 'scheduled' || v.status === 'published') && v.scheduled_date)
        .map((v) => v.scheduled_date)
    );

    // Build scheduling context: last assigned meta for variety scoring
    // Seed from the most recently scheduled item on this platform
    const recentScheduled = platformVersions
      .filter((v) => v.status === 'scheduled' && v.scheduled_date)
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));

    let lastAssigned: ContentMeta | null =
      recentScheduled.length > 0
        ? { pillar: recentScheduled[0].draft.pillar, contentType: recentScheduled[0].draft.content_type }
        : null;

    // Start from tomorrow or the day after the latest scheduled date, whichever is later
    const latestScheduled = recentScheduled[0]?.scheduled_date ?? today;
    const horizon = latestScheduled >= today ? addDays(latestScheduled, 1) : tomorrow;

    // Candidates: approved versions for this platform
    const candidates = platformVersions.filter((v) => v.status === 'approved');

    let nextSlotStart = horizon;
    let assignedCount = 0;

    while (candidates.length > 0) {
      const sorted = sortByVariety(candidates, lastAssigned);
      const pick = sorted[0];

      const slot = findNextSlot(nextSlotStart, occupiedDates, rule.minGapDays, rule.maxLookaheadDays);
      if (!slot) {
        // No more room in lookahead window — skip remaining
        for (const c of candidates) {
          skipped.push({ draftId: c.draftId, platform, reason: 'No slot in lookahead window' });
        }
        break;
      }

      // Assign
      await writeScheduledDate(pick.filePath, slot);
      occupiedDates.add(slot);
      lastAssigned = { pillar: pick.draft.pillar, contentType: pick.draft.content_type };
      nextSlotStart = addDays(slot, rule.minGapDays);
      assignedCount++;

      scheduled.push({
        draftId: pick.draftId,
        platform,
        scheduledDate: slot,
        pillar: pick.draft.pillar,
        source_signal: pick.draft.source_signal,
        contentType: pick.draft.content_type
      });

      // Remove pick from candidates
      candidates.splice(candidates.indexOf(pick), 1);
    }

    // Compute next open slot for summary (peek only — don't assign)
    const nextSlot = findNextSlot(nextSlotStart, occupiedDates, rule.minGapDays, rule.maxLookaheadDays);
    platformSummary[platform] = { scheduled: assignedCount, nextSlot };
  }

  return { timestamp: new Date().toISOString(), scheduled, skipped, platformSummary };
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

async function writeScheduledDate(filePath: string, date: string): Promise<void> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  const data = { ...parsed.data, scheduled_date: date, status: 'scheduled' };
  const output = serializeFrontmatter(data, parsed.content);
  await writeFile(filePath, output, 'utf-8');
}
