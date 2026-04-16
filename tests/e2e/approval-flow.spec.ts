import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LINKEDIN_FIXTURE = resolve(
  __dirname,
  '../fixtures/vault/Resilient Tomorrow/Content Adapted/2026-04-15/draft-2026-04-15-001/linkedin.md'
);

let originalContent: string;

test.beforeEach(async () => {
  originalContent = await readFile(LINKEDIN_FIXTURE, 'utf-8');
});

test.afterEach(async () => {
  // Restore fixture state so tests are independent
  await writeFile(LINKEDIN_FIXTURE, originalContent, 'utf-8');
});

test('displays draft cards with platform versions', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Default filter is "Pending" — only draft-001 has pending versions. Switch to "All" to see both drafts.
  await page.getByRole('button', { name: /^All \(/ }).click();

  // Draft headlines should appear
  await expect(page.getByRole('heading', { name: 'Test Signal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Another Signal' })).toBeVisible();

  // Platform panels
  await expect(page.getByRole('heading', { name: 'Linkedin' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'X Twitter' })).toBeVisible();
});

test('approves a single platform version', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Locate the Linkedin panel via its h3. Default filter is "Pending" so draft-001 is the
  // only visible draft and its Linkedin panel is the unique match. Walk up to the PlatformPanel
  // wrapper (the rounded border div) via xpath to scope the Approve click.
  const linkedinHeading = page.getByRole('heading', { name: 'Linkedin', exact: true });
  const linkedinPanel = linkedinHeading.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
  await linkedinPanel.getByRole('button', { name: /✓ Approve/ }).click();

  // Toast appears
  await expect(page.getByText(/Marked linkedin as approved/)).toBeVisible();

  // File on disk should be updated
  const updated = await readFile(LINKEDIN_FIXTURE, 'utf-8');
  expect(updated).toContain('status: approved');
});

test('status filter hides non-matching versions', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Default filter is "Pending" — "Approved" chip should show count 1 (draft-002/linkedin is approved in fixtures)
  const approvedChip = page.getByRole('button', { name: /Approved \(1\)/ });
  await expect(approvedChip).toBeVisible();

  await approvedChip.click();

  // draft-002 Another Signal should still be visible
  await expect(page.getByRole('heading', { name: 'Another Signal' })).toBeVisible();

  // draft-001 Test Signal should be hidden since its versions are all pending
  await expect(page.getByRole('heading', { name: 'Test Signal' })).not.toBeVisible();
});
