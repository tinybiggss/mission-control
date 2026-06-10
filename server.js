const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Drafts directory — symlink to Resilient Tomorrow Content Drafts
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const COMMENTS_DIR = path.join(__dirname, 'comments');

// Content Adapted directory — symlink to Resilient Tomorrow Content Adapted
const ADAPTED_DIR = path.join(__dirname, 'adapted');

// === Session Logger ============================================================
// Captures every chat message (Mike ↔ AI) for future agent training and
// editorial-history review. See:
//   ~/.openclaw/workspace/projects/session-capture/Session-Capture-Design-Spec.md
//
// Design notes:
//   - JSONL append-only log per day: append-friendly, one event per line, easy
//     to stream-tail, easy to load with `readlines`.
//   - Fire-and-forget writes: log IO never blocks the chat response.
//   - Errors are swallowed + logged to stderr; the dashboard must never crash
//     because a log write failed.
//   - `session_id` groups messages for a single user/AI exchange. We create a
//     new session per chat turn (one round-trip) so each `(user, ai)` pair is
//     a self-contained training example.

const SESSION_LOG_ROOT = path.join(os.homedir(), '.openclaw', 'workspace', 'session-logs');

function sessionLogDirForDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(SESSION_LOG_ROOT, `${yyyy}-${mm}-${dd}`);
}

function todayDateStamp(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeForFilename(s) {
  if (!s || typeof s !== 'string') return 'untitled';
  return s
    .replace(/[\\/]/g, '-') // path separators → dash
    .replace(/[^A-Za-z0-9._-]+/g, '-') // any other non-safe chars
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

// Derive a stable-ish article_id from the draft path the client sends.
// Examples:
//   "2026-06-09/draft-Media-Server-Off-Ramp-DRAFT.md" → "Media-Server-Off-Ramp-DRAFT"
//   "draft-Media-Server-Off-Ramp-DRAFT.md"              → "Media-Server-Off-Ramp-DRAFT"
//   "Content Drafts/2026-06-09/draft-Foo.md"            → "Foo"
//   null / undefined                                    → "untitled"
function articleIdFromDraftPath(draftPath) {
  if (!draftPath || typeof draftPath !== 'string') return 'untitled';
  const base = path.basename(draftPath, path.extname(draftPath));
  return base.replace(/^draft-/, '') || 'untitled';
}

function articleIdFromFrontmatter(fm) {
  if (fm && typeof fm === 'object') {
    if (typeof fm.article_id === 'string' && fm.article_id.trim()) return fm.article_id.trim();
    if (typeof fm.title === 'string' && fm.title.trim()) return fm.title.trim();
    if (typeof fm.id === 'string' && fm.id.trim()) return fm.id.trim();
  }
  return null;
}

let activeSession = {
  session_id: null,
  article_id: null,
  article_path: null,
  started_at: null
};

function getOrCreateSession(articleId, articlePath) {
  // Reuse the current session only if article matches. Otherwise, close out
  // the implicit session by starting a new one. This keeps dashboard state
  // (no explicit "end session" button) sensible: switching articles = new
  // session, same article = continue session.
  if (activeSession.session_id && activeSession.article_id === articleId) {
    return activeSession;
  }
  activeSession = {
    session_id: crypto.randomUUID(),
    article_id: articleId,
    article_path: articlePath,
    started_at: new Date().toISOString()
  };
  return activeSession;
}

function sessionLogFilePath(articleId, sessionId) {
  // Stable path per session: same article + same session_id = same file, so
  // every message in a single chat session is co-located in one JSONL file.
  const sessionSlug = crypto
    .createHash('sha1')
    .update(String(sessionId || 'no-session'))
    .digest('hex')
    .slice(0, 12);
  const dir = sessionLogDirForDate();
  const file = `dashboard-${sanitizeForFilename(articleId)}-${sessionSlug}.jsonl`;
  return path.join(dir, file);
}

// Per-file write queue: ensures that events for the same JSONL file are
// appended in the order they were enqueued, even if the writes are queued
// from inside an async handler. Without this, two parallel fs.appendFile
// calls to the same path can race and land out of order.
const fileWriteQueues = new Map();

function enqueueFileWrite(filePath, line) {
  let q = fileWriteQueues.get(filePath);
  if (!q) {
    q = Promise.resolve();
    fileWriteQueues.set(filePath, q);
  }
  const next = q.then(
    () =>
      new Promise((resolve) => {
        fs.appendFile(filePath, line, 'utf8', (err) => {
          if (err) console.error('[session-log] append failed:', err.message);
          resolve();
        });
      })
  );
  // Keep the chain alive but don't propagate errors to the next item.
  fileWriteQueues.set(filePath, next.catch(() => {}));
}

function appendSessionEvent(event) {
  // Fire-and-forget: queue write, return immediately. Caller does not await.
  // Filename is derived from the (article_id, session_id) pair so every event
  // in a single chat session lands in the same JSONL file (per the design
  // spec: a session has a start + end and is the unit of capture).
  const line = JSON.stringify(event) + '\n';
  const filePath = sessionLogFilePath(event.article_id || 'untitled', event.session_id);
  setImmediate(() => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      enqueueFileWrite(filePath, line);
    } catch (e) {
      console.error('[session-log] setup failed:', e.message);
    }
  });
}

// Heuristic: classify a user message into a coarse message_type so downstream
// summarizers don't have to re-derive intent from raw text. This is intentionally
// simple — fine for first-pass training data, easy to override later.
function classifyMessage(text) {
  if (!text || typeof text !== 'string') return 'other';
  const t = text.trim();
  const lower = t.toLowerCase();
  // Approval/affirmation
  if (/^(yes|yep|yeah|ok|okay|sure|do it|approved?|ship it|looks good|perfect|great|good)\b/i.test(lower) && t.length < 80) {
    return 'approval';
  }
  // Question
  if (/\?$/.test(t) || /^(what|why|how|when|where|who|which|can you|could you|do you|should|would|is there|are there)\b/i.test(lower)) {
    return 'question';
  }
  // Feedback (negative or revision-y)
  if (/^(no|nope|don'?t|stop|wait|actually|instead|change|rewrite|rework|too|not quite|that'?s not|wrong|remove|cut)\b/i.test(lower)) {
    return 'feedback';
  }
  // Directive (imperative, often starts with a verb)
  if (/^(make|add|create|write|draft|build|fix|update|edit|change|set|run|spawn|start|stop|delete|remove|generate|produce|pull|grab|find|check|kick off)\b/i.test(lower)) {
    return 'directive';
  }
  return 'other';
}

function readAllSessionLogs() {
  // Walks every day directory and returns the parsed events from every JSONL
  // file. Used by retrieval endpoints. Synchronous on purpose (these endpoints
  // are admin-only and the volume is small — days × few events).
  if (!fs.existsSync(SESSION_LOG_ROOT)) return [];
  const out = [];
  const days = fs.readdirSync(SESSION_LOG_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .sort();
  for (const day of days) {
    const dayPath = path.join(SESSION_LOG_ROOT, day.name);
    const files = fs.readdirSync(dayPath).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const full = path.join(dayPath, f);
      try {
        const text = fs.readFileSync(full, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            out.push(JSON.parse(line));
          } catch (e) {
            // Skip corrupt line, keep going
          }
        }
      } catch (e) {
        console.error('[session-log] read failed:', full, e.message);
      }
    }
  }
  return out;
}

// === /Session Logger ===========================================================

// Ensure directories exist
if (!fs.existsSync(DRAFTS_DIR)) {
  try {
    fs.symlinkSync(
      '/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space/Resilient Tomorrow/Content Drafts',
      DRAFTS_DIR
    );
    console.log('Symlink created for drafts');
  } catch (e) {
    console.error('Could not create symlink:', e.message);
  }
}
if (!fs.existsSync(ADAPTED_DIR)) {
  try {
    fs.symlinkSync(
      '/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space/Resilient Tomorrow/Content Adapted',
      ADAPTED_DIR
    );
    console.log('Symlink created for adapted');
  } catch (e) {
    console.error('Could not create symlink for adapted:', e.message);
  }
}
if (!fs.existsSync(COMMENTS_DIR)) fs.mkdirSync(COMMENTS_DIR, { recursive: true });

function parseFrontmatter(content) {
  // Handle both multi-line and single-line frontmatter
  const match = content.match(/^---\n([\s\S]*?)\n---/) || content.match(/^---\s+/) || content.match(/^([^\n]+?)\n\n/);
  if (!match) return {};
  const fm = {};
  // If content starts with id: directly (no --- marker)
  if (!content.startsWith('---')) {
    const line = content.split('\n')[0];
    const pairs = line.split(/\s+(?=[a-z_]+:)/);
    pairs.forEach(pair => {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) return;
      const key = pair.slice(0, colonIdx).trim();
      let val = pair.slice(colonIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      fm[key] = val;
    });
    return fm;
  }
  // Single-line with --- marker: "--- key: value key2: value2"
  if (match[1] === undefined) {
    const afterDash = content.slice(content.indexOf('---') + 3).trim();
    const pairs = afterDash.split(/\s+(?=[a-z_]+:)/);
    pairs.forEach(pair => {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) return;
      const key = pair.slice(0, colonIdx).trim();
      let val = pair.slice(colonIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      fm[key] = val;
    });
    return fm;
  }
  // Multi-line frontmatter
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    fm[key] = val;
  });
  return fm;
}

// === Phase tracker =============================================================
// Editorial phases for a draft. The phase lives in the draft's frontmatter as
// `phase: "PASS N"` and is read/written via /api/drafts/:draftId/phase.
//
// Default for files in Content Drafts is PASS 3 (Review & Approve). Files
// detected as scripts (in Content Adapted) default to PASS 4 (Final Edit).
// Override with an explicit `phase:` value in frontmatter.

const PHASES = [
  { id: 'PASS 0', label: 'Idea/Research',         goal: 'Capture the signal, scan sources, decide whether the angle is worth pursuing.' },
  { id: 'PASS 1', label: 'Outline',                goal: 'Map the structure, set the headline formula, sketch the section beats.' },
  { id: 'PASS 2', label: 'Rough Draft',            goal: 'Fill in the sections. Don\'t polish — get the argument down on the page.' },
  { id: 'PASS 3', label: 'Review & Approve',       goal: 'Review structure, approve for final edit, leave comments for revisions.' },
  { id: 'PASS 4', label: 'Final Edit',             goal: 'Apply comments, tighten prose, fact-check, prep for publication.' },
  { id: 'PASS 5', label: 'Published',              goal: 'Live on Substack. Promote, share, measure response.' }
];

const PHASE_IDS = PHASES.map(p => p.id);
const DEFAULT_PHASE_BY_CONTENT_TYPE = {
  'article-outline': 'PASS 1',
  'text-draft':      'PASS 3',
  'visual-brief':    'PASS 3',
  'video-script':    'PASS 4',
  'video-longform':  'PASS 4'
};
const DEFAULT_PHASE = 'PASS 3';

function phaseIndex(id) {
  if (!id) return -1;
  const norm = String(id).trim().toUpperCase();
  return PHASE_IDS.indexOf(norm);
}

function phaseDescriptor(id) {
  const idx = phaseIndex(id);
  if (idx === -1) return null;
  return PHASES[idx];
}

function defaultPhaseFor(contentType) {
  return DEFAULT_PHASE_BY_CONTENT_TYPE[contentType] || DEFAULT_PHASE;
}

function nextPhaseId(id) {
  const idx = phaseIndex(id);
  if (idx === -1 || idx >= PHASES.length - 1) return null;
  return PHASES[idx + 1].id;
}

function prevPhaseId(id) {
  const idx = phaseIndex(id);
  if (idx <= 0) return null;
  return PHASES[idx - 1].id;
}

// Read phase from a draft's parsed frontmatter. Returns the raw value or null.
function readPhaseFromFrontmatter(fm) {
  if (!fm || typeof fm !== 'object') return null;
  const v = fm.phase;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

// Set or replace the `phase:` key in a draft file's frontmatter while keeping
// the rest of the file (frontmatter + body) intact. Returns the new content.
//
// Handles the two frontmatter shapes we see in the vault:
//   1) Single-line: `id: "..." status: "draft" ...` on one line, no --- markers.
//   2) Multi-line:  `---\nkey: val\n---\n\n# Body`
//
// We never add --- markers to a single-line file (keeps the format stable for
// other tools that read these drafts) and never strip them from a multi-line
// file. We only touch the `phase:` key.
function setPhaseInContent(content, newPhase) {
  const value = String(newPhase || '').trim().toUpperCase();
  if (!PHASE_IDS.includes(value)) {
    throw new Error(`Invalid phase: ${newPhase}. Must be one of: ${PHASE_IDS.join(', ')}`);
  }

  // Detect format.
  const isMultiLine = /^---\r?\n/.test(content);

  if (!isMultiLine) {
    // Single-line frontmatter (no --- markers). Find the first newline.
    const firstNewline = content.indexOf('\n');
    if (firstNewline === -1) {
      // Whole file is one line — replace it.
      return `phase: "${value}"`;
    }
    const frontmatterLine = content.slice(0, firstNewline);
    const rest = content.slice(firstNewline);

    // Replace existing `phase: ...` token on the frontmatter line.
    const phaseTokenRe = /\bphase:\s*(?:"[^"]*"|'[^']*'|[^\s]+)/i;
    let newFrontmatter;
    if (phaseTokenRe.test(frontmatterLine)) {
      newFrontmatter = frontmatterLine.replace(phaseTokenRe, `phase: "${value}"`);
    } else {
      // Append with a single space separator.
      newFrontmatter = frontmatterLine + (frontmatterLine.endsWith(' ') || frontmatterLine.endsWith('\t') ? '' : ' ') + `phase: "${value}"`;
    }
    return newFrontmatter + rest;
  }

  // Multi-line frontmatter: operate on lines between --- markers.
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    // `---` opens but never closes — bail with the input unchanged so the
    // user doesn't lose their file. The chat UI should not be promoting
    // broken drafts anyway.
    throw new Error('Could not locate closing `---` in multi-line frontmatter.');
  }
  const fmBody = fmMatch[1];
  const after = content.slice(fmMatch[0].length);

  // Re-emit each line; replace or append the `phase:` key.
  const lines = fmBody.split(/\r?\n/);
  const phaseLineRe = /^(\s*)phase:\s*(?:"[^"]*"|'[^']*'|[^\s]+)/i;
  let replaced = false;
  const newLines = lines.map((line) => {
    if (!replaced && phaseLineRe.test(line)) {
      replaced = true;
      const indent = line.match(/^(\s*)/)[1];
      return `${indent}phase: "${value}"`;
    }
    return line;
  });
  if (!replaced) {
    // Append on its own line. Preserve existing trailing newline behavior.
    if (newLines.length > 0 && newLines[newLines.length - 1] !== '') newLines.push('');
    newLines.push(`phase: "${value}"`);
  }
  const newFmBody = newLines.join('\n');
  // Preserve original terminator: the regex captured either `\n` or `\r\n`
  // before `---`. We default to `\n` for the new closing fence, which is what
  // the existing files use.
  return `---\n${newFmBody}\n---\n${after}`;
}

// === /Phase tracker ============================================================

// List all drafts
app.get('/api/drafts', (req, res) => {
  try {
    const drafts = [];
    if (fs.existsSync(DRAFTS_DIR)) {
      const entries = fs.readdirSync(DRAFTS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const datePath = path.join(DRAFTS_DIR, entry.name);
          const files = fs.readdirSync(datePath).filter(f => f.startsWith('draft-') && f.endsWith('.md'));
          for (const file of files) {
            const fullPath = path.join(datePath, file);
            const stat = fs.statSync(fullPath);
            const raw = fs.readFileSync(fullPath, 'utf8');
            const fm = parseFrontmatter(raw);
            const contentType = fm.content_type || 'text-draft';
            const phaseRaw = readPhaseFromFrontmatter(fm);
            const phaseId = phaseRaw && phaseIndex(phaseRaw) !== -1 ? phaseRaw : defaultPhaseFor(contentType);
            drafts.push({
              path: path.join(entry.name, file),
              name: file.replace('.md', ''),
              date: entry.name,
              mtime: stat.mtime,
              contentType,
              phase: phaseId,
              phaseDefault: !phaseRaw || phaseIndex(phaseRaw) === -1
            });
          }
        }
      }
    }
    drafts.sort((a, b) => b.date.localeCompare(a.date) || b.mtime - a.mtime);
    res.json(drafts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read a draft — use regex to capture the full path
app.get(/\/api\/draft\/(.+)/, (req, res) => {
  const draftPath = req.params[0];
  const fullPath = path.join(DRAFTS_DIR, draftPath);
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ content, path: draftPath });
  } catch (e) {
    res.status(404).json({ error: 'Draft not found' });
  }
});

// Save a draft
app.post(/\/api\/draft\/(.+)/, (req, res) => {
  const draftPath = req.params[0];
  const fullPath = path.join(DRAFTS_DIR, draftPath);
  try {
    fs.writeFileSync(fullPath, req.body.content, 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read comments for a draft
app.get(/\/api\/comments\/(.+)/, (req, res) => {
  const draftName = req.params[0];
  const commentsFile = path.join(COMMENTS_DIR, draftName + '.json');
  try {
    if (fs.existsSync(commentsFile)) {
      const data = JSON.parse(fs.readFileSync(commentsFile, 'utf8'));
      res.json(data);
    } else {
      res.json({ draft: draftName, comments: [] });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save comments for a draft
app.post(/\/api\/comments\/(.+)/, (req, res) => {
  const draftName = req.params[0];
  const commentsFile = path.join(COMMENTS_DIR, draftName + '.json');
  try {
    fs.writeFileSync(commentsFile, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === Phase endpoints ============================================================
// GET  /api/drafts/:draftId/phase — read current phase for a draft
// POST /api/drafts/:draftId/phase — set phase (body: { phase: "PASS 3" })
// The `draftId` here is the same path string used by the /api/drafts/:path
// endpoints (date-dir + filename), e.g. "2026-05-16/draft-2026-05-16-001.md".
app.get(/\/api\/drafts\/(.+)\/phase$/, (req, res) => {
  const draftPath = req.params[0];
  const fullPath = path.join(DRAFTS_DIR, draftPath);
  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Draft not found', path: draftPath });
    }
    const raw = fs.readFileSync(fullPath, 'utf8');
    const fm = parseFrontmatter(raw);
    const contentType = fm.content_type || 'text-draft';
    const phaseRaw = readPhaseFromFrontmatter(fm);
    const phaseId = phaseRaw && phaseIndex(phaseRaw) !== -1 ? phaseRaw : defaultPhaseFor(contentType);
    const descriptor = phaseDescriptor(phaseId);
    res.json({
      path: draftPath,
      contentType,
      phase: phaseId,
      phaseDefault: !phaseRaw || phaseIndex(phaseRaw) === -1,
      label: descriptor ? descriptor.label : null,
      goal: descriptor ? descriptor.goal : null,
      next: nextPhaseId(phaseId),
      prev: prevPhaseId(phaseId),
      phases: PHASES
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(/\/api\/drafts\/(.+)\/phase$/, (req, res) => {
  const draftPath = req.params[0];
  const fullPath = path.join(DRAFTS_DIR, draftPath);
  const requested = req.body && req.body.phase;
  try {
    if (!requested) {
      return res.status(400).json({ error: 'Missing `phase` in request body.' });
    }
    const norm = String(requested).trim().toUpperCase();
    if (phaseIndex(norm) === -1) {
      return res.status(400).json({
        error: `Invalid phase: ${requested}. Must be one of: ${PHASE_IDS.join(', ')}`,
        valid: PHASE_IDS
      });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Draft not found', path: draftPath });
    }
    const raw = fs.readFileSync(fullPath, 'utf8');
    const updated = setPhaseInContent(raw, norm);
    if (updated === raw) {
      // No change — still return success so the UI can refresh, but signal it.
      return res.json({ success: true, changed: false, phase: norm, path: draftPath });
    }
    // Write back atomically: write to a temp file in the same directory, then rename.
    // This avoids leaving a half-written file if Node dies mid-write.
    const tmpPath = fullPath + '.phase-tmp';
    fs.writeFileSync(tmpPath, updated, 'utf8');
    fs.renameSync(tmpPath, fullPath);
    const descriptor = phaseDescriptor(norm);
    res.json({
      success: true,
      changed: true,
      path: draftPath,
      phase: norm,
      label: descriptor ? descriptor.label : null,
      goal: descriptor ? descriptor.goal : null,
      next: nextPhaseId(norm),
      prev: prevPhaseId(norm)
    });
  } catch (e) {
    console.error('[phase] update failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === /Phase endpoints ===========================================================

// === AI Chat — proxy to Ollama directly =================================
app.post('/api/chat', async (req, res) => {
  const { message, draftContent, comments, highlights, draftPath } = req.body;

  // Resolve article_id from frontmatter (best signal) or path (fallback).
  // We do this before calling out to the AI so logging is consistent with
  // what the AI actually sees.
  let articleId = 'untitled';
  let articlePath = draftPath || null;
  try {
    if (draftPath) {
      const fullPath = path.join(DRAFTS_DIR, draftPath);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const fm = parseFrontmatter(raw);
        const fmId = articleIdFromFrontmatter(fm);
        if (fmId) {
          articleId = fmId;
        } else {
          articleId = articleIdFromDraftPath(draftPath);
        }
      } else {
        articleId = articleIdFromDraftPath(draftPath);
      }
    }
  } catch (e) {
    // Don't let article-association failure block the chat — just log it.
    console.error('[session-log] frontmatter read failed:', e.message);
    articleId = articleIdFromDraftPath(draftPath);
  }

  const session = getOrCreateSession(articleId, articlePath);

  // Log the user's message (fire-and-forget).
  appendSessionEvent({
    session_id: session.session_id,
    timestamp: new Date().toISOString(),
    article_id: articleId,
    article_path: articlePath,
    sender: 'Mike Jones',
    message_type: classifyMessage(message),
    content: message || '',
    draft_chars: typeof draftContent === 'string' ? draftContent.length : 0,
    comment_count: Array.isArray(comments) ? comments.length : 0,
    event: 'message'
  });

  const prompt = `You are Corvus, an AI assistant embedded in a document editor for Mike Jones's Substack "Resilient Tomorrow" (solarpunk, community resilience).

The user is asking you about the current draft document. Here is the full draft content:

${draftContent}

${comments && comments.length > 0 ? `Current comments on the document:\n${comments.map(c => `  - "${c.quote}" → ${c.text}${c.resolved ? ' [resolved]' : ''}`).join('\n')}` : 'No comments yet.'}

${highlights && highlights.length > 0 ? `Current highlighted passages (color → quoted text):\n${highlights.map(h => `  - ${h.color} highlight: "${h.text}"`).join('\n')}` : 'No highlights yet.'}

User message: ${message}

Provide a helpful, thoughtful response. You can suggest edits to the document if relevant — if you do, format them clearly so the editor can offer to apply them.`;

  // Use Ollama API directly (gateway /v1/agent is blocked)
  const ollamaUrl = 'http://127.0.0.1:11434';
  const model = 'minimax-m2.7:cloud';
  
  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const responseText = data.response || JSON.stringify(data);

    // Log the AI response (fire-and-forget).
    appendSessionEvent({
      session_id: session.session_id,
      timestamp: new Date().toISOString(),
      article_id: articleId,
      article_path: articlePath,
      sender: 'Corvus',
      message_type: 'response',
      content: responseText,
      event: 'message'
    });

    res.json({ response: responseText });
  } catch (e) {
    const errMsg = `Error contacting Corvus: ${e.message}\n\nOllama may not be running on port 11434.`;
    // Log the error response so we don't lose the round-trip from training data.
    appendSessionEvent({
      session_id: session.session_id,
      timestamp: new Date().toISOString(),
      article_id: articleId,
      article_path: articlePath,
      sender: 'Corvus',
      message_type: 'error',
      content: errMsg,
      event: 'message'
    });
    res.json({ response: errMsg });
  }
});

// === Session retrieval endpoints ================================================
// These let the dashboard (or any future tooling) read back the captured
// sessions. Read-only, admin-style, synchronous because the volume is small.

app.get('/api/sessions/latest', (req, res) => {
  try {
    const events = readAllSessionLogs();
    if (events.length === 0) {
      return res.json({ session: null, message_count: 0 });
    }
    // Group by session_id, then take the most recently active one.
    const bySession = new Map();
    for (const ev of events) {
      if (!ev.session_id) continue;
      if (!bySession.has(ev.session_id)) {
        bySession.set(ev.session_id, { session_id: ev.session_id, article_id: ev.article_id, article_path: ev.article_path, started_at: ev.timestamp, messages: [], last_activity: ev.timestamp });
      }
      const s = bySession.get(ev.session_id);
      s.messages.push(ev);
      if (ev.timestamp > s.last_activity) s.last_activity = ev.timestamp;
    }
    const sessions = Array.from(bySession.values()).sort((a, b) => b.last_activity.localeCompare(a.last_activity));
    const latest = sessions[0];
    if (!latest) return res.json({ session: null, message_count: 0 });
    res.json({
      session: {
        session_id: latest.session_id,
        article_id: latest.article_id,
        article_path: latest.article_path,
        started_at: latest.started_at,
        last_activity: latest.last_activity,
        message_count: latest.messages.length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sessions/:article_id', (req, res) => {
  try {
    const target = req.params.article_id;
    const events = readAllSessionLogs();
    const matching = events.filter(ev => ev.article_id === target);
    // Group into sessions, oldest first
    const bySession = new Map();
    for (const ev of matching) {
      if (!bySession.has(ev.session_id)) {
        bySession.set(ev.session_id, { session_id: ev.session_id, article_id: ev.article_id, article_path: ev.article_path, started_at: ev.timestamp, last_activity: ev.timestamp, messages: [] });
      }
      const s = bySession.get(ev.session_id);
      s.messages.push(ev);
      if (ev.timestamp > s.last_activity) s.last_activity = ev.timestamp;
    }
    const sessions = Array.from(bySession.values()).sort((a, b) => a.started_at.localeCompare(b.started_at));
    res.json({ article_id: target, session_count: sessions.length, message_count: matching.length, sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// === /Session retrieval endpoints ===============================================

// List all video scripts from Content Adapted
app.get('/api/scripts', (req, res) => {
  try {
    const scripts = [];
    if (fs.existsSync(ADAPTED_DIR)) {
      const entries = fs.readdirSync(ADAPTED_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const datePath = path.join(ADAPTED_DIR, entry.name);
          const draftDirs = fs.readdirSync(datePath).filter(f => f.startsWith('draft-'));
          for (const draftDir of draftDirs) {
            const draftPath = path.join(datePath, draftDir);
            const files = fs.readdirSync(draftPath).filter(f => f.includes('youtube') && f.endsWith('.md'));
            for (const file of files) {
              const fullPath = path.join(draftPath, file);
              const stat = fs.statSync(fullPath);
              const raw = fs.readFileSync(fullPath, 'utf8');
              const fm = parseFrontmatter(raw);
              scripts.push({
                path: path.join(entry.name, draftDir, file),
                name: draftDir + '/' + file.replace('.md', ''),
                date: entry.name,
                mtime: stat.mtime,
                sourceDraft: fm.source_draft || '',
                platform: fm.platform || '',
                contentType: 'video-script'
              });
            }
          }
        }
      }
    }
    scripts.sort((a, b) => b.date.localeCompare(a.date) || b.mtime - a.mtime);
    res.json(scripts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read a video script
app.get(/\/api\/script\/(.+)/, (req, res) => {
  const scriptPath = req.params[0];
  const fullPath = path.join(ADAPTED_DIR, scriptPath);
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ content, path: scriptPath });
  } catch (e) {
    res.status(404).json({ error: 'Script not found' });
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Corvus Dashboard running at http://localhost:${PORT}`);
  console.log(`Drafts directory: ${DRAFTS_DIR}`);
  console.log(`Adapted directory: ${ADAPTED_DIR}`);
});