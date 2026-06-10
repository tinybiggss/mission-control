import { getVaultRoot } from '$lib/server/vault';
import { listAllAdapted } from '$lib/server/adapted';
import { loadCadenceConfig, saveCadenceConfig } from '$lib/server/cadence-config';
import type { CadenceConfig } from '$lib/server/cadence-config';
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';

export interface PlatformSummary {
  platform: string;
  minGapDays: number;
  maxLookaheadDays: number;
  scheduledCount: number;
  nextAvailableSlot: string | null;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  const ry = date.getFullYear();
  const rm = String(date.getMonth() + 1).padStart(2, '0');
  const rd = String(date.getDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

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
      let gapOk = true;
      for (let i = 1; i < minGapDays; i++) {
        if (occupiedDates.has(addDays(candidate, -i))) {
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

export const load: PageServerLoad = async () => {
  const vaultRoot = getVaultRoot();
  const [config, versions] = await Promise.all([
    loadCadenceConfig(),
    listAllAdapted(vaultRoot)
  ]);

  const today = todayIso();
  const tomorrow = addDays(today, 1);

  const summaries: PlatformSummary[] = Object.entries(config).map(([platform, rule]) => {
    const platformVersions = versions.filter((v) => v.platform === platform);

    const scheduledVersions = platformVersions.filter(
      (v) => (v.status === 'scheduled' || v.status === 'published') && v.scheduled_date
    );
    const occupiedDates = new Set(scheduledVersions.map((v) => v.scheduled_date));

    const futureScheduled = scheduledVersions.filter((v) => v.scheduled_date >= today);

    const latestDate = scheduledVersions
      .map((v) => v.scheduled_date)
      .sort()
      .pop();
    const horizon = latestDate && latestDate >= today ? addDays(latestDate, 1) : tomorrow;

    const nextAvailableSlot = findNextSlot(
      horizon,
      occupiedDates,
      rule.minGapDays,
      rule.maxLookaheadDays
    );

    return {
      platform,
      minGapDays: rule.minGapDays,
      maxLookaheadDays: rule.maxLookaheadDays,
      scheduledCount: futureScheduled.length,
      nextAvailableSlot
    };
  });

  return { summaries };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const formData = await request.formData();
    const raw = formData.get('config');
    if (typeof raw !== 'string') return fail(400, { error: 'Missing config' });

    let config: CadenceConfig;
    try {
      config = JSON.parse(raw);
    } catch {
      return fail(400, { error: 'Invalid JSON' });
    }

    // Validate
    for (const [platform, rule] of Object.entries(config)) {
      if (
        typeof rule.minGapDays !== 'number' ||
        typeof rule.maxLookaheadDays !== 'number' ||
        rule.minGapDays < 1 ||
        rule.maxLookaheadDays < 1
      ) {
        return fail(400, { error: `Invalid values for ${platform}` });
      }
    }

    await saveCadenceConfig(config);
    return { saved: true };
  }
};
