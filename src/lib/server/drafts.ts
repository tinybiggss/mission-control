import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseDraftFile } from './frontmatter';
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
      drafts.push(parseDraftFile(content, filePath));
    }
  }

  return drafts;
}

/** Read a specific draft by its id field */
export async function readDraft(vaultRoot: string, draftId: string): Promise<Draft | null> {
  const drafts = await listAllDrafts(vaultRoot);
  return drafts.find((d) => d.id === draftId) ?? null;
}
