/**
 * Opens a browser, lets you log into Substack, then saves the session cookies.
 * Run from corvus-dashboard dir: node /Users/michaeljones/Dev/refresh-substack-cookies.mjs
 */

import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SECRETS_FILE = join(homedir(), '.openclaw/workspace/secrets/substack-cookies.json');

console.log('Opening browser — log into Substack, then come back here and press Enter.');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://substack.com/sign-in');

// Wait for user to log in manually
await new Promise(resolve => {
  process.stdout.write('Press Enter once you are logged into Substack... ');
  process.stdin.once('data', resolve);
});

const cookies = await context.cookies('https://substack.com');
const relevant = cookies.filter(c =>
  ['substack.sid', 'substack.lli', 'visit_id'].includes(c.name)
);

if (!relevant.find(c => c.name === 'substack.sid')) {
  console.error('substack.sid not found — make sure you are fully logged in.');
  await browser.close();
  process.exit(1);
}

const output = {
  note: 'Corvus Substack account cookies - resilienttomorrow.substack.com',
  date_saved: new Date().toISOString().slice(0, 10),
  cookies: relevant
};

writeFileSync(SECRETS_FILE, JSON.stringify(output, null, 2));
console.log(`\nSaved ${relevant.length} cookies to ${SECRETS_FILE}`);
console.log('Cookies:', relevant.map(c => c.name).join(', '));

await browser.close();
process.exit(0);
