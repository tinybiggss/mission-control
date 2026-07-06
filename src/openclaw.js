/**
 * OpenClaw CLI helpers - wrappers for running openclaw commands
 */

const { execFileSync, execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// CLI availability gate + circuit breaker
//
// The `openclaw` CLI depends on a valid OAuth token. When it's expired every
// call fails, and the old code re-shelled on a 10s/60s timer forever — that's
// the 11,290 failures + 1,022 min of wasted CPU + multi-MB server.err the audit
// found. This gate makes callers no-op instead:
//   - `cliEnabled` is set from config at startup (default false on this box).
//   - After MAX_FAILURES consecutive failures the circuit opens for COOLDOWN_MS,
//     logging ONCE, then half-opens for a single probe so it self-heals if auth
//     is later restored.
// ---------------------------------------------------------------------------
let cliEnabled = true; // overridden by setCliEnabled() from config at startup
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let loggedOpen = false;
const MAX_FAILURES = 3;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function setCliEnabled(enabled) {
  cliEnabled = !!enabled;
}

/** True when a caller may attempt an openclaw invocation right now. */
function isCliAvailable() {
  if (!cliEnabled) return false;
  if (circuitOpenUntil && Date.now() < circuitOpenUntil) return false;
  return true; // includes the half-open probe window after a cooldown
}

function recordCliSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  loggedOpen = false;
}

function recordCliFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_FAILURES) {
    circuitOpenUntil = Date.now() + COOLDOWN_MS;
    if (!loggedOpen) {
      console.error(
        `[OpenClaw] CLI unavailable after ${consecutiveFailures} consecutive failures — ` +
          `backing off ${COOLDOWN_MS / 60000}m (token likely expired). Further errors silenced.`,
      );
      loggedOpen = true;
    }
  }
}

/**
 * Build a minimal env for child processes.
 * Avoids leaking secrets (API keys, cloud creds) to shell subprocesses.
 */
function getSafeEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    NO_COLOR: "1",
    TERM: "dumb",
    OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE || "",
    OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE || "",
    OPENCLAW_HOME: process.env.OPENCLAW_HOME || "",
  };
}

/**
 * Build args array for openclaw CLI, prepending --profile if set.
 * Splits the args string on whitespace (shell-injection-safe since
 * execFileSync never invokes a shell).
 */
function buildArgs(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileArgs = profile ? ["--profile", profile] : [];
  // Strip shell redirections (e.g. "2>&1", "2>/dev/null") — not needed with execFile
  const cleanArgs = args
    .replace(/\s*2>&1\s*/g, " ")
    .replace(/\s*2>\/dev\/null\s*/g, " ")
    .trim();
  return [...profileArgs, ...cleanArgs.split(/\s+/).filter(Boolean)];
}

/**
 * Run openclaw CLI command synchronously
 * Uses execFileSync (no shell) to eliminate injection surface.
 * @param {string} args - Command arguments
 * @returns {string|null} - Command output or null on error
 */
function runOpenClaw(args) {
  if (!isCliAvailable()) return null;
  try {
    const result = execFileSync("openclaw", buildArgs(args), {
      encoding: "utf8",
      timeout: 3000,
      env: getSafeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    recordCliSuccess();
    return result;
  } catch (e) {
    recordCliFailure();
    return null;
  }
}

/**
 * Run openclaw CLI command asynchronously
 * Uses execFile (no shell) to eliminate injection surface.
 * @param {string} args - Command arguments
 * @returns {Promise<string|null>} - Command output or null on error
 */
async function runOpenClawAsync(args) {
  if (!isCliAvailable()) return null;
  try {
    const { stdout } = await execFileAsync("openclaw", buildArgs(args), {
      encoding: "utf8",
      timeout: 20000,
      env: getSafeEnv(),
    });
    recordCliSuccess();
    return stdout;
  } catch (e) {
    recordCliFailure(); // logs once when the circuit opens; no per-call spam
    return null;
  }
}

/**
 * Extract JSON from openclaw output (may have non-JSON prefix)
 * @param {string} output - Raw CLI output
 * @returns {string|null} - JSON string or null
 */
function extractJSON(output) {
  if (!output) return null;
  const jsonStart = output.search(/[[{]/);
  if (jsonStart === -1) return null;
  return output.slice(jsonStart);
}

module.exports = {
  runOpenClaw,
  runOpenClawAsync,
  extractJSON,
  getSafeEnv,
  setCliEnabled,
  isCliAvailable,
  recordCliSuccess,
  recordCliFailure,
};
