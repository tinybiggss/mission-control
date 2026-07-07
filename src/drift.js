/**
 * Mission Control Phase 4 — Drift Meter
 *
 * Chronic postponement ([↩:: N] counters) is the vault's clearest behavioral
 * signal: the weekly review keeps flagging the same ↩20+ items in prose
 * ("they need either a real date or formal drop"). This module puts that
 * decision one click away:
 *
 *   set-due   → replace/insert 📅 date on the task's line
 *   delegate  → #assigned-mike → #assigned-corvus + a capture-queue
 *               discussion_item so it comes up at the next standup
 *   drop      → - [ ] → - [-] (Obsidian Tasks "cancelled") + ❌ date stamp
 *
 * Edits target the NEWEST daily note (Week and Daily Plans/YYYY-MM-DD.md) —
 * the system of record task-rollover.py reads to build tomorrow. Matching is
 * by cleaned title prefix (metadata like the ↩ counter drifts between the
 * sidecar and the live note); zero or multiple matches refuse to write.
 * Writes are temp+rename on a git-backed vault with .backup siblings.
 *
 * Endpoints: GET /api/mission/drift · POST /api/mission/drift/action
 */

const fs = require("fs");
const path = require("path");

const { cleanTaskText, readLatestTaskData } = require("./focus");
const { buildCaptureEntry, appendCapture } = require("./dispatch");

const VAULT_ROOT = "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space";
const DAILY_NOTES_DIR = path.join(VAULT_ROOT, "Week and Daily Plans");
const TASK_DATA_DIR = path.join(VAULT_ROOT, "Corvus", "Task Data");
const QUEUE_FILE = "/Users/michaeljones/.openclaw/workspace/Corvus/Operations/capture-queue.json";

const DRIFT_MIN = 10; // ↩ count at which a task is "drifting"
const TITLE_KEY_LEN = 40;

const ACTIONS = ["set-due", "delegate", "drop"];

// ============================================================================
// PURE LINE SURGERY
// ============================================================================

function titleKeyFor(taskText) {
  return cleanTaskText(taskText).toLowerCase().slice(0, TITLE_KEY_LEN);
}

const OPEN_CHECKBOX_RE = /^\s*- \[ \]/;

function findTaskLine(noteContent, titleKey) {
  if (!titleKey) return { error: "not-found" };
  const lines = String(noteContent).split("\n");
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_CHECKBOX_RE.test(lines[i])) continue;
    if (titleKeyFor(lines[i].replace(OPEN_CHECKBOX_RE, "")).startsWith(titleKey)) {
      matches.push(i);
    }
  }
  if (matches.length === 0) return { error: "not-found" };
  if (matches.length > 1) return { error: "ambiguous" };
  return { index: matches[0], line: lines[matches[0]] };
}

const DUE_RE = /📅\s*\d{4}-\d{2}-\d{2}/u;

function applyAction(line, action, opts = {}) {
  if (action === "set-due") {
    if (DUE_RE.test(line)) return line.replace(DUE_RE, `📅 ${opts.due}`);
    // Insert before the first marker (↩ counter or tag) to keep Tasks-plugin
    // field order readable; append if the line has no markers at all.
    const m = line.match(/\s(\[↩|#)/u);
    if (m) return line.slice(0, m.index) + ` 📅 ${opts.due}` + line.slice(m.index);
    return `${line} 📅 ${opts.due}`;
  }
  if (action === "delegate") {
    if (/#assigned-corvus\b/.test(line)) return line;
    if (/#assigned-mike\b/.test(line)) return line.replace(/#assigned-mike\b/, "#assigned-corvus");
    return `${line} #assigned-corvus`;
  }
  if (action === "drop") {
    return line.replace(OPEN_CHECKBOX_RE, (cb) => cb.replace("- [ ]", "- [-]")) + ` ❌ ${opts.today}`;
  }
  return line;
}

// ============================================================================
// NOTE IO + LIST
// ============================================================================

function newestDailyNote(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function listDrifting(readTasks) {
  try {
    const data = readTasks();
    return ((data && data.tasks) || [])
      .filter(
        (t) => t && !t.is_completed && (t.postpone || 0) >= DRIFT_MIN && cleanTaskText(t.text),
      )
      .map((t) => ({
        text: cleanTaskText(t.text),
        postpone: t.postpone || 0,
        due: t.due || null,
        project: t.project || "Uncategorized",
        priority: t.priority || null,
        assigned: t.assigned || null,
      }))
      .sort((a, b) => b.postpone - a.postpone);
  } catch {
    return [];
  }
}

function runDriftAction(deps, { task, action, due }) {
  const noteDir = deps.noteDir || DAILY_NOTES_DIR;
  const queueFile = deps.queueFile || QUEUE_FILE;
  const today = deps.today || todayISO();

  if (!ACTIONS.includes(action)) return { ok: false, status: 400, error: "unknown action" };
  if (typeof task !== "string" || !task.trim()) {
    return { ok: false, status: 400, error: "task is required" };
  }
  if (action === "set-due" && !/^\d{4}-\d{2}-\d{2}$/.test(String(due || ""))) {
    return { ok: false, status: 400, error: "set-due requires due=YYYY-MM-DD" };
  }

  const noteFile = newestDailyNote(noteDir);
  if (!noteFile) return { ok: false, status: 404, error: "no daily note found" };

  const content = fs.readFileSync(noteFile, "utf8");
  const found = findTaskLine(content, titleKeyFor(task));
  if (found.error) {
    return {
      ok: false,
      status: found.error === "ambiguous" ? 409 : 404,
      error:
        found.error === "ambiguous"
          ? "matches more than one open task line — edit in Obsidian"
          : "task line not found in the newest daily note — it may have moved",
    };
  }

  const newLine = applyAction(found.line, action, { due, today });
  const lines = content.split("\n");
  lines[found.index] = newLine;
  const tmp = noteFile + ".tmp";
  fs.writeFileSync(tmp, lines.join("\n"));
  fs.renameSync(tmp, noteFile);

  if (action === "delegate") {
    // Surface the handoff at the next standup rather than silently reassigning.
    appendCapture(
      queueFile,
      buildCaptureEntry({
        intent: "capture",
        text: `Mike delegated this task to Corvus via the Drift Meter: ${cleanTaskText(task)}`,
        context: "drift-meter",
      }),
    );
  }

  return { ok: true, file: noteFile, before: found.line, after: newLine };
}

// ============================================================================
// HTTP (no cache — list is cheap and actions must read fresh)
// ============================================================================

function createDriftAPI(deps = {}) {
  const readTasks = deps.readTasks || (() => readLatestTaskData(TASK_DATA_DIR));

  return {
    list(req, res) {
      const tasks = listDrifting(readTasks);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tasks, driftMin: DRIFT_MIN, asOf: new Date().toISOString() }, null, 2));
    },

    /**
     * POST /api/mission/drift/action   { task, action: set-due|delegate|drop, due? }
     */
    action(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const result = runDriftAction(deps, parsed);
          res.writeHead(result.ok ? 200 : result.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },
  };
}

module.exports = {
  titleKeyFor,
  findTaskLine,
  applyAction,
  newestDailyNote,
  listDrifting,
  runDriftAction,
  createDriftAPI,
};
