#!/usr/bin/env node
/**
 * Manual smoke test for the dashboard session logging middleware.
 *
 * Usage:
 *   PORT=3456 node tests/test-session-log.js
 *
 * What it does:
 *   1. Spawns `node server.js` on PORT
 *   2. Fires 4 chat requests with different shapes (frontmatter, no frontmatter,
 *      no draft path, with comments)
 *   3. Verifies log files were created with the right article IDs
 *   4. Hits the retrieval endpoints
 *   5. Cleans up
 *
 * Exits 0 on success, 1 on any failure.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3499', 10);
const PROJECT_DIR = path.resolve(__dirname, '..');
const SESSION_LOG_ROOT = path.join(os.homedir(), '.openclaw', 'workspace', 'session-logs');
const TODAY = new Date().toISOString().slice(0, 10);
const TODAY_DIR = path.join(SESSION_LOG_ROOT, TODAY);

function httpReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; }
}

async function main() {
  // Pre-clean test files for today
  if (!fs.existsSync(TODAY_DIR)) fs.mkdirSync(TODAY_DIR, { recursive: true });
  for (const f of fs.readdirSync(TODAY_DIR)) {
    if (f.startsWith('dashboard-')) fs.unlinkSync(path.join(TODAY_DIR, f));
  }

  console.log(`[test] starting server on :${PORT}`);
  const proc = spawn('node', ['server.js'], {
    cwd: PROJECT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  proc.on('exit', (c, s) => process.stderr.write(`[server exited code=${c} sig=${s}]\n`));

  await sleep(1500);

  try {
    // Smoke: server up
    const h = await httpReq('GET', '/api/drafts');
    assert(h.status === 200, 'server is up');

    // Fire 4 chat requests
    await httpReq('POST', '/api/chat', {
      message: 'Make the hook sharper and add a community angle',
      draftPath: '2026-06-09/draft-Media-Server-Off-Ramp-DRAFT.md',
      draftContent: '---\ntitle: "Media Server Off Ramp"\narticle_id: "Media-Server-Off-Ramp-DRAFT"\n---\n\nThe media you own is not yours.',
      comments: []
    });
    await httpReq('POST', '/api/chat', {
      message: 'What do you think about this opener?',
      draftPath: '2026-06-09/draft-Home-Solar-Setup.md',
      draftContent: 'Some draft content without frontmatter.',
      comments: []
    });
    await httpReq('POST', '/api/chat', {
      message: 'What is the capital of France?',
      draftContent: 'Irrelevant content.',
      comments: []
    });
    await httpReq('POST', '/api/chat', {
      message: 'Make the intro less preachy',
      draftPath: '2026-06-09/draft-Urban-Gardening.md',
      draftContent: 'Article about urban gardening...',
      comments: [{ quote: 'community gardens', text: 'too abstract', resolved: false }]
    });

    await sleep(800);

    // Verify files
    const files = fs.readdirSync(TODAY_DIR).filter((f) => f.startsWith('dashboard-'));
    assert(files.length === 4, `created 4 log files (found ${files.length})`);

    const mediaServerFile = files.find((f) => f.includes('Media-Server-Off-Ramp-DRAFT'));
    assert(!!mediaServerFile, 'file for Media-Server-Off-Ramp-DRAFT (from frontmatter)');
    const solarFile = files.find((f) => f.includes('Home-Solar-Setup'));
    assert(!!solarFile, 'file for Home-Solar-Setup (from filename)');
    const untitledFile = files.find((f) => f.includes('untitled'));
    assert(!!untitledFile, 'file for "untitled" fallback');
    const urbanFile = files.find((f) => f.includes('Urban-Gardening'));
    assert(!!urbanFile, 'file for Urban-Gardening');

    // Each file: Mike first, Corvus second
    for (const f of files) {
      const content = fs.readFileSync(path.join(TODAY_DIR, f), 'utf8');
      const events = content.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const mikeIdx = events.findIndex((e) => e.sender === 'Mike Jones');
      const corvusIdx = events.findIndex((e) => e.sender === 'Corvus');
      assert(mikeIdx === 0 && corvusIdx === 1, `${f}: Mike then Corvus`);
      const sessionId = events[0].session_id;
      assert(events.every((e) => e.session_id === sessionId), `${f}: all events share session_id`);
    }

    // Retrieval endpoints
    const byArticle = await httpReq('GET', '/api/sessions/Media-Server-Off-Ramp-DRAFT');
    const byArticleData = JSON.parse(byArticle.body);
    assert(byArticleData.session_count === 1 && byArticleData.message_count === 2, 'GET /api/sessions/:id returns 1 session, 2 messages');

    const latest = await httpReq('GET', '/api/sessions/latest');
    const latestData = JSON.parse(latest.body);
    assert(!!latestData.session && latestData.session.message_count === 2, 'GET /api/sessions/latest returns a session with 2 messages');

    const empty = await httpReq('GET', '/api/sessions/Does-Not-Exist');
    const emptyData = JSON.parse(empty.body);
    assert(emptyData.session_count === 0, 'GET /api/sessions/:nonexistent returns 0 sessions');
  } catch (e) {
    console.error('CRASHED:', e);
    fail++;
  } finally {
    proc.kill();
    await sleep(200);
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
