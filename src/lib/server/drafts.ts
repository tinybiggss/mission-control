import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parseDraftFile, serializeFrontmatter } from './frontmatter';
import { draftsDir } from './vault';
import type { Draft } from '$lib/types';

/** List all draft files across all date directories */
export async function listAllDrafts(vaultRoot: string): Promise<Draft[]> {
  const dir = draftsDir(vaultRoot);
  if (!existsSync(dir)) return [];

  const dateDirs = await readdir(dir, { withFileTypes: true });
  const drafts: Draft[] = [];

  for (const entry of dateDirs) {
    if (!entry.isDirectory()) continue;
    const dateDir = join(dir, entry.name);
    const files = await readdir(dateDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(dateDir, file);
      const content = await readFile(filePath, 'utf-8');
      try {
        drafts.push(parseDraftFile(content, filePath));
      } catch (err) {
        // Skip drafts with malformed frontmatter so one bad file doesn't block the queue.
        // Surface the problem so we can go fix the source.
        console.warn(`[drafts] skipping ${filePath}: ${(err as Error).message}`);
      }
    }
  }

  return drafts;
}

/** Read a specific draft by its id field */
export async function readDraft(vaultRoot: string, draftId: string): Promise<Draft | null> {
  const drafts = await listAllDrafts(vaultRoot);
  return drafts.find((d) => d.id === draftId) ?? null;
}

/** Persist a Discord thread URL into the draft's frontmatter */
export async function setDraftDiscussionUrl(
  vaultRoot: string,
  draftId: string,
  threadUrl: string
): Promise<void> {
  const draft = await readDraft(vaultRoot, draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);

  const raw = await readFile(draft.filePath, 'utf-8');
  const parsed = matter(raw);
  // Clone data to avoid poisoning gray-matter's internal cache.
  const data = { ...parsed.data, discord_thread_url: threadUrl };
  const output = serializeFrontmatter(data, parsed.content);
  await writeFile(draft.filePath, output, 'utf-8');
}
