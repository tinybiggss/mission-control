/**
 * Mission Control Phase C — Projects
 *
 * A live registry of Mike's real dev projects, read straight from the
 * PROJECT-MEMORY.json convention files (not the promote-to-project registry,
 * which is a different thing — see mission-control.js). For each project:
 *
 *   - status         (project.status | current_status | current_phase)
 *   - latest change  (newest changelog / update_history entry, by date)
 *   - open tasks      (sibling TASKS.md unchecked lines)
 *   - last activity   (newest Claude Code transcript mtime for that dir)
 *
 * Sorted most-recently-worked first, so the top of the panel is what's warm.
 *
 * Schemas differ across projects (some use `changelog`, some `update_history`;
 * some `status`, some `current_phase`) so every field is read defensively.
 *
 * Endpoint: GET /api/mission/dev-projects
 */

const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME || "/Users/michaeljones";
const DEV_DIR = path.join(HOME, "Dev");
const CC_PROJECTS_DIR = path.join(HOME, ".claude", "projects");

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 5 * 60 * 1000; // 5 min — globbing 6 file trees isn't free

// ============================================================================
// HELPERS
// ============================================================================

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Encode an absolute dir path the way Claude Code names its project dirs:
 *  both "/" and "_" become "-". The leading "/" already yields the leading "-",
 *  so do NOT prepend another (that was the "--Users-…" double-dash bug). */
function encodeCcDir(absPath) {
  return absPath.replace(/[/_]/g, "-");
}

/** Newest *.jsonl transcript mtime in the project's Claude Code dir (exact dir,
 *  not worktree variants). Returns ms epoch or null. */
function lastClaudeActivity(projectDir) {
  const encoded = encodeCcDir(projectDir);
  const dir = path.join(CC_PROJECTS_DIR, encoded);
  if (!fs.existsSync(dir)) return null;
  let newest = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const st = fs.statSync(path.join(dir, f));
      if (newest == null || st.mtimeMs > newest) newest = st.mtimeMs;
    }
  } catch {
    /* ignore */
  }
  return newest;
}

/** Pull the newest changelog-ish entry (by date) and reduce it to a label. */
function latestChange(pm) {
  const arr = pm.changelog || pm.update_history || pm.history || [];
  if (!Array.isArray(arr) || !arr.length) return null;
  let best = arr[0];
  for (const e of arr) {
    if (e && typeof e === "object" && (e.date || "") > (best.date || "")) best = e;
  }
  if (typeof best === "string") return { date: null, label: best };
  const label =
    best.summary ||
    best.milestone ||
    best.session ||
    best.reason ||
    (Array.isArray(best.changes) ? best.changes[0] : null) ||
    "";
  return { date: best.date || null, label: String(label).slice(0, 200) };
}

/** Count + sample OPEN tasks from a sibling TASKS.md. Mike's TASKS.md files use
 *  two conventions, so handle both:
 *   1. `- [ ] task` checkboxes (daily-note style)
 *   2. markdown status tables where a row's status cell is ⏳/Pending/In-Progress/
 *      Blocked (and NOT ✅/Done) — the PROJECT-MEMORY convention. */
function readTasksMd(dir, sample = 4) {
  const p = path.join(dir, "TASKS.md");
  if (!fs.existsSync(p)) return { count: 0, items: [], hasFile: false };
  let content = "";
  try {
    content = fs.readFileSync(p, "utf8");
  } catch {
    return { count: 0, items: [], hasFile: true };
  }
  const items = [];
  let count = 0;
  const pushItem = (label) => {
    if (items.length < sample && label) items.push(String(label).slice(0, 120));
  };
  for (const line of content.split("\n")) {
    // 1) checkbox form
    const cb = line.match(/^\s*-\s*\[ \]\s+(.*)$/);
    if (cb) {
      count++;
      pushItem(cb[1].trim());
      continue;
    }
    // 2) table-row form
    if (/^\s*\|/.test(line) && !/^\s*\|[-:\s|]+\|?\s*$/.test(line)) {
      // Strip markdown emphasis (_*) so "complete_" still matches \bcomplete\b.
      const lower = line.toLowerCase().replace(/[_*]/g, " ");
      const done =
        line.includes("✅") ||
        /\b(done|fixed|resolved|deployed|shipped|complete|nothing pending|n\/a)\b/.test(lower);
      const open =
        line.includes("⏳") || line.includes("🚧") || /in progress|pending|to ?do|blocked/.test(lower);
      if (open && !done) {
        count++;
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        // cell[0] is usually a short ID (e.g. "MK4"); the task label is cell[1].
        pushItem(cells[1] || cells[0]);
      }
    }
  }
  return { count, items, hasFile: true };
}

// ============================================================================
// COMPUTE
// ============================================================================

function computeProjects() {
  const projects = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(DEV_DIR, { withFileTypes: true });
  } catch (e) {
    console.error("[projects] cannot read Dev dir:", e.message);
    return { projects: [], asOf: new Date().toISOString() };
  }

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(DEV_DIR, d.name);
    const pmPath = path.join(dir, "PROJECT-MEMORY.json");
    if (dir.includes("/.worktrees/") || dir.includes("/.claude/")) continue;
    if (!fs.existsSync(pmPath)) continue;

    const pm = safeReadJson(pmPath);
    if (!pm) continue;
    const proj = pm.project || {};
    const status = proj.status || proj.current_status || proj.current_phase || "—";
    const change = latestChange(pm);
    const tasks = readTasksMd(dir);
    const activityMs = lastClaudeActivity(dir);

    projects.push({
      name: proj.full_name || proj.name || d.name,
      dir,
      slug: d.name,
      status: String(status).slice(0, 160),
      version: proj.version || null,
      latestChange: change,
      tasks,
      lastActivity: activityMs ? new Date(activityMs).toISOString() : null,
      lastActivityMs: activityMs || 0,
      obsidianDir: dir, // for an "open in editor" link
    });
  }

  // Most-recently-worked first; projects with no CC activity sink to the bottom.
  projects.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  projects.forEach((p) => delete p.lastActivityMs);

  return { projects, count: projects.length, asOf: new Date().toISOString() };
}

// ============================================================================
// CACHE + HTTP
// ============================================================================

function refreshProjectsAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeProjects();
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[projects] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getProjectsCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshProjectsAsync();
  }
  return cache.data || computeProjects();
}

function createProjectsAPI(_deps = {}) {
  return {
    list(req, res) {
      const data = getProjectsCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { createProjectsAPI, getProjectsCached, refreshProjectsAsync, computeProjects };
