/**
 * Mission Control Phase 2 — Brain Dump ↔ Obsidian Tasks Integration
 *
 * Provides bidirectional sync between Mission Control JSON cards
 * and Obsidian markdown daily note tasks.
 *
 * New endpoints under /api/mc/:
 *   POST /api/mc/promote          → create/update MD task from JSON card
 *   GET  /api/mc/kanban/:column   → return cards with obsidianRef joined
 *   PATCH /api/mc/card/:id        → partial update (sync to MD if linked)
 *   DELETE /api/mc/card/:id       → soft delete (sync to MD if linked)
 *   POST /api/mc/rollover         → invoke task-rollover.py
 *   POST /api/mc/sync-from-obsidian → file-watch callback (Phase 2.5)
 *
 * Also: task cleanup, project auto-link mapping, velocity cap tracking.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ============================================================================
// CONFIGURATION
// ============================================================================

const VAULT_DIR = path.join(
  process.env.HOME || "/Users/michaeljones",
  "Dev/Obsidian/Mike_Thinking_Space"
);
const DAILY_PLANS_DIR = path.join(VAULT_DIR, "Week and Daily Plans");
const ROLLOVER_SCRIPT = path.join(VAULT_DIR, "Scripts/task-rollover.py");

/** Top-level project → vault wiki-link mapping (Mike's explicit decision) */
const TOP_LEVEL_PROJECT_LINKS = {
  apollo: "[[Apollo Media Server]]",
  rt: "[[Resilient Tomorrow]]",
  vp: "[[Velocity Partners]]",
  corvus: "[[Corvus]]",
  ghn: "[[GHN]]",
  distills: "[[Distills]]",
};

/** Sub-projects → use Projects/{slug}/ path */
const SUB_PROJECT_LINKS = {
  solar: "[[Projects/solar/Solar Build Plan]]",
  neighborhoodshare: "[[Projects/solar/Solar Build Plan]]", // alias
};

const VELOCITY_CAP_DEFAULT = 5;
const AUTO_ARCHIVE_DAYS = 60;

// ============================================================================
// HELPERS
// ============================================================================

function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[mc-phase2] Failed to read ${filePath}: ${e.message}`);
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error(`[mc-phase2] Failed to write ${filePath}: ${e.message}`);
    return false;
  }
}

function readBrainDump(dataDir) {
  ensureDataDir(dataDir);
  return safeReadJson(path.join(dataDir, "brain-dump.json"), []);
}

function writeBrainDump(dataDir, tasks) {
  ensureDataDir(dataDir);
  return safeWriteJson(path.join(dataDir, "brain-dump.json"), tasks);
}

/**
 * Generate a nanoid-style 6-char alphanumeric ID.
 * Not cryptographically secure but fine for block IDs.
 */
function generateBlockId() {
  return Array.from({ length: 6 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
  ).join("");
}

/**
 * Resolve project tags to Obsidian wiki-links.
 * Mike's decision: top-level projects get top-level links, sub-projects use Projects/ path.
 */
function resolveProjectLinks(tags) {
  const links = [];
  const unknown = [];
  for (const tag of tags || []) {
    const key = tag.toLowerCase().replace(/^#/, "");
    if (TOP_LEVEL_PROJECT_LINKS[key]) {
      links.push(TOP_LEVEL_PROJECT_LINKS[key]);
    } else if (SUB_PROJECT_LINKS[key]) {
      links.push(SUB_PROJECT_LINKS[key]);
    } else {
      unknown.push(tag);
    }
  }
  return { links, unknown };
}

/**
 * Get today's date as YYYY-MM-DD in America/Los_Angeles
 */
function getTodayDate() {
  const d = new Date();
  const offset = d.getTimezoneOffset(); // minutes from UTC
  const laOffset = 420; // PDT = UTC-7 = 420 min
  const adjusted = new Date(d.getTime() - (offset - laOffset) * 60000);
  return adjusted.toISOString().slice(0, 10);
}

/**
 * Ensure the daily note file exists; create with frontmatter if needed.
 */
function ensureDailyNote(dateStr) {
  const filePath = path.join(DAILY_PLANS_DIR, `${dateStr}.md`);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  // Create with basic frontmatter
  const content = `---
title: "${dateStr}"
accessed_by: "mission-control"
---

## Today's Focus

## By Project

## Notes

`;
  fs.mkdirSync(DAILY_PLANS_DIR, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Build markdown task line from card + column mapping.
 * Returns: { mdLine, blockId }
 */
function buildMarkdownTask(card, column) {
  const blockId = card.blockId || `task-${generateBlockId()}`;
  const dateStr = getTodayDate();

  // Build task text
  let text = card.title || card.rawText || "Untitled task";

  // Add project links
  const { links, unknown } = resolveProjectLinks(card.tags);
  if (links.length > 0) {
    text += " " + links.join(" ");
  }
  if (unknown.length > 0) {
    text += " " + unknown.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  }

  // Add assignee tag if present
  if (card.assignee) {
    text += ` #assigned-${card.assignee}`;
  }

  // Add priority emoji based on column
  let priorityEmoji = "";
  if (column === "do-first" || column === "urgent-important") priorityEmoji = "🔺";
  else if (column === "schedule" || column === "important-not-urgent") priorityEmoji = "⏫";
  else if (column === "icebox") priorityEmoji = "🧊";
  else if (column === "delegate" || column === "urgent-not-important") priorityEmoji = "🔼";

  if (priorityEmoji) {
    text += ` ${priorityEmoji}`;
  }

  // Add due date if column implies scheduling
  if (column === "do-first" || column === "urgent-important") {
    text += ` 📅 ${dateStr}`;
  } else if (column === "schedule" || column === "important-not-urgent") {
    // Due in 3 days
    const due = new Date();
    due.setDate(due.getDate() + 3);
    text += ` 📅 ${due.toISOString().slice(0, 10)}`;
  }

  // Add creation date
  text += ` ➕ ${dateStr}`;

  // Add postpone count if any
  if (card.postponeCount && card.postponeCount > 0) {
    text += ` [↩:: ${card.postponeCount}]`;
  }

  // Block ID for joining
  text += ` ^${blockId}`;

  const mdLine = `- [ ] ${text}`;
  return { mdLine, blockId, filePath: ensureDailyNote(dateStr) };
}

/**
 * Append a markdown task line to the daily note, under the right section.
 * Returns: { ok, obsidianRef, mdLine, blockId }
 */
function appendMarkdownTask(card, column) {
  const { mdLine, blockId, filePath } = buildMarkdownTask(card, column);

  try {
    let content = fs.readFileSync(filePath, "utf8");

    // Find or create the "By Project" section
    const sectionMatch = content.match(/\n## By Project\s*\n/);
    if (!sectionMatch) {
      // Append at end
      content += `\n\n### ${card.project || "General"}\n${mdLine}\n`;
    } else {
      // Insert under By Project, grouped by project if known
      const insertIdx = sectionMatch.index + sectionMatch[0].length;
      const projectName = card.project || "General";
      // Look for existing project subsection
      const projectRe = new RegExp(`\\n#### ${projectName}\\s*\\n`);
      const projMatch = content.match(projectRe);

      if (projMatch) {
        // Insert after last task in this subsection
        const afterProj = projMatch.index + projMatch[0].length;
        const nextSection = content.indexOf("\n#### ", afterProj);
        const insertPoint = nextSection === -1 ? content.length : nextSection;
        content = content.slice(0, insertPoint) + mdLine + "\n" + content.slice(insertPoint);
      } else {
        // Create new subsection
        const afterSection = content.indexOf("\n", insertIdx) + 1;
        const insertion = `\n#### ${projectName}\n${mdLine}\n`;
        content = content.slice(0, afterSection) + insertion + content.slice(afterSection);
      }
    }

    fs.writeFileSync(filePath, content, "utf8");

    const obsidianRef = `[[${path.basename(filePath, ".md")}#^${blockId}]]`;
    return { ok: true, obsidianRef, mdLine, blockId };
  } catch (e) {
    console.error(`[mc-phase2] Failed to write MD task: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Mark a markdown task as cancelled by replacing the checkbox.
 */
function cancelMarkdownTask(obsidianRef) {
  if (!obsidianRef) return { ok: false, error: "No obsidianRef" };

  try {
    // Parse [[YYYY-MM-DD#^task-xxxx]] → file = YYYY-MM-DD.md, blockId = task-xxxx
    const match = obsidianRef.match(/\[\[(\d{4}-\d{2}-\d{2})#\^(task-[a-z0-9]{6})\]\]/);
    if (!match) return { ok: false, error: "Invalid obsidianRef format" };

    const [, dateStr, blockId] = match;
    const filePath = path.join(DAILY_PLANS_DIR, `${dateStr}.md`);
    if (!fs.existsSync(filePath)) return { ok: false, error: "File not found" };

    let content = fs.readFileSync(filePath, "utf8");
    const taskRe = new RegExp(`^- \\[ \\][^\n]*\\^${blockId}$`, "gm");
    const replaced = content.replace(taskRe, (line) => {
      return line.replace("- [ ]", "- [~]").replace(/\^task-[a-z0-9]{6}$/, "~cancelled~ $&");
    });

    if (replaced === content) {
      return { ok: false, error: "Task not found in markdown" };
    }

    fs.writeFileSync(filePath, replaced, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Update markdown task fields (title, due, assignee) when JSON card is edited.
 */
function updateMarkdownTask(obsidianRef, updates) {
  if (!obsidianRef) return { ok: false, error: "No obsidianRef" };

  try {
    const match = obsidianRef.match(/\[\[(\d{4}-\d{2}-\d{2})#\^(task-[a-z0-9]{6})\]\]/);
    if (!match) return { ok: false, error: "Invalid obsidianRef format" };

    const [, dateStr, blockId] = match;
    const filePath = path.join(DAILY_PLANS_DIR, `${dateStr}.md`);
    if (!fs.existsSync(filePath)) return { ok: false, error: "File not found" };

    let content = fs.readFileSync(filePath, "utf8");
    const taskRe = new RegExp(`^- \\[ \\][^\n]*\\^${blockId}$`, "gm");
    let modified = false;

    const replaced = content.replace(taskRe, (line) => {
      let newLine = line;

      // Update title (everything between `- [ ] ` and first tag/emoji/date)
      if (updates.title) {
        // Naive: replace the text part before any metadata
        const metaRe = /(#\w+|\[\[|📅|➕|🔺|⏫|🔼|🧊|\[↩)/;
        const metaIdx = newLine.search(metaRe);
        const prefix = newLine.slice(0, "- [ ] ".length);
        const suffix = metaIdx === -1 ? "" : newLine.slice(metaIdx);
        newLine = `${prefix}${updates.title}${suffix}`;
      }

      // Update due date
      if (updates.due) {
        newLine = newLine.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `📅 ${updates.due}`);
      }

      // Update assignee tag
      if (updates.assignee !== undefined) {
        newLine = newLine.replace(/#assigned-\w+/g, "");
        if (updates.assignee) {
          newLine = newLine.replace(/\^task-/, ` #assigned-${updates.assignee} ^`);
        }
      }

      modified = true;
      return newLine;
    });

    if (!modified) return { ok: false, error: "Task not found" };

    fs.writeFileSync(filePath, replaced, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// TASK CLEANUP
// ============================================================================

/**
 * Tier 1 auto-archive: stale tasks (>60 days, no due date, no priority).
 * Returns: { archived: count, items: [...] }
 */
function autoArchiveStale(dataDir) {
  const tasks = readBrainDump(dataDir);
  const now = Date.now();
  const staleCutoff = now - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  const archived = [];
  const remaining = [];

  for (const t of tasks) {
    const created = new Date(t.createdAt || "1970-01-01").getTime();
    const isStale = created < staleCutoff;
    const hasDue = t.due || (t.tags || []).some((tag) => tag.match(/📅|📆/));
    const hasPriority = t.priority && t.priority !== "neither";
    const hasHighPriority = (t.tags || []).some((tag) =>
      ["🔺", "⏫"].includes(tag)
    );

    if (isStale && !hasDue && !hasPriority && !hasHighPriority && t.status !== "done") {
      // Mark as archived
      t.status = "archived";
      t.archivedAt = new Date().toISOString();
      t.archiveReason = "auto: stale (60+ days, no due, no priority)";
      archived.push(t);
    } else {
      remaining.push(t);
    }
  }

  if (archived.length > 0) {
    writeBrainDump(dataDir, remaining);
  }

  return { archived: archived.length, items: archived };
}

/**
 * Mark tasks that are done in JSON but still open (shouldn't happen often).
 */
function syncDoneStatus(dataDir) {
  const tasks = readBrainDump(dataDir);
  let fixed = 0;
  for (const t of tasks) {
    if (t.status === "done" && !t.completedAt) {
      t.completedAt = new Date().toISOString();
      fixed++;
    }
  }
  if (fixed > 0) writeBrainDump(dataDir, tasks);
  return { fixed };
}

// ============================================================================
// VELOCITY CAP
// ============================================================================

/**
 * Read velocity cap config.
 */
function readVelocityConfig(dataDir) {
  return safeReadJson(path.join(dataDir, "velocity-config.json"), {
    defaultCap: VELOCITY_CAP_DEFAULT,
    perProject: {},
  });
}

/**
 * Count open tasks per project from JSON cards.
 */
function countByProject(dataDir) {
  const tasks = readBrainDump(dataDir);
  const counts = {};
  for (const t of tasks) {
    if (t.status === "done" || t.status === "archived") continue;
    const project = t.project || "uncategorized";
    counts[project] = (counts[project] || 0) + 1;
  }
  return counts;
}

/**
 * Check velocity caps. Returns: { exceeded: [{ project, count, cap }], all: {} }
 */
function checkVelocityCap(dataDir) {
  const config = readVelocityConfig(dataDir);
  const counts = countByProject(dataDir);
  const exceeded = [];

  for (const [project, count] of Object.entries(counts)) {
    const cap = config.perProject[project] || config.defaultCap;
    if (count > cap) {
      exceeded.push({ project, count, cap });
    }
  }

  return { exceeded, all: counts, config };
}

// ============================================================================
// ROLLOVER
// ============================================================================

/**
 * Invoke task-rollover.py and return the result.
 */
function invokeRollover(dateStr = null) {
  return new Promise((resolve) => {
    const args = [ROLLOVER_SCRIPT];
    if (dateStr) args.push("--date", dateStr);

    const child = spawn("python3", args, {
      cwd: VAULT_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

/**
 * Create Phase 2 API handlers.
 * @param {object} deps
 * @param {function} deps.getOpenClawDir
 * @param {string} [deps.dataDir]
 */
function createPhase2API(deps) {
  const { getOpenClawDir } = deps;
  const dataDir = deps.dataDir || path.join(
    process.env.HOME || "/Users/michaeljones",
    ".openclaw/workspace/mission-control"
  );
  ensureDataDir(dataDir);

  return {
    /**
     * POST /api/mc/promote
     * Body: { cardId, column }
     * Creates/updates MD task, returns { obsidianRef, mdLine, blockId }
     */
    promote(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { cardId, column } = JSON.parse(body);
          if (!cardId || !column) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "cardId and column are required" }));
            return;
          }

          const tasks = readBrainDump(dataDir);
          const card = tasks.find((t) => t.id === cardId);
          if (!card) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Card not found" }));
            return;
          }

          // Update card status
          card.status = column;
          card.updatedAt = new Date().toISOString();

          // Build and write markdown task
          const mdResult = appendMarkdownTask(card, column);
          if (!mdResult.ok) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to write markdown: " + mdResult.error }));
            return;
          }

          // Store obsidianRef on card
          card.obsidianRef = mdResult.obsidianRef;
          card.blockId = mdResult.blockId;

          writeBrainDump(dataDir, tasks);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              {
                ok: true,
                card,
                obsidianRef: mdResult.obsidianRef,
                mdLine: mdResult.mdLine,
                blockId: mdResult.blockId,
              },
              null,
              2
            )
          );
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    /**
     * GET /api/mc/kanban/:column
     * Returns cards for a kanban column, with obsidianRef joined.
     */
    kanban(req, res, column) {
      const tasks = readBrainDump(dataDir);
      const normalizedCol = column.toLowerCase().replace(/-/g, "");

      // Map column to status values
      const statusMap = {
    dofirst: ["do-first", "urgent-important", "todo"],
    schedule: ["schedule", "important-not-urgent"],
    delegate: ["delegate", "urgent-not-important"],
    icebox: ["icebox"],
    unsorted: ["unsorted", "backlog"],
    done: ["done", "archived"],
      };

      const statuses = statusMap[normalizedCol] || [column];
      const filtered = tasks.filter((t) => statuses.includes(t.status));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            column,
            cards: filtered,
            count: filtered.length,
            linkedCount: filtered.filter((c) => c.obsidianRef).length,
          },
          null,
          2
        )
      );
    },

    /**
     * PATCH /api/mc/card/:id
     * Partial update; mirror to MD if obsidianRef exists.
     */
    cardUpdate(req, res, id) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const tasks = readBrainDump(dataDir);
          const idx = tasks.findIndex((t) => t.id === id);
          if (idx === -1) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Card not found" }));
            return;
          }

          const card = tasks[idx];
          Object.assign(card, updates, { updatedAt: new Date().toISOString() });

          // Sync to markdown if linked
          if (card.obsidianRef) {
            const mdResult = updateMarkdownTask(card.obsidianRef, updates);
            if (!mdResult.ok) {
              console.warn(`[mc-phase2] MD sync failed for ${id}: ${mdResult.error}`);
            }
          }

          writeBrainDump(dataDir, tasks);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ card }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    /**
     * DELETE /api/mc/card/:id
     * Soft delete; if linked, append ~cancelled~ to MD line.
     */
    cardDelete(req, res, id) {
      const tasks = readBrainDump(dataDir);
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Card not found" }));
        return;
      }

      const card = tasks[idx];

      // Cancel in markdown if linked
      if (card.obsidianRef) {
        const mdResult = cancelMarkdownTask(card.obsidianRef);
        if (!mdResult.ok) {
          console.warn(`[mc-phase2] MD cancel failed for ${id}: ${mdResult.error}`);
        }
      }

      // Soft delete in JSON
      card.status = "archived";
      card.archivedAt = new Date().toISOString();
      card.archiveReason = "user: deleted from UI";

      writeBrainDump(dataDir, tasks);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, card }, null, 2));
    },

    /**
     * POST /api/mc/rollover
     * Invokes task-rollover.py, returns report.
     */
    async rollover(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        let dateStr = null;
        try {
          const parsed = JSON.parse(body);
          dateStr = parsed.date;
        } catch {
          // no body is fine
        }

        const result = await invokeRollover(dateStr);
        res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      });
    },

    /**
     * POST /api/mc/sync-from-obsidian
     * File-watch callback: { file, diff } → update matching JSON cards.
     * Phase 2.5 placeholder.
     */
    syncFromObsidian(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { file, diff } = JSON.parse(body);
          // Placeholder: parse diff for block IDs, update matching cards
          // Full implementation in Phase 2.5 with chokidar watcher
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              {
                ok: true,
                message: "Sync acknowledged (Phase 2.5)",
                file,
                diffLines: (diff || []).length,
              },
              null,
              2
            )
          );
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    /**
     * POST /api/mc/cleanup
     * Run Tier 1 auto-archive, sync done status.
     */
    cleanup(req, res) {
      const staleResult = autoArchiveStale(dataDir);
      const doneResult = syncDoneStatus(dataDir);
      const velocityResult = checkVelocityCap(dataDir);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            ok: true,
            autoArchived: staleResult,
            doneSynced: doneResult,
            velocity: velocityResult,
          },
          null,
          2
        )
      );
    },

    /**
     * GET /api/mc/velocity
     * Return velocity cap status per project.
     */
    velocity(req, res) {
      const result = checkVelocityCap(dataDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    },

    // Expose data dir for tests
    _dataDir: dataDir,
  };
}

module.exports = {
  createPhase2API,
  // Helpers for tests
  resolveProjectLinks,
  buildMarkdownTask,
  generateBlockId,
  getTodayDate,
  ensureDailyNote,
  autoArchiveStale,
  checkVelocityCap,
  invokeRollover,
};
