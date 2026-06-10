import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import matter from 'gray-matter';
import { listAllAdapted } from './adapted';
import { listAllDrafts } from './drafts';
import { serializeFrontmatter } from './frontmatter';
import { getBlueskyCredentials, getSubstackCredentials } from './secrets';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PublishSuccess {
  draftId: string;
  platform: string;
  postId: string;
  postUrl: string;
}

export interface PublishFailure {
  draftId: string;
  platform: string;
  error: string;
}

export interface PublishRunResult {
  timestamp: string;
  date: string;
  published: PublishSuccess[];
  failed: PublishFailure[];
  skipped: { draftId: string; platform: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Bluesky AT Protocol client
// ---------------------------------------------------------------------------

const BSKY_API = 'https://bsky.social/xrpc';
const BSKY_MAX_GRAPHEMES = 300;

interface BskySession {
  accessJwt: string;
  did: string;
}

async function bskyCreateSession(handle: string, appPassword: string): Promise<BskySession> {
  const res = await fetch(`${BSKY_API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky auth failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { accessJwt: string; did: string };
  return { accessJwt: data.accessJwt, did: data.did };
}

async function bskyPost(
  session: BskySession,
  text: string
): Promise<{ uri: string; cid: string }> {
  // Bluesky counts graphemes, not bytes. Truncate if needed.
  const graphemes = [...text];
  const truncated = graphemes.length > BSKY_MAX_GRAPHEMES
    ? graphemes.slice(0, BSKY_MAX_GRAPHEMES - 1).join('') + '…'
    : text;

  const res = await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: truncated,
        createdAt: new Date().toISOString()
      }
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky post failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<{ uri: string; cid: string }>;
}

/** Convert an AT URI (at://did/collection/rkey) to a viewable bsky.app URL */
function atUriToUrl(uri: string, handle: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/rkey
  const rkey = uri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

// ---------------------------------------------------------------------------
// Substack Notes client
// ---------------------------------------------------------------------------

/** Convert markdown body to Substack's tiptap/ProseMirror doc format */
function textToSubstackDoc(text: string): object {
  const cleaned = text
    .split('\n')
    .filter(line => !line.startsWith('accessed_by:'))  // strip adapter metadata
    .map(line => line.replace(/^#{1,6}\s+/, ''))        // strip markdown headings
    .join('\n');

  const paragraphs = cleaned.split(/\n\n+/)
    .map(para => para.trim())
    .filter(para => para.length > 0)
    .map(para => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para }]
    }));

  return { type: 'doc', content: paragraphs };
}

/** Post using raw https module — avoids extra headers that fetch() adds which trigger Substack CSRF */
function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Substack post failed (${res.statusCode}): ${text.slice(0, 300)}`));
        } else {
          resolve(text);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function substackPostNote(cookieHeader: string, text: string): Promise<{ id: number }> {
  const payload = JSON.stringify({
    bodyJson: textToSubstackDoc(text),
    publishedBylines: [],
    trackingParameters: {}
  });

  const responseText = await httpsPost(
    'https://substack.com/api/v1/comment/feed',
    payload,
    {
      'Cookie': cookieHeader,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://substack.com/',
    }
  );
  return JSON.parse(responseText) as { id: number };
}

// ---------------------------------------------------------------------------
// Platform dispatcher
// ---------------------------------------------------------------------------

/**
 * Platform-specific publishers. Each returns { postId, postUrl } on success
 * or throws on failure. Add new platforms here as they're built.
 */
const PLATFORM_PUBLISHERS: Record<
  string,
  (body: string) => Promise<{ postId: string; postUrl: string }>
> = {
  bluesky: async (body) => {
    const creds = await getBlueskyCredentials();
    const session = await bskyCreateSession(creds.handle, creds.appPassword);
    const result = await bskyPost(session, body);
    return {
      postId: result.uri,
      postUrl: atUriToUrl(result.uri, creds.handle)
    };
  },

  'substack-notes': async (body) => {
    const creds = await getSubstackCredentials();
    const result = await substackPostNote(creds.cookieHeader, body);
    const postId = String(result.id);
    return {
      postId,
      postUrl: `https://substack.com/p/${postId}`
    };
  }
  // reddit: async (body) => { ... }      — add next
};

// ---------------------------------------------------------------------------
// Core publisher
// ---------------------------------------------------------------------------

export async function runPublisher(
  vaultRoot: string,
  targetDate?: string
): Promise<PublishRunResult> {
  const date = targetDate ?? todayIso();
  const [, versions] = await Promise.all([
    listAllDrafts(vaultRoot),
    listAllAdapted(vaultRoot)
  ]);

  const due = versions.filter(
    (v) => v.status === 'scheduled' && v.scheduled_date === date
  );

  const published: PublishSuccess[] = [];
  const failed: PublishFailure[] = [];
  const skipped: PublishRunResult['skipped'] = [];

  for (const version of due) {
    const publisher = PLATFORM_PUBLISHERS[version.platform];
    if (!publisher) {
      skipped.push({
        draftId: version.draftId,
        platform: version.platform,
        reason: 'No publisher implemented for this platform yet'
      });
      continue;
    }

    try {
      const { postId, postUrl } = await publisher(version.body);
      await markPublished(version.filePath, postId, date);
      published.push({ draftId: version.draftId, platform: version.platform, postId, postUrl });
    } catch (err) {
      const error = (err as Error).message;
      await markFailed(version.filePath, error);
      failed.push({ draftId: version.draftId, platform: version.platform, error });
      console.error(`[publisher] ${version.platform}/${version.draftId} failed: ${error}`);
    }
  }

  return { timestamp: new Date().toISOString(), date, published, failed, skipped };
}

// ---------------------------------------------------------------------------
// Frontmatter writers
// ---------------------------------------------------------------------------

async function markPublished(filePath: string, postId: string, date: string): Promise<void> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  const data = {
    ...parsed.data,
    status: 'published',
    published_date: date,
    platform_post_id: postId,
    publish_error: ''
  };
  await writeFile(filePath, serializeFrontmatter(data, parsed.content), 'utf-8');
}

async function markFailed(filePath: string, error: string): Promise<void> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  const data = {
    ...parsed.data,
    status: 'publish-failed',
    publish_error: error.slice(0, 500)
  };
  await writeFile(filePath, serializeFrontmatter(data, parsed.content), 'utf-8');
}
