import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parseAdaptedFile, serializeFrontmatter } from './frontmatter';
import { adaptedDir } from './vault';
import type { AdaptedVersion, AdaptedStatus } from '$lib/types';

const VALID_STATUSES: AdaptedStatus[] = [
  'pending-approval',
  'approved',
  'rejected',
  'scheduled',
  'published'
];

/** List all adapted versions across all date/draft directories */
export async function listAllAdapted(vaultRoot: string): Promise<AdaptedVersion[]> {
  const root = adaptedDir(vaultRoot);
  if (!existsSync(root)) return [];

  const versions: AdaptedVersion[] = [];
  const dateDirs = await readdir(root, { withFileTypes: true });

  for (const dateEntry of dateDirs) {
    if (!dateEntry.isDirectory()) continue;
    const dateDir = join(root, dateEntry.name);
    const draftDirs = await readdir(dateDir, { withFileTypes: true });

    for (const draftEntry of draftDirs) {
      if (!draftEntry.isDirectory()) continue;
      const draftDir = join(dateDir, draftEntry.name);
      const files = await readdir(draftDir);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = join(draftDir, file);
        const content = await readFile(filePath, 'utf-8');
        try {
          versions.push(parseAdaptedFile(content, filePath));
        } catch (err) {
          // Skip versions with malformed frontmatter so one bad file doesn't block the queue.
          // Surface the problem so we can go fix the source.
          console.warn(`[adapted] skipping ${filePath}: ${(err as Error).message}`);
        }
      }
    }
  }

  return versions;
}

/** Find an adapted version by draftId + platform */
export async function readAdapted(
  vaultRoot: string,
  draftId: string,
  platform: string
): Promise<AdaptedVersion | null> {
  const all = await listAllAdapted(vaultRoot);
  return all.find((v) => v.draftId === draftId && v.platform === platform) ?? null;
}

/** Update only the status field in frontmatter */
export async function updateAdaptedStatus(
  vaultRoot: string,
  draftId: string,
  platform: string,
  newStatus: AdaptedStatus
): Promise<void> {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }

  const version = await readAdapted(vaultRoot, draftId, platform);
  if (!version) {
    throw new Error(`Adapted version not found: ${draftId}/${platform}`);
  }

  const raw = await readFile(version.filePath, 'utf-8');
  const parsed = matter(raw);
  // gray-matter caches parsed results by content; clone data before mutating so we don't
  // poison that cache entry (the cached object's `data` is shared across callers).
  const data = { ...parsed.data, status: newStatus };
  const output = serializeFrontmatter(data, parsed.content);
  await writeFile(version.filePath, output, 'utf-8');
}

/** Update body content and recompute character_count */
export async function updateAdaptedContent(
  vaultRoot: string,
  draftId: string,
  platform: string,
  newBody: string
): Promise<void> {
  const version = await readAdapted(vaultRoot, draftId, platform);
  if (!version) {
    throw new Error(`Adapted version not found: ${draftId}/${platform}`);
  }

  const raw = await readFile(version.filePath, 'utf-8');
  const parsed = matter(raw);
  const data = { ...parsed.data, character_count: newBody.trim().length };
  const output = serializeFrontmatter(data, newBody);
  await writeFile(version.filePath, output, 'utf-8');
}
