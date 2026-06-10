import { readFile, writeFile } from 'node:fs/promises';

export interface PlatformRule {
  minGapDays: number;
  maxLookaheadDays: number;
}

export type CadenceConfig = Record<string, PlatformRule>;

const CONFIG_PATH = '/Users/michaeljones/Dev/corvus-dashboard/schedule-cadence.json';

const DEFAULT_CONFIG: CadenceConfig = {
  linkedin: { minGapDays: 7, maxLookaheadDays: 28 },
  'x-twitter': { minGapDays: 2, maxLookaheadDays: 28 },
  bluesky: { minGapDays: 2, maxLookaheadDays: 28 },
  'substack-notes': { minGapDays: 2, maxLookaheadDays: 28 },
  threads: { minGapDays: 3, maxLookaheadDays: 28 }
};

export async function loadCadenceConfig(): Promise<CadenceConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CadenceConfig;
    // Merge with defaults so new platforms always have values
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveCadenceConfig(config: CadenceConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
