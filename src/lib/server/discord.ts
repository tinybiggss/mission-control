import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

interface OpenClawDiscord {
  token: string;
  enabled?: boolean;
  guilds: Record<string, unknown>;
}

interface DiscordConfig {
  token: string;
  guildId: string;
  channelId: string;
}

/** Path to OpenClaw config — can be overridden for tests via OPENCLAW_CONFIG_PATH. */
function openClawConfigPath(): string {
  return env.OPENCLAW_CONFIG_PATH || process.env.OPENCLAW_CONFIG_PATH || join(homedir(), '.openclaw', 'openclaw.json');
}

/**
 * Load Discord config from OpenClaw config file + environment.
 *
 * Token and guild ID come from ~/.openclaw/openclaw.json (source of truth for bot config).
 * Channel ID comes from DISCORD_RT_CONTENT_CHANNEL_ID env var (not secret, dashboard-specific).
 */
export async function loadDiscordConfig(): Promise<DiscordConfig> {
  const channelId = env.DISCORD_RT_CONTENT_CHANNEL_ID || process.env.DISCORD_RT_CONTENT_CHANNEL_ID;
  if (!channelId) {
    throw new Error('DISCORD_RT_CONTENT_CHANNEL_ID is not set. Add it to .env.');
  }

  const configPath = openClawConfigPath();
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read OpenClaw config at ${configPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`OpenClaw config is not valid JSON: ${(err as Error).message}`);
  }

  const discord = (parsed as { channels?: { discord?: OpenClawDiscord } })?.channels?.discord;
  if (!discord || !discord.token) {
    throw new Error(`OpenClaw config is missing channels.discord.token`);
  }

  const guilds = discord.guilds || {};
  const guildIds = Object.keys(guilds);
  if (guildIds.length === 0) {
    throw new Error('OpenClaw config has no Discord guilds configured');
  }
  // First guild wins. If multiple guilds, add DISCORD_GUILD_ID env override later.
  const guildId = guildIds[0];

  return { token: discord.token, guildId, channelId };
}

export interface CreateThreadResult {
  threadId: string;
  threadUrl: string;
}

/**
 * Create a public thread in the configured channel and return its id + URL.
 *
 * Uses POST /channels/{channel.id}/threads with type=11 (PUBLIC_THREAD, no starter message),
 * which requires CREATE_PUBLIC_THREADS permission in the channel for the bot.
 *
 * Thread name is truncated to Discord's 100-char limit.
 */
export async function createThread(name: string, config?: DiscordConfig): Promise<CreateThreadResult> {
  const cfg = config ?? (await loadDiscordConfig());
  const truncated = name.slice(0, 100);

  const res = await fetch(`https://discord.com/api/v10/channels/${cfg.channelId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${cfg.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CorvusDashboard (local, 0.1)'
    },
    body: JSON.stringify({
      name: truncated,
      type: 11, // PUBLIC_THREAD, no starter message required
      auto_archive_duration: 4320 // 3 days
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Discord thread create failed: ${res.status} ${res.statusText} ${detail}`);
  }

  const body = (await res.json()) as { id?: string };
  if (!body.id) {
    throw new Error('Discord thread create returned no id');
  }

  return {
    threadId: body.id,
    threadUrl: `https://discord.com/channels/${cfg.guildId}/${body.id}`
  };
}
