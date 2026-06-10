import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Draft, AdaptedVersion } from '$lib/types';

/**
 * Append-only decision log consumed by the Optimizer (spec §3.8 Preference
 * Learning System). Writes one JSON line per decision. Dumb writer / smart
 * reader — no diffing or aggregation here; store the raw bodies and let the
 * Optimizer distill.
 */

const LOG_REL_PATH = 'Resilient Tomorrow/Analytics/Preferences/approval-log.jsonl';

interface BaseEntry {
  ts: string;
  draftId: string;
  platform: string;
  pillar: string;
  headline_formula: string;
  content_type: string;
  character_count: number;
}

export type ApproveEntry = BaseEntry & { action: 'approve' };
export type RejectEntry = BaseEntry & { action: 'reject'; reason: string };
export type EditEntry = BaseEntry & { action: 'edit'; bodyBefore: string; bodyAfter: string };

export type DecisionEntry = ApproveEntry | RejectEntry | EditEntry;

function logPath(vaultRoot: string): string {
  return join(vaultRoot, LOG_REL_PATH);
}

/** Build a BaseEntry from the draft + adapted version */
function baseEntry(draft: Draft, version: AdaptedVersion): BaseEntry {
  return {
    ts: new Date().toISOString(),
    draftId: draft.id,
    platform: version.platform,
    pillar: draft.pillar,
    headline_formula: draft.headline_formula,
    content_type: draft.content_type,
    character_count: version.character_count
  };
}

/**
 * Append a single decision. Errors are surfaced to the caller (the API routes)
 * but should NOT block the primary mutation — callers handle this by logging
 * only AFTER the content update succeeds.
 */
export async function appendDecision(vaultRoot: string, entry: DecisionEntry): Promise<void> {
  const path = logPath(vaultRoot);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf-8');
}

export async function logApproval(
  vaultRoot: string,
  draft: Draft,
  version: AdaptedVersion
): Promise<void> {
  await appendDecision(vaultRoot, { ...baseEntry(draft, version), action: 'approve' });
}

export async function logRejection(
  vaultRoot: string,
  draft: Draft,
  version: AdaptedVersion,
  reason: string
): Promise<void> {
  await appendDecision(vaultRoot, { ...baseEntry(draft, version), action: 'reject', reason });
}

export async function logEdit(
  vaultRoot: string,
  draft: Draft,
  version: AdaptedVersion,
  bodyBefore: string,
  bodyAfter: string
): Promise<void> {
  // Skip logging no-op edits — the inline editor fires save even if the user
  // didn't actually change anything.
  if (bodyBefore === bodyAfter) return;
  await appendDecision(vaultRoot, {
    ...baseEntry(draft, version),
    action: 'edit',
    bodyBefore,
    bodyAfter
  });
}
