import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BLUESKY_FIXTURE = resolve(
  __dirname,
  '../fixtures/vault/Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/bluesky.md'
);
const THREADS_FIXTURE = resolve(
  __dirname,
  '../fixtures/vault/Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-002/threads.md'
);

let originalBluesky: string;
let originalThreads: string;

test.beforeEach(async () => {
  originalBluesky = await readFile(BLUESKY_FIXTURE, 'utf-8');
  originalThreads = await readFile(THREADS_FIXTURE, 'utf-8');
});

test.afterEach(async () => {
  await writeFile(BLUESKY_FIXTURE, originalBluesky, 'utf-8');
  await writeFile(THREADS_FIXTURE, originalThreads, 'utf-8');
});

test('calendar renders scheduled events on their dates', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  await gotoMonth(page, 'April 2026');

  await expect(
    page.getByRole('gridcell', { name: '2026-04-20' }).getByRole('button', { name: /bluesky/i })
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: '2026-04-22' }).getByRole('button', { name: /threads/i })
  ).toBeVisible();
});

test('clicking an event opens the reschedule modal and writes to disk', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  await gotoMonth(page, 'April 2026');

  await page
    .getByRole('gridcell', { name: '2026-04-20' })
    .getByRole('button', { name: /bluesky/i })
    .click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await modal.locator('input[type="date"]').fill('2026-04-25');
  await modal.getByRole('button', { name: 'Reschedule' }).click();

  await expect(page.getByText(/Moved bluesky → 2026-04-25/)).toBeVisible();

  const updated = await readFile(BLUESKY_FIXTURE, 'utf-8');
  expect(updated).toMatch(/scheduled_date:\s*['"]?2026-04-25['"]?/);
  expect(updated).toContain('status: scheduled');
});

test('week view shows exactly 7 day cells', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Week', exact: true }).click();

  await expect(page.getByRole('gridcell')).toHaveCount(7);
});

/**
 * Step prev/next until the <h2> heading matches the target label (e.g. "April 2026").
 * Uses Date parsing of the current heading to decide direction.
 */
async function gotoMonth(page: Page, target: string) {
  const targetDate = new Date(Date.parse(`1 ${target}`));
  for (let i = 0; i < 48; i++) {
    const current = (await page.locator('h2').first().textContent())?.trim() ?? '';
    if (current === target) return;
    const currentDate = new Date(Date.parse(`1 ${current}`));
    const dir = targetDate > currentDate ? 'Next' : 'Previous';
    await page.getByRole('button', { name: dir }).click();
  }
  throw new Error(`Could not navigate to ${target}`);
}
