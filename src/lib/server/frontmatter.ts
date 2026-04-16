import matter from 'gray-matter';
import type { Draft, AdaptedVersion } from '$lib/types';

/** Normalize target_platforms which may arrive as string or array */
export function normalizeTargetPlatforms(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line.slice(2).trim() : line))
    .filter(Boolean);
}

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
}

/**
 * gray-matter v4 has a buggy cache: the FIRST parse of malformed YAML throws,
 * but subsequent calls with the same content return { data: {}, content: original }
 * silently — defeating our try/catch-based skip logic. Detect this poisoned-cache
 * state by checking whether the frontmatter markers were actually stripped.
 */
function parseMatterStrict(content: string) {
  const parsed = matter(content);
  const stillHasFrontmatter = /^---\s*\r?\n/.test(parsed.content);
  if (stillHasFrontmatter) {
    throw new Error(
      'gray-matter returned the original content without stripping frontmatter — YAML likely failed to parse (cache-poisoned state)'
    );
  }
  return parsed;
}

export function parseDraftFile(content: string, filePath: string): Draft {
  const parsed = parseMatterStrict(content);
  const data = parsed.data as Record<string, unknown>;
  return {
    id: asString(data.id),
    filePath,
    status: (asString(data.status, 'draft') as Draft['status']),
    created: asString(data.created),
    source_signal: asString(data.source_signal),
    source_signal_url: asString(data.source_signal_url),
    source_score: asNumber(data.source_score),
    pillar: asString(data.pillar),
    target_platforms: normalizeTargetPlatforms(data.target_platforms),
    headline_formula: asString(data.headline_formula),
    content_type: (asString(data.content_type, 'text-draft') as Draft['content_type']),
    visual_brief: asString(data.visual_brief),
    video_brief: asString(data.video_brief),
    napkin_asset: asString(data.napkin_asset),
    gamma_asset: asString(data.gamma_asset),
    body: parsed.content
  };
}

export function parseAdaptedFile(content: string, filePath: string): AdaptedVersion {
  const parsed = parseMatterStrict(content);
  const data = parsed.data as Record<string, unknown>;
  const draftId = asString(data.source_draft);
  const platform = asString(data.platform);
  return {
    id: `${draftId}/${platform}`,
    draftId,
    platform,
    filePath,
    status: (asString(data.status, 'pending-approval') as AdaptedVersion['status']),
    scheduled_date: asString(data.scheduled_date),
    character_count: asNumber(data.character_count),
    visual_required: asBoolean(data.visual_required),
    visual_brief: asString(data.visual_brief),
    subreddit: asString(data.subreddit),
    body: parsed.content
  };
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, data);
}
