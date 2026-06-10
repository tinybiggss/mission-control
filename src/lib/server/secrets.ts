import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SECRETS_DIR = join(homedir(), '.openclaw', 'workspace', 'secrets');

/**
 * Read a secrets file and parse it as "Key: value" lines.
 * Returns an object with lowercase keys.
 */
async function readSecretFile(filename: string): Promise<Record<string, string>> {
  const filePath = join(SECRETS_DIR, filename);
  if (!existsSync(filePath)) return {};
  const raw = await readFile(filePath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export interface BlueskyCredentials {
  handle: string;
  appPassword: string;
}

export async function getBlueskyCredentials(): Promise<BlueskyCredentials> {
  const data = await readSecretFile('bluesky.txt');
  const handle = (data['handle'] ?? '').replace(/^@/, '');
  const appPassword = data['apppassword'] ?? data['app password'] ?? data['apppassword'] ?? '';
  if (!handle || !appPassword) {
    throw new Error('Bluesky credentials missing or incomplete in ~/.openclaw/workspace/secrets/bluesky.txt');
  }
  return { handle, appPassword };
}

export interface SubstackCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface SubstackCredentials {
  cookieHeader: string;
  userId: number | null;
}

export async function getSubstackCredentials(): Promise<SubstackCredentials> {
  const filePath = join(SECRETS_DIR, 'substack-cookies.json');
  if (!existsSync(filePath)) {
    throw new Error('Substack cookies missing — run refresh-substack-cookies.mjs to generate them');
  }
  const raw = await readFile(filePath, 'utf-8');
  const data = JSON.parse(raw) as { cookies: SubstackCookie[] };
  const cookies = data.cookies ?? [];

  const sid = cookies.find(c => c.name === 'substack.sid');
  if (!sid) {
    throw new Error('substack.sid not found in cookies file — re-run refresh-substack-cookies.mjs');
  }

  // URL-decode values before building the header (DevTools shows encoded form)
  const cookieHeader = cookies
    .map(c => `${c.name}=${decodeURIComponent(c.value)}`)
    .join('; ');

  // Extract userId from substack.lli JWT if present
  let userId: number | null = null;
  const lli = cookies.find(c => c.name === 'substack.lli');
  if (lli) {
    try {
      const payload = lli.value.split('.')[1];
      const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
      const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
      userId = decoded.userId ?? null;
    } catch { /* ignore decode errors */ }
  }

  return { cookieHeader, userId };
}
