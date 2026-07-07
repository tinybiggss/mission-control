#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/utils.js
var require_utils = __commonJS({
  "src/utils.js"(exports2, module2) {
    var { exec } = require("child_process");
    var path2 = require("path");
    var { promisify } = require("util");
    var execAsync = promisify(exec);
    var pkg = require(path2.join(__dirname, "..", "package.json"));
    function getVersion2() {
      return pkg.version;
    }
    async function runCmd(cmd, options = {}) {
      const systemPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      const envPath = process.env.PATH || "";
      const opts = {
        encoding: "utf8",
        timeout: 1e4,
        env: {
          ...process.env,
          PATH: envPath.includes("/usr/sbin") ? envPath : `${systemPath}:${envPath}`
        },
        ...options
      };
      try {
        const { stdout } = await execAsync(cmd, opts);
        return stdout.trim();
      } catch (e) {
        if (options.fallback !== void 0) return options.fallback;
        throw e;
      }
    }
    function formatBytes(bytes) {
      if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
      if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
      return bytes + " B";
    }
    function formatTimeAgo(date) {
      const now = /* @__PURE__ */ new Date();
      const diffMs = now - date;
      const diffMins = Math.round(diffMs / 6e4);
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
      return `${Math.round(diffMins / 1440)}d ago`;
    }
    function formatNumber(n) {
      return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function formatTokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return n.toString();
    }
    module2.exports = {
      getVersion: getVersion2,
      runCmd,
      formatBytes,
      formatTimeAgo,
      formatNumber,
      formatTokens
    };
  }
});

// src/config.js
var require_config = __commonJS({
  "src/config.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var os = require("os");
    var HOME = os.homedir();
    function getOpenClawDir2(profile = null) {
      const effectiveProfile = profile || process.env.OPENCLAW_PROFILE || "";
      return effectiveProfile ? path2.join(HOME, `.openclaw-${effectiveProfile}`) : path2.join(HOME, ".openclaw");
    }
    function detectWorkspace() {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const openclawDir = getOpenClawDir2();
      const defaultWorkspace = path2.join(openclawDir, "workspace");
      const profileCandidates = profile ? [
        // Profile-specific workspace in home (e.g., ~/.openclaw-<profile>-workspace)
        path2.join(HOME, `.openclaw-${profile}-workspace`),
        path2.join(HOME, `.${profile}-workspace`)
      ] : [];
      const candidates = [
        // Environment variable (highest priority)
        process.env.OPENCLAW_WORKSPACE,
        // OpenClaw's default workspace location
        process.env.OPENCLAW_HOME,
        // Gateway config workspace (check early - this is where OpenClaw actually runs)
        getWorkspaceFromGatewayConfig(),
        // Profile-specific paths (if profile is set)
        ...profileCandidates,
        // Standard OpenClaw workspace location (profile-aware: ~/.openclaw/workspace or ~/.openclaw-<profile>/workspace)
        defaultWorkspace,
        // Common custom workspace names
        path2.join(HOME, "openclaw-workspace"),
        path2.join(HOME, ".openclaw-workspace"),
        // Legacy/custom names
        path2.join(HOME, "molty"),
        path2.join(HOME, "clawd"),
        path2.join(HOME, "moltbot")
      ].filter(Boolean);
      const foundWorkspace = candidates.find((candidate) => {
        if (!candidate || !fs2.existsSync(candidate)) {
          return false;
        }
        const hasMemory = fs2.existsSync(path2.join(candidate, "memory"));
        const hasState = fs2.existsSync(path2.join(candidate, "state"));
        const hasConfig = fs2.existsSync(path2.join(candidate, ".openclaw"));
        return hasMemory || hasState || hasConfig;
      });
      return foundWorkspace || defaultWorkspace;
    }
    function getWorkspaceFromGatewayConfig() {
      const openclawDir = getOpenClawDir2();
      const configPaths = [
        path2.join(openclawDir, "config.yaml"),
        path2.join(openclawDir, "config.json"),
        path2.join(openclawDir, "openclaw.json"),
        path2.join(openclawDir, "clawdbot.json"),
        // Fallback to standard XDG location
        path2.join(HOME, ".config", "openclaw", "config.yaml")
      ];
      for (const configPath of configPaths) {
        try {
          if (fs2.existsSync(configPath)) {
            const content2 = fs2.readFileSync(configPath, "utf8");
            const match = content2.match(/workspace[:\s]+["']?([^"'\n]+)/i) || content2.match(/workdir[:\s]+["']?([^"'\n]+)/i);
            if (match && match[1]) {
              const workspace = match[1].trim().replace(/^~/, HOME);
              if (fs2.existsSync(workspace)) {
                return workspace;
              }
            }
          }
        } catch (e) {
        }
      }
      return null;
    }
    function deepMerge(base, override) {
      const result = { ...base };
      for (const key of Object.keys(override)) {
        if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key]) && base[key] && typeof base[key] === "object") {
          result[key] = deepMerge(base[key], override[key]);
        } else if (override[key] !== null && override[key] !== void 0) {
          result[key] = override[key];
        }
      }
      return result;
    }
    function loadConfigFile() {
      const basePath = path2.join(__dirname, "..", "config", "dashboard.json");
      const localPath = path2.join(__dirname, "..", "config", "dashboard.local.json");
      let config = {};
      try {
        if (fs2.existsSync(basePath)) {
          const content2 = fs2.readFileSync(basePath, "utf8");
          config = JSON.parse(content2);
        }
      } catch (e) {
        console.warn(`[Config] Failed to load ${basePath}:`, e.message);
      }
      try {
        if (fs2.existsSync(localPath)) {
          const content2 = fs2.readFileSync(localPath, "utf8");
          const localConfig = JSON.parse(content2);
          config = deepMerge(config, localConfig);
          console.log(`[Config] Loaded local overrides from ${localPath}`);
        }
      } catch (e) {
        console.warn(`[Config] Failed to load ${localPath}:`, e.message);
      }
      return config;
    }
    function expandPath(p) {
      if (!p) return p;
      return p.replace(/^~/, HOME).replace(/\$HOME/g, HOME).replace(/\$\{HOME\}/g, HOME);
    }
    function loadConfig() {
      const fileConfig = loadConfigFile();
      const workspace = process.env.OPENCLAW_WORKSPACE || expandPath(fileConfig.paths?.workspace) || detectWorkspace();
      const config = {
        // Server settings
        server: {
          port: parseInt(process.env.PORT || fileConfig.server?.port || "3333", 10),
          host: process.env.HOST || fileConfig.server?.host || "localhost"
        },
        // Paths - all relative to workspace unless absolute
        paths: {
          workspace,
          memory: expandPath(process.env.OPENCLAW_MEMORY_DIR || fileConfig.paths?.memory) || path2.join(workspace, "memory"),
          state: expandPath(process.env.OPENCLAW_STATE_DIR || fileConfig.paths?.state) || path2.join(workspace, "state"),
          cerebro: expandPath(process.env.OPENCLAW_CEREBRO_DIR || fileConfig.paths?.cerebro) || path2.join(workspace, "cerebro"),
          skills: expandPath(process.env.OPENCLAW_SKILLS_DIR || fileConfig.paths?.skills) || path2.join(workspace, "skills"),
          jobs: expandPath(process.env.OPENCLAW_JOBS_DIR || fileConfig.paths?.jobs) || path2.join(workspace, "jobs"),
          logs: expandPath(process.env.OPENCLAW_LOGS_DIR || fileConfig.paths?.logs) || path2.join(HOME, ".openclaw-command-center", "logs")
        },
        // Auth settings
        auth: {
          mode: process.env.DASHBOARD_AUTH_MODE || fileConfig.auth?.mode || "none",
          token: process.env.DASHBOARD_TOKEN || fileConfig.auth?.token,
          allowedUsers: (process.env.DASHBOARD_ALLOWED_USERS || fileConfig.auth?.allowedUsers?.join(",") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
          allowedIPs: (process.env.DASHBOARD_ALLOWED_IPS || fileConfig.auth?.allowedIPs?.join(",") || "127.0.0.1,::1").split(",").map((s) => s.trim()),
          publicPaths: fileConfig.auth?.publicPaths || ["/api/health", "/api/whoami", "/favicon.ico"]
        },
        // Branding
        branding: {
          name: fileConfig.branding?.name || "OpenClaw Command Center",
          theme: fileConfig.branding?.theme || "default"
        },
        // Integrations
        integrations: {
          linear: {
            enabled: !!(process.env.LINEAR_API_KEY || fileConfig.integrations?.linear?.apiKey),
            apiKey: process.env.LINEAR_API_KEY || fileConfig.integrations?.linear?.apiKey,
            teamId: process.env.LINEAR_TEAM_ID || fileConfig.integrations?.linear?.teamId
          },
          // The `openclaw` CLI is only reachable when its OAuth token is valid.
          // On Mike's box the token is expired, so shelling out just burns CPU and
          // spams server.err. Default OFF; ollama-usage.js supplies the usage numbers.
          // Flip to true (or set OPENCLAW_CLI_ENABLED=true) once `claude setup-token`
          // / `openclaw onboard` has restored auth.
          openclawCli: {
            enabled: process.env.OPENCLAW_CLI_ENABLED != null ? process.env.OPENCLAW_CLI_ENABLED === "true" : fileConfig.integrations?.openclawCli?.enabled ?? false
          }
        },
        // Billing - for cost savings calculation
        billing: {
          claudePlanCost: parseFloat(
            process.env.CLAUDE_PLAN_COST || fileConfig.billing?.claudePlanCost || "200"
          ),
          claudePlanName: process.env.CLAUDE_PLAN_NAME || fileConfig.billing?.claudePlanName || "Claude Code Max"
        }
      };
      return config;
    }
    var CONFIG2 = loadConfig();
    console.log("[Config] Workspace:", CONFIG2.paths.workspace);
    console.log("[Config] Auth mode:", CONFIG2.auth.mode);
    module2.exports = { CONFIG: CONFIG2, loadConfig, detectWorkspace, expandPath, getOpenClawDir: getOpenClawDir2 };
  }
});

// src/jobs.js
var require_jobs = __commonJS({
  "src/jobs.js"(exports2, module2) {
    var path2 = require("path");
    var { CONFIG: CONFIG2 } = require_config();
    var JOBS_DIR = CONFIG2.paths.jobs;
    var JOBS_STATE_DIR = path2.join(CONFIG2.paths.state, "jobs");
    var apiInstance = null;
    var forceApiUnavailable = false;
    async function getAPI() {
      if (forceApiUnavailable) return null;
      if (apiInstance) return apiInstance;
      try {
        const { createJobsAPI } = await import(path2.join(JOBS_DIR, "lib/api.js"));
        apiInstance = createJobsAPI({
          definitionsDir: path2.join(JOBS_DIR, "definitions"),
          stateDir: JOBS_STATE_DIR
        });
        return apiInstance;
      } catch (e) {
        console.error("Failed to load jobs API:", e.message);
        return null;
      }
    }
    function _resetForTesting(options = {}) {
      apiInstance = null;
      forceApiUnavailable = options.forceUnavailable || false;
    }
    function formatRelativeTime(isoString) {
      if (!isoString) return null;
      const date = new Date(isoString);
      const now = /* @__PURE__ */ new Date();
      const diffMs = now - date;
      const diffMins = Math.round(diffMs / 6e4);
      if (diffMins < 0) {
        const futureMins = Math.abs(diffMins);
        if (futureMins < 60) return `in ${futureMins}m`;
        if (futureMins < 1440) return `in ${Math.round(futureMins / 60)}h`;
        return `in ${Math.round(futureMins / 1440)}d`;
      }
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
      return `${Math.round(diffMins / 1440)}d ago`;
    }
    async function handleJobsRequest2(req, res, pathname, query, method) {
      const api = await getAPI();
      if (!api) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Jobs API not available" }));
        return;
      }
      try {
        if (pathname === "/api/jobs/scheduler/status" && method === "GET") {
          const status = await api.getSchedulerStatus();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status, null, 2));
          return;
        }
        if (pathname === "/api/jobs/stats" && method === "GET") {
          const stats = await api.getAggregateStats();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(stats, null, 2));
          return;
        }
        if (pathname === "/api/jobs/cache/clear" && method === "POST") {
          api.clearCache();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Cache cleared" }));
          return;
        }
        if (pathname === "/api/jobs" && method === "GET") {
          const jobs = await api.listJobs();
          const enhanced = jobs.map((job) => ({
            ...job,
            lastRunRelative: formatRelativeTime(job.lastRun),
            nextRunRelative: formatRelativeTime(job.nextRun)
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobs: enhanced, timestamp: Date.now() }, null, 2));
          return;
        }
        const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch && method === "GET") {
          const jobId = decodeURIComponent(jobMatch[1]);
          const job = await api.getJob(jobId);
          if (!job) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Job not found" }));
            return;
          }
          job.lastRunRelative = formatRelativeTime(job.lastRun);
          job.nextRunRelative = formatRelativeTime(job.nextRun);
          if (job.recentRuns) {
            job.recentRuns = job.recentRuns.map((run) => ({
              ...run,
              startedAtRelative: formatRelativeTime(run.startedAt),
              completedAtRelative: formatRelativeTime(run.completedAt)
            }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(job, null, 2));
          return;
        }
        const historyMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/history$/);
        if (historyMatch && method === "GET") {
          const jobId = decodeURIComponent(historyMatch[1]);
          const limit = parseInt(query.get("limit") || "50", 10);
          const runs = await api.getJobHistory(jobId, limit);
          const enhanced = runs.map((run) => ({
            ...run,
            startedAtRelative: formatRelativeTime(run.startedAt),
            completedAtRelative: formatRelativeTime(run.completedAt)
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ runs: enhanced, timestamp: Date.now() }, null, 2));
          return;
        }
        const runMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/run$/);
        if (runMatch && method === "POST") {
          const jobId = decodeURIComponent(runMatch[1]);
          const result = await api.runJob(jobId);
          res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const pauseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/pause$/);
        if (pauseMatch && method === "POST") {
          const jobId = decodeURIComponent(pauseMatch[1]);
          let body = "";
          await new Promise((resolve) => {
            req.on("data", (chunk) => body += chunk);
            req.on("end", resolve);
          });
          let reason = null;
          try {
            const parsed = JSON.parse(body || "{}");
            reason = parsed.reason;
          } catch (_e) {
          }
          const result = await api.pauseJob(jobId, {
            by: req.authUser?.login || "dashboard",
            reason
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const resumeMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/resume$/);
        if (resumeMatch && method === "POST") {
          const jobId = decodeURIComponent(resumeMatch[1]);
          const result = await api.resumeJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const skipMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/skip$/);
        if (skipMatch && method === "POST") {
          const jobId = decodeURIComponent(skipMatch[1]);
          const result = await api.skipJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const killMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/kill$/);
        if (killMatch && method === "POST") {
          const jobId = decodeURIComponent(killMatch[1]);
          const result = await api.killJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (e) {
        console.error("Jobs API error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    function isJobsRoute2(pathname) {
      return pathname.startsWith("/api/jobs");
    }
    module2.exports = { handleJobsRequest: handleJobsRequest2, isJobsRoute: isJobsRoute2, _resetForTesting };
  }
});

// src/openclaw.js
var require_openclaw = __commonJS({
  "src/openclaw.js"(exports2, module2) {
    var { execFileSync, execFile } = require("child_process");
    var { promisify } = require("util");
    var execFileAsync = promisify(execFile);
    var cliEnabled = true;
    var consecutiveFailures = 0;
    var circuitOpenUntil = 0;
    var loggedOpen = false;
    var MAX_FAILURES = 3;
    var COOLDOWN_MS = 10 * 60 * 1e3;
    function setCliEnabled2(enabled) {
      cliEnabled = !!enabled;
    }
    function isCliAvailable() {
      if (!cliEnabled) return false;
      if (circuitOpenUntil && Date.now() < circuitOpenUntil) return false;
      return true;
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
            `[OpenClaw] CLI unavailable after ${consecutiveFailures} consecutive failures \u2014 backing off ${COOLDOWN_MS / 6e4}m (token likely expired). Further errors silenced.`
          );
          loggedOpen = true;
        }
      }
    }
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
        OPENCLAW_HOME: process.env.OPENCLAW_HOME || ""
      };
    }
    function buildArgs(args2) {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const profileArgs = profile ? ["--profile", profile] : [];
      const cleanArgs = args2.replace(/\s*2>&1\s*/g, " ").replace(/\s*2>\/dev\/null\s*/g, " ").trim();
      return [...profileArgs, ...cleanArgs.split(/\s+/).filter(Boolean)];
    }
    function runOpenClaw2(args2) {
      if (!isCliAvailable()) return null;
      try {
        const result = execFileSync("openclaw", buildArgs(args2), {
          encoding: "utf8",
          timeout: 3e3,
          env: getSafeEnv(),
          stdio: ["pipe", "pipe", "pipe"]
        });
        recordCliSuccess();
        return result;
      } catch (e) {
        recordCliFailure();
        return null;
      }
    }
    async function runOpenClawAsync2(args2) {
      if (!isCliAvailable()) return null;
      try {
        const { stdout } = await execFileAsync("openclaw", buildArgs(args2), {
          encoding: "utf8",
          timeout: 2e4,
          env: getSafeEnv()
        });
        recordCliSuccess();
        return stdout;
      } catch (e) {
        recordCliFailure();
        return null;
      }
    }
    function extractJSON2(output) {
      if (!output) return null;
      const jsonStart = output.search(/[[{]/);
      if (jsonStart === -1) return null;
      return output.slice(jsonStart);
    }
    module2.exports = {
      runOpenClaw: runOpenClaw2,
      runOpenClawAsync: runOpenClawAsync2,
      extractJSON: extractJSON2,
      getSafeEnv,
      setCliEnabled: setCliEnabled2,
      isCliAvailable,
      recordCliSuccess,
      recordCliFailure
    };
  }
});

// src/vitals.js
var require_vitals = __commonJS({
  "src/vitals.js"(exports2, module2) {
    var { runCmd, formatBytes } = require_utils();
    var cachedVitals = null;
    var lastVitalsUpdate = 0;
    var VITALS_CACHE_TTL = 3e4;
    var vitalsRefreshing = false;
    async function refreshVitalsAsync() {
      if (vitalsRefreshing) return;
      vitalsRefreshing = true;
      const vitals = {
        hostname: "",
        uptime: "",
        disk: { used: 0, free: 0, total: 0, percent: 0, kbPerTransfer: 0, iops: 0, throughputMBps: 0 },
        cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
        memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
        temperature: null
      };
      const isLinux = process.platform === "linux";
      const isMacOS = process.platform === "darwin";
      try {
        const coresCmd = isLinux ? "nproc" : "sysctl -n hw.ncpu";
        const memCmd = isLinux ? "cat /proc/meminfo | grep MemTotal | awk '{print $2}'" : "sysctl -n hw.memsize";
        const topCmd = isLinux ? "top -bn1 | head -3 | grep -E '^%?Cpu|^  ?CPU' || echo ''" : 'top -l 1 -n 0 2>/dev/null | grep "CPU usage" || echo ""';
        const mpstatCmd = isLinux ? "(command -v mpstat >/dev/null 2>&1 && mpstat 1 1 | tail -1 | sed 's/^Average: *//') || echo ''" : "";
        const [hostname, uptimeRaw, coresRaw, memTotalRaw, memInfoRaw, dfRaw, topOutput, mpstatOutput] = await Promise.all([
          runCmd("hostname", { fallback: "unknown" }),
          runCmd("uptime", { fallback: "" }),
          runCmd(coresCmd, { fallback: "1" }),
          runCmd(memCmd, { fallback: "0" }),
          isLinux ? runCmd("cat /proc/meminfo", { fallback: "" }) : runCmd("vm_stat", { fallback: "" }),
          runCmd("df -k ~ | tail -1", { fallback: "" }),
          runCmd(topCmd, { fallback: "" }),
          isLinux ? runCmd(mpstatCmd, { fallback: "" }) : Promise.resolve("")
        ]);
        vitals.hostname = hostname;
        const uptimeMatch = uptimeRaw.match(/up\s+([^,]+)/);
        if (uptimeMatch) vitals.uptime = uptimeMatch[1].trim();
        const loadMatch = uptimeRaw.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (loadMatch)
          vitals.cpu.loadAvg = [
            parseFloat(loadMatch[1]),
            parseFloat(loadMatch[2]),
            parseFloat(loadMatch[3])
          ];
        vitals.cpu.cores = parseInt(coresRaw, 10) || 1;
        vitals.cpu.usage = Math.min(100, Math.round(vitals.cpu.loadAvg[0] / vitals.cpu.cores * 100));
        if (isLinux) {
          if (mpstatOutput) {
            const parts = mpstatOutput.trim().split(/\s+/);
            const user = parts.length > 1 ? parseFloat(parts[1]) : NaN;
            const sys = parts.length > 3 ? parseFloat(parts[3]) : NaN;
            const idle = parts.length ? parseFloat(parts[parts.length - 1]) : NaN;
            if (!Number.isNaN(user)) vitals.cpu.userPercent = user;
            if (!Number.isNaN(sys)) vitals.cpu.sysPercent = sys;
            if (!Number.isNaN(idle)) {
              vitals.cpu.idlePercent = idle;
              vitals.cpu.usage = Math.max(0, Math.min(100, Math.round(100 - idle)));
            }
          }
          if (topOutput && (vitals.cpu.idlePercent === null || vitals.cpu.idlePercent === void 0)) {
            const userMatch = topOutput.match(/([\d.]+)\s*us/);
            const sysMatch = topOutput.match(/([\d.]+)\s*sy/);
            const idleMatch = topOutput.match(/([\d.]+)\s*id/);
            vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
            vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
            vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
            if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
              vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
            }
          }
        } else if (topOutput) {
          const userMatch = topOutput.match(/([\d.]+)%\s*user/);
          const sysMatch = topOutput.match(/([\d.]+)%\s*sys/);
          const idleMatch = topOutput.match(/([\d.]+)%\s*idle/);
          vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
          vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
          vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
          if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
            vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
          }
        }
        const dfParts = dfRaw.split(/\s+/);
        if (dfParts.length >= 4) {
          vitals.disk.total = parseInt(dfParts[1], 10) * 1024;
          vitals.disk.used = parseInt(dfParts[2], 10) * 1024;
          vitals.disk.free = parseInt(dfParts[3], 10) * 1024;
          vitals.disk.percent = Math.round(parseInt(dfParts[2], 10) / parseInt(dfParts[1], 10) * 100);
        }
        if (isLinux) {
          const memTotalKB = parseInt(memTotalRaw, 10) || 0;
          const memAvailableMatch = memInfoRaw.match(/MemAvailable:\s+(\d+)/);
          const memFreeMatch = memInfoRaw.match(/MemFree:\s+(\d+)/);
          vitals.memory.total = memTotalKB * 1024;
          const memAvailable = parseInt(memAvailableMatch?.[1] || memFreeMatch?.[1] || 0, 10) * 1024;
          vitals.memory.used = vitals.memory.total - memAvailable;
          vitals.memory.free = memAvailable;
          vitals.memory.percent = vitals.memory.total > 0 ? Math.round(vitals.memory.used / vitals.memory.total * 100) : 0;
        } else {
          const pageSizeMatch = memInfoRaw.match(/page size of (\d+) bytes/);
          const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;
          const activePages = parseInt((memInfoRaw.match(/Pages active:\s+(\d+)/) || [])[1] || 0, 10);
          const wiredPages = parseInt(
            (memInfoRaw.match(/Pages wired down:\s+(\d+)/) || [])[1] || 0,
            10
          );
          const compressedPages = parseInt(
            (memInfoRaw.match(/Pages occupied by compressor:\s+(\d+)/) || [])[1] || 0,
            10
          );
          vitals.memory.total = parseInt(memTotalRaw, 10) || 0;
          vitals.memory.used = (activePages + wiredPages + compressedPages) * pageSize;
          vitals.memory.free = vitals.memory.total - vitals.memory.used;
          vitals.memory.percent = vitals.memory.total > 0 ? Math.round(vitals.memory.used / vitals.memory.total * 100) : 0;
        }
        vitals.memory.pressure = vitals.memory.percent > 90 ? "critical" : vitals.memory.percent > 75 ? "warning" : "normal";
        const timeoutPrefix = isLinux ? "timeout 5" : "$(command -v gtimeout >/dev/null 2>&1 && echo gtimeout 5)";
        const iostatArgs = isLinux ? "-d -o JSON 1 2" : "-d -c 2 2";
        const iostatCmd = `${timeoutPrefix} iostat ${iostatArgs} 2>/dev/null || echo ''`;
        const [perfCores, effCores, chip, iostatRaw] = await Promise.all([
          isMacOS ? runCmd("sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 0", { fallback: "0" }) : Promise.resolve("0"),
          isMacOS ? runCmd("sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo 0", { fallback: "0" }) : Promise.resolve("0"),
          isMacOS ? runCmd(
            'system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | cut -d: -f2 || echo ""',
            { fallback: "" }
          ) : Promise.resolve(""),
          runCmd(iostatCmd, { fallback: "", timeout: 5e3 })
        ]);
        if (isLinux) {
          const cpuBrand = await runCmd(
            "cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d: -f2",
            { fallback: "" }
          );
          if (cpuBrand) vitals.cpu.brand = cpuBrand.trim();
        }
        vitals.cpu.pCores = parseInt(perfCores, 10) || null;
        vitals.cpu.eCores = parseInt(effCores, 10) || null;
        if (chip) vitals.cpu.chip = chip;
        if (isLinux) {
          try {
            const iostatJson = JSON.parse(iostatRaw);
            const samples = iostatJson.sysstat.hosts[0].statistics;
            const disks = samples[samples.length - 1].disk;
            const disk = disks.filter((d) => !d.disk_device.startsWith("loop")).sort((a, b) => b.tps - a.tps)[0];
            if (disk) {
              const kbReadPerSec = disk["kB_read/s"] || 0;
              const kbWrtnPerSec = disk["kB_wrtn/s"] || 0;
              vitals.disk.iops = disk.tps || 0;
              vitals.disk.throughputMBps = (kbReadPerSec + kbWrtnPerSec) / 1024;
              vitals.disk.kbPerTransfer = disk.tps > 0 ? (kbReadPerSec + kbWrtnPerSec) / disk.tps : 0;
            }
          } catch {
          }
        } else {
          const iostatLines = iostatRaw.split("\n").filter((l) => l.trim());
          const lastLine = iostatLines.length > 0 ? iostatLines[iostatLines.length - 1] : "";
          const iostatParts = lastLine.split(/\s+/).filter(Boolean);
          if (iostatParts.length >= 3) {
            vitals.disk.kbPerTransfer = parseFloat(iostatParts[0]) || 0;
            vitals.disk.iops = parseFloat(iostatParts[1]) || 0;
            vitals.disk.throughputMBps = parseFloat(iostatParts[2]) || 0;
          }
        }
        vitals.temperature = null;
        vitals.temperatureNote = null;
        const isAppleSilicon = vitals.cpu.chip && /apple/i.test(vitals.cpu.chip);
        if (isAppleSilicon) {
          vitals.temperatureNote = "Apple Silicon (requires elevated access)";
          try {
            const pmOutput = await runCmd(
              'sudo -n powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i "die temp" | head -1',
              { fallback: "", timeout: 5e3 }
            );
            const tempMatch = pmOutput.match(/([\d.]+)/);
            if (tempMatch) {
              vitals.temperature = parseFloat(tempMatch[1]);
              vitals.temperatureNote = null;
            }
          } catch (e) {
          }
        } else if (isMacOS) {
          const home = require("os").homedir();
          try {
            const temp = await runCmd(
              `osx-cpu-temp 2>/dev/null || ${home}/bin/osx-cpu-temp 2>/dev/null`,
              { fallback: "" }
            );
            if (temp && temp.includes("\xB0")) {
              const tempMatch = temp.match(/([\d.]+)/);
              if (tempMatch && parseFloat(tempMatch[1]) > 0) {
                vitals.temperature = parseFloat(tempMatch[1]);
              }
            }
          } catch (e) {
          }
          if (!vitals.temperature) {
            try {
              const ioregRaw = await runCmd(
                "ioreg -r -n AppleSmartBattery 2>/dev/null | grep Temperature",
                { fallback: "" }
              );
              const tempMatch = ioregRaw.match(/"Temperature"\s*=\s*(\d+)/);
              if (tempMatch) {
                vitals.temperature = Math.round(parseInt(tempMatch[1], 10) / 100);
              }
            } catch (e) {
            }
          }
        } else if (isLinux) {
          try {
            const temp = await runCmd("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", {
              fallback: ""
            });
            if (temp) {
              vitals.temperature = Math.round(parseInt(temp, 10) / 1e3);
            }
          } catch (e) {
          }
        }
      } catch (e) {
        console.error("[Vitals] Async refresh failed:", e.message);
      }
      vitals.memory.usedFormatted = formatBytes(vitals.memory.used);
      vitals.memory.totalFormatted = formatBytes(vitals.memory.total);
      vitals.memory.freeFormatted = formatBytes(vitals.memory.free);
      vitals.disk.usedFormatted = formatBytes(vitals.disk.used);
      vitals.disk.totalFormatted = formatBytes(vitals.disk.total);
      vitals.disk.freeFormatted = formatBytes(vitals.disk.free);
      cachedVitals = vitals;
      lastVitalsUpdate = Date.now();
      vitalsRefreshing = false;
      console.log("[Vitals] Cache refreshed async");
    }
    setTimeout(() => refreshVitalsAsync(), 500);
    setInterval(() => refreshVitalsAsync(), VITALS_CACHE_TTL);
    function getSystemVitals2() {
      const now = Date.now();
      if (!cachedVitals || now - lastVitalsUpdate > VITALS_CACHE_TTL) {
        refreshVitalsAsync();
      }
      if (cachedVitals) return cachedVitals;
      return {
        hostname: "loading...",
        uptime: "",
        disk: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          usedFormatted: "-",
          totalFormatted: "-",
          freeFormatted: "-"
        },
        cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
        memory: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          pressure: "normal",
          usedFormatted: "-",
          totalFormatted: "-",
          freeFormatted: "-"
        },
        temperature: null
      };
    }
    var cachedDeps = null;
    async function checkOptionalDeps2() {
      const isLinux = process.platform === "linux";
      const isMacOS = process.platform === "darwin";
      const platform = isLinux ? "linux" : isMacOS ? "darwin" : null;
      const results = [];
      if (!platform) {
        cachedDeps = results;
        return results;
      }
      const fs2 = require("fs");
      const path2 = require("path");
      const depsFile = path2.join(__dirname, "..", "config", "system-deps.json");
      let depsConfig;
      try {
        depsConfig = JSON.parse(fs2.readFileSync(depsFile, "utf8"));
      } catch {
        cachedDeps = results;
        return results;
      }
      const deps = depsConfig[platform] || [];
      const home = require("os").homedir();
      let pkgManager = null;
      if (isLinux) {
        for (const pm of ["apt", "dnf", "yum", "pacman", "apk"]) {
          const has = await runCmd(`which ${pm}`, { fallback: "" });
          if (has) {
            pkgManager = pm;
            break;
          }
        }
      } else if (isMacOS) {
        const hasBrew = await runCmd("which brew", { fallback: "" });
        if (hasBrew) pkgManager = "brew";
      }
      let isAppleSilicon = false;
      if (isMacOS) {
        const chip = await runCmd("sysctl -n machdep.cpu.brand_string", { fallback: "" });
        isAppleSilicon = /apple/i.test(chip);
      }
      for (const dep of deps) {
        if (dep.condition === "intel" && isAppleSilicon) continue;
        let installed = false;
        const hasBinary = await runCmd(`which ${dep.binary} 2>/dev/null`, { fallback: "" });
        if (hasBinary) {
          installed = true;
        } else if (isMacOS && dep.binary === "osx-cpu-temp") {
          const homebin = await runCmd(`test -x ${home}/bin/osx-cpu-temp && echo ok`, {
            fallback: ""
          });
          if (homebin) installed = true;
        }
        const installCmd = dep.install[pkgManager] || null;
        results.push({
          id: dep.id,
          name: dep.name,
          purpose: dep.purpose,
          affects: dep.affects,
          installed,
          installCmd,
          url: dep.url || null
        });
      }
      cachedDeps = results;
      const missing = results.filter((d) => !d.installed);
      if (missing.length > 0) {
        console.log("[Startup] Optional dependencies for enhanced vitals:");
        for (const dep of missing) {
          const action = dep.installCmd || dep.url || "see docs";
          console.log(`   \u{1F4A1} ${dep.name} \u2014 ${dep.purpose}: ${action}`);
        }
      }
      return results;
    }
    function getOptionalDeps2() {
      return cachedDeps;
    }
    module2.exports = {
      refreshVitalsAsync,
      getSystemVitals: getSystemVitals2,
      checkOptionalDeps: checkOptionalDeps2,
      getOptionalDeps: getOptionalDeps2,
      VITALS_CACHE_TTL
    };
  }
});

// src/auth.js
var require_auth = __commonJS({
  "src/auth.js"(exports2, module2) {
    var AUTH_HEADERS = {
      tailscale: {
        login: "tailscale-user-login",
        name: "tailscale-user-name",
        pic: "tailscale-user-profile-pic"
      },
      cloudflare: {
        email: "cf-access-authenticated-user-email"
      }
    };
    function checkAuth2(req, authConfig) {
      const mode = authConfig.mode;
      const remoteAddr = req.socket?.remoteAddress || "";
      const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
      if (isLocalhost) {
        return { authorized: true, user: { type: "localhost", login: "localhost" } };
      }
      if (mode === "none") {
        return { authorized: true, user: null };
      }
      if (mode === "token") {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (token && token === authConfig.token) {
          return { authorized: true, user: { type: "token" } };
        }
        return { authorized: false, reason: "Invalid or missing token" };
      }
      if (mode === "tailscale") {
        const login = (req.headers[AUTH_HEADERS.tailscale.login] || "").toLowerCase();
        const name = req.headers[AUTH_HEADERS.tailscale.name] || "";
        const pic = req.headers[AUTH_HEADERS.tailscale.pic] || "";
        if (!login) {
          return { authorized: false, reason: "Not accessed via Tailscale Serve" };
        }
        const isAllowed = authConfig.allowedUsers.some((allowed) => {
          if (allowed === "*") return true;
          if (allowed === login) return true;
          if (allowed.startsWith("*@")) {
            const domain = allowed.slice(2);
            return login.endsWith("@" + domain);
          }
          return false;
        });
        if (isAllowed) {
          return { authorized: true, user: { type: "tailscale", login, name, pic } };
        }
        return { authorized: false, reason: `User ${login} not in allowlist`, user: { login } };
      }
      if (mode === "cloudflare") {
        const email = (req.headers[AUTH_HEADERS.cloudflare.email] || "").toLowerCase();
        if (!email) {
          return { authorized: false, reason: "Not accessed via Cloudflare Access" };
        }
        const isAllowed = authConfig.allowedUsers.some((allowed) => {
          if (allowed === "*") return true;
          if (allowed === email) return true;
          if (allowed.startsWith("*@")) {
            const domain = allowed.slice(2);
            return email.endsWith("@" + domain);
          }
          return false;
        });
        if (isAllowed) {
          return { authorized: true, user: { type: "cloudflare", email } };
        }
        return { authorized: false, reason: `User ${email} not in allowlist`, user: { email } };
      }
      if (mode === "allowlist") {
        const clientIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
        const isAllowed = authConfig.allowedIPs.some((allowed) => {
          if (allowed === clientIP) return true;
          if (allowed.endsWith("/24")) {
            const prefix = allowed.slice(0, -3).split(".").slice(0, 3).join(".");
            return clientIP.startsWith(prefix + ".");
          }
          return false;
        });
        if (isAllowed) {
          return { authorized: true, user: { type: "ip", ip: clientIP } };
        }
        return { authorized: false, reason: `IP ${clientIP} not in allowlist` };
      }
      return { authorized: false, reason: "Unknown auth mode" };
    }
    function getUnauthorizedPage2(reason, user, authConfig) {
      const userInfo = user ? `<p class="user-info">Detected: ${user.login || user.email || user.ip || "unknown"}</p>` : "";
      return `<!DOCTYPE html>
<html>
<head>
    <title>Access Denied - Command Center</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e8e8e8;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 500px;
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin-bottom: 1rem; color: #ff6b6b; }
        .reason { color: #aaa; margin-bottom: 1.5rem; font-size: 0.95rem; }
        .user-info { color: #ffeb3b; margin: 1rem 0; font-size: 0.9rem; }
        .instructions { color: #ccc; font-size: 0.85rem; line-height: 1.5; }
        .auth-mode { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); color: #888; font-size: 0.75rem; }
        code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">\u{1F510}</div>
        <h1>Access Denied</h1>
        <div class="reason">${reason}</div>
        ${userInfo}
        <div class="instructions">
            <p>This dashboard requires authentication via <strong>${authConfig.mode}</strong>.</p>
            ${authConfig.mode === "tailscale" ? `<p style="margin-top:1rem">Make sure you're accessing via your Tailscale URL and your account is in the allowlist.</p>` : ""}
            ${authConfig.mode === "cloudflare" ? `<p style="margin-top:1rem">Make sure you're accessing via Cloudflare Access and your email is in the allowlist.</p>` : ""}
        </div>
        <div class="auth-mode">Auth mode: <code>${authConfig.mode}</code></div>
    </div>
</body>
</html>`;
    }
    module2.exports = { AUTH_HEADERS, checkAuth: checkAuth2, getUnauthorizedPage: getUnauthorizedPage2 };
  }
});

// src/privacy.js
var require_privacy = __commonJS({
  "src/privacy.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function getPrivacyFilePath(dataDir) {
      return path2.join(dataDir, "privacy-settings.json");
    }
    function loadPrivacySettings2(dataDir) {
      try {
        const privacyFile = getPrivacyFilePath(dataDir);
        if (fs2.existsSync(privacyFile)) {
          return JSON.parse(fs2.readFileSync(privacyFile, "utf8"));
        }
      } catch (e) {
        console.error("Failed to load privacy settings:", e.message);
      }
      return {
        version: 1,
        hiddenTopics: [],
        hiddenSessions: [],
        hiddenCrons: [],
        hideHostname: false,
        updatedAt: null
      };
    }
    function savePrivacySettings2(dataDir, data) {
      try {
        if (!fs2.existsSync(dataDir)) {
          fs2.mkdirSync(dataDir, { recursive: true });
        }
        data.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        fs2.writeFileSync(getPrivacyFilePath(dataDir), JSON.stringify(data, null, 2));
        return true;
      } catch (e) {
        console.error("Failed to save privacy settings:", e.message);
        return false;
      }
    }
    module2.exports = {
      loadPrivacySettings: loadPrivacySettings2,
      savePrivacySettings: savePrivacySettings2
    };
  }
});

// src/operators.js
var require_operators = __commonJS({
  "src/operators.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function loadOperators2(dataDir) {
      const operatorsFile = path2.join(dataDir, "operators.json");
      try {
        if (fs2.existsSync(operatorsFile)) {
          return JSON.parse(fs2.readFileSync(operatorsFile, "utf8"));
        }
      } catch (e) {
        console.error("Failed to load operators:", e.message);
      }
      return { version: 1, operators: [], roles: {} };
    }
    function saveOperators2(dataDir, data) {
      try {
        if (!fs2.existsSync(dataDir)) {
          fs2.mkdirSync(dataDir, { recursive: true });
        }
        const operatorsFile = path2.join(dataDir, "operators.json");
        fs2.writeFileSync(operatorsFile, JSON.stringify(data, null, 2));
        return true;
      } catch (e) {
        console.error("Failed to save operators:", e.message);
        return false;
      }
    }
    function getOperatorBySlackId2(dataDir, slackId) {
      const data = loadOperators2(dataDir);
      return data.operators.find((op) => op.id === slackId || op.metadata?.slackId === slackId);
    }
    var operatorsRefreshing = false;
    async function refreshOperatorsAsync(dataDir, getOpenClawDir2) {
      if (operatorsRefreshing) return;
      operatorsRefreshing = true;
      const toMs = (ts, fallback) => {
        if (typeof ts === "number" && Number.isFinite(ts)) return ts;
        if (typeof ts === "string") {
          const parsed = Date.parse(ts);
          if (Number.isFinite(parsed)) return parsed;
        }
        return fallback;
      };
      try {
        const openclawDir = getOpenClawDir2();
        const sessionsDir = path2.join(openclawDir, "agents", "main", "sessions");
        if (!fs2.existsSync(sessionsDir)) {
          operatorsRefreshing = false;
          return;
        }
        const files = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
        const operatorsMap = /* @__PURE__ */ new Map();
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
        for (const file of files) {
          const filePath = path2.join(sessionsDir, file);
          try {
            const stat = fs2.statSync(filePath);
            if (stat.mtimeMs < sevenDaysAgo) continue;
            const fd = fs2.openSync(filePath, "r");
            const buffer = Buffer.alloc(10240);
            const bytesRead = fs2.readSync(fd, buffer, 0, 10240, 0);
            fs2.closeSync(fd);
            const content2 = buffer.toString("utf8", 0, bytesRead);
            const lines = content2.split("\n").slice(0, 20);
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const entry = JSON.parse(line);
                if (entry.type !== "message" || !entry.message) continue;
                const msg = entry.message;
                if (msg.role !== "user") continue;
                let text = "";
                if (typeof msg.content === "string") {
                  text = msg.content;
                } else if (Array.isArray(msg.content)) {
                  const textPart = msg.content.find((c) => c.type === "text");
                  if (textPart) text = textPart.text || "";
                }
                if (!text) continue;
                const slackMatch = text.match(/\[Slack[^\]]*\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
                if (slackMatch) {
                  const username = slackMatch[1];
                  const userId = slackMatch[2];
                  if (!operatorsMap.has(userId)) {
                    operatorsMap.set(userId, {
                      id: userId,
                      name: username,
                      username,
                      source: "slack",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(userId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
                const telegramChatMatch = text.match(/"chat_id":\s*"telegram:([^"]+)"/);
                const telegramSenderMatch = text.match(/"sender":\s*"([^"]+)"/);
                const telegramSenderIdMatch = text.match(/"sender_id":\s*"([^"]+)"/);
                if (telegramChatMatch && telegramSenderMatch) {
                  const username = telegramSenderMatch[1];
                  const userId = telegramSenderIdMatch ? telegramSenderIdMatch[1] : telegramChatMatch[1];
                  const operatorId = `telegram:${userId}`;
                  if (!operatorsMap.has(operatorId)) {
                    operatorsMap.set(operatorId, {
                      id: operatorId,
                      telegramId: userId,
                      name: username,
                      username,
                      source: "telegram",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(operatorId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
                const legacyTelegramMatch = text.match(/\[Telegram[^\]]*\]\s*([\w.-]+):/);
                if (legacyTelegramMatch && !telegramChatMatch) {
                  const username = legacyTelegramMatch[1];
                  const operatorId = `telegram:${username}`;
                  if (!operatorsMap.has(operatorId)) {
                    operatorsMap.set(operatorId, {
                      id: operatorId,
                      name: username,
                      username,
                      source: "telegram",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(operatorId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
                const discordSenderMatch = text.match(/"sender":\s*"(\d+)"/);
                const discordLabelMatch = text.match(/"label":\s*"([^"]+)"/);
                const discordUsernameMatch = text.match(/"username":\s*"([^"]+)"/);
                if (discordSenderMatch) {
                  const userId = discordSenderMatch[1];
                  const label = discordLabelMatch ? discordLabelMatch[1] : userId;
                  const username = discordUsernameMatch ? discordUsernameMatch[1] : label;
                  const opId = `discord:${userId}`;
                  if (!operatorsMap.has(opId)) {
                    operatorsMap.set(opId, {
                      id: opId,
                      discordId: userId,
                      name: label,
                      username,
                      source: "discord",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(opId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
              } catch (e) {
              }
            }
          } catch (e) {
          }
        }
        const existing = loadOperators2(dataDir);
        const existingMap = new Map(existing.operators.map((op) => [op.id, op]));
        for (const [id, autoOp] of operatorsMap) {
          if (existingMap.has(id)) {
            const manual = existingMap.get(id);
            manual.lastSeen = Math.max(manual.lastSeen || 0, autoOp.lastSeen);
            manual.sessionCount = (manual.sessionCount || 0) + autoOp.sessionCount;
          } else {
            existingMap.set(id, autoOp);
          }
        }
        const merged = {
          version: 1,
          operators: Array.from(existingMap.values()).sort(
            (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)
          ),
          roles: existing.roles || {},
          lastRefreshed: Date.now()
        };
        saveOperators2(dataDir, merged);
        console.log(`[Operators] Refreshed: ${merged.operators.length} operators detected`);
      } catch (e) {
        console.error("[Operators] Refresh failed:", e.message);
      }
      operatorsRefreshing = false;
    }
    function startOperatorsRefresh2(dataDir, getOpenClawDir2) {
      setTimeout(() => refreshOperatorsAsync(dataDir, getOpenClawDir2), 2e3);
      setInterval(() => refreshOperatorsAsync(dataDir, getOpenClawDir2), 5 * 60 * 1e3);
    }
    function calculateOperatorStats2(operatorData, allSessions) {
      const operatorsWithStats = operatorData.operators.map((op) => {
        const userSessions = allSessions.filter((s) => {
          const userId = s.originator?.userId;
          if (!userId) return false;
          return userId === op.id || userId === op.metadata?.slackId;
        });
        return {
          ...op,
          stats: {
            activeSessions: userSessions.filter((s) => s.active).length,
            totalSessions: userSessions.length,
            lastSeen: userSessions.length > 0 ? new Date(
              Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 6e4
            ).toISOString() : op.lastSeen
          }
        };
      });
      return { ...operatorData, operators: operatorsWithStats };
    }
    module2.exports = {
      loadOperators: loadOperators2,
      saveOperators: saveOperators2,
      getOperatorBySlackId: getOperatorBySlackId2,
      refreshOperatorsAsync,
      startOperatorsRefresh: startOperatorsRefresh2,
      calculateOperatorStats: calculateOperatorStats2
    };
  }
});

// src/topics.js
var require_topics = __commonJS({
  "src/topics.js"(exports2, module2) {
    var TOPIC_PATTERNS = {
      dashboard: ["dashboard", "command center", "ui", "interface", "status page"],
      scheduling: ["cron", "schedule", "timer", "reminder", "alarm", "periodic", "interval"],
      heartbeat: [
        "heartbeat",
        "heartbeat_ok",
        "poll",
        "health check",
        "ping",
        "keepalive",
        "monitoring"
      ],
      memory: ["memory", "remember", "recall", "notes", "journal", "log", "context"],
      Slack: ["slack", "channel", "#cc-", "thread", "mention", "dm", "workspace"],
      email: ["email", "mail", "inbox", "gmail", "send email", "unread", "compose"],
      calendar: ["calendar", "event", "meeting", "appointment", "schedule", "gcal"],
      coding: [
        "code",
        "script",
        "function",
        "debug",
        "error",
        "bug",
        "implement",
        "refactor",
        "programming"
      ],
      git: [
        "git",
        "commit",
        "branch",
        "merge",
        "push",
        "pull",
        "repository",
        "pr",
        "pull request",
        "github"
      ],
      "file editing": ["file", "edit", "write", "read", "create", "delete", "modify", "save"],
      API: ["api", "endpoint", "request", "response", "webhook", "integration", "rest", "graphql"],
      research: ["search", "research", "lookup", "find", "investigate", "learn", "study"],
      browser: ["browser", "webpage", "website", "url", "click", "navigate", "screenshot", "web_fetch"],
      "Quip export": ["quip", "export", "document", "spreadsheet"],
      finance: ["finance", "investment", "stock", "money", "budget", "bank", "trading", "portfolio"],
      home: ["home", "automation", "lights", "thermostat", "smart home", "iot", "homekit"],
      health: ["health", "fitness", "workout", "exercise", "weight", "sleep", "nutrition"],
      travel: ["travel", "flight", "hotel", "trip", "vacation", "booking", "airport"],
      food: ["food", "recipe", "restaurant", "cooking", "meal", "order", "delivery"],
      subagent: ["subagent", "spawn", "sub-agent", "delegate", "worker", "parallel"],
      tools: ["tool", "exec", "shell", "command", "terminal", "bash", "run"]
    };
    function detectTopics(text) {
      if (!text) return [];
      const lowerText = text.toLowerCase();
      const scores = {};
      for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
        let score = 0;
        for (const keyword of keywords) {
          if (keyword.length <= 3) {
            const regex = new RegExp(`\\b${keyword}\\b`, "i");
            if (regex.test(lowerText)) score++;
          } else if (lowerText.includes(keyword)) {
            score++;
          }
        }
        if (score > 0) {
          scores[topic] = score;
        }
      }
      if (Object.keys(scores).length === 0) return [];
      const bestScore = Math.max(...Object.values(scores));
      const threshold = Math.max(2, bestScore * 0.5);
      return Object.entries(scores).filter(([_, score]) => score >= threshold || score >= 1 && bestScore <= 2).sort((a, b) => b[1] - a[1]).map(([topic, _]) => topic);
    }
    module2.exports = { TOPIC_PATTERNS, detectTopics };
  }
});

// src/sessions.js
var require_sessions = __commonJS({
  "src/sessions.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { detectTopics } = require_topics();
    var CHANNEL_MAP = {
      c0aax7y80np: "#cc-meta",
      c0ab9f8sdfe: "#cc-research",
      c0aan4rq7v5: "#cc-finance",
      c0abxulk1qq: "#cc-properties",
      c0ab5nz8mkl: "#cc-ai",
      c0aan38tzv5: "#cc-dev",
      c0ab7wwhqvc: "#cc-home",
      c0ab1pjhxef: "#cc-health",
      c0ab7txvcqd: "#cc-legal",
      c0aay2g3n3r: "#cc-social",
      c0aaxrw2wqp: "#cc-business",
      c0ab19f3lae: "#cc-random",
      c0ab0r74y33: "#cc-food",
      c0ab0qrq3r9: "#cc-travel",
      c0ab0sbqqlg: "#cc-family",
      c0ab0slqdba: "#cc-games",
      c0ab1ps7ef2: "#cc-music",
      c0absbnrsbe: "#cc-dashboard"
    };
    function parseSessionLabel(key) {
      const parts = key.split(":");
      if (parts.includes("slack")) {
        const channelIdx = parts.indexOf("channel");
        if (channelIdx >= 0 && parts[channelIdx + 1]) {
          const channelId = parts[channelIdx + 1].toLowerCase();
          const channelName = CHANNEL_MAP[channelId] || `#${channelId}`;
          if (parts.includes("thread")) {
            const threadTs = parts[parts.indexOf("thread") + 1];
            const ts = parseFloat(threadTs);
            const date = new Date(ts * 1e3);
            const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `${channelName} thread @ ${timeStr}`;
          }
          return channelName;
        }
      }
      if (key.includes("telegram")) {
        return "\u{1F4F1} Telegram";
      }
      if (key === "agent:main:main") {
        return "\u{1F3E0} Main Session";
      }
      return key.length > 40 ? key.slice(0, 37) + "..." : key;
    }
    function createSessionsModule2(deps) {
      const { getOpenClawDir: getOpenClawDir2, getOperatorBySlackId: getOperatorBySlackId2, runOpenClaw: runOpenClaw2, runOpenClawAsync: runOpenClawAsync2, extractJSON: extractJSON2 } = deps;
      let sessionsCache = { sessions: [], timestamp: 0, refreshing: false };
      const SESSIONS_CACHE_TTL = 1e4;
      function findTranscriptPath(sessionId) {
        if (!sessionId) return null;
        const openclawDir = getOpenClawDir2();
        const sessionsDir = path2.join(openclawDir, "agents", "main", "sessions");
        const exactPath = path2.join(sessionsDir, `${sessionId}.jsonl`);
        if (fs2.existsSync(exactPath)) return exactPath;
        try {
          const files = fs2.readdirSync(sessionsDir);
          const prefix = `${sessionId}-`;
          const match = files.find(
            (f) => f.startsWith(prefix) && f.endsWith(".jsonl") && !f.includes(".deleted.")
          );
          if (match) return path2.join(sessionsDir, match);
        } catch (e) {
        }
        return null;
      }
      function getSessionOriginator(sessionId) {
        try {
          if (!sessionId) return null;
          const transcriptPath = findTranscriptPath(sessionId);
          if (!transcriptPath) return null;
          const content2 = fs2.readFileSync(transcriptPath, "utf8");
          const lines = content2.trim().split("\n");
          for (let i = 0; i < Math.min(lines.length, 10); i++) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.type !== "message" || !entry.message) continue;
              const msg = entry.message;
              if (msg.role !== "user") continue;
              let text = "";
              if (typeof msg.content === "string") {
                text = msg.content;
              } else if (Array.isArray(msg.content)) {
                const textPart = msg.content.find((c) => c.type === "text");
                if (textPart) text = textPart.text || "";
              }
              if (!text) continue;
              const slackUserMatch = text.match(/\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
              if (slackUserMatch) {
                const username = slackUserMatch[1];
                const userId = slackUserMatch[2];
                const operator = getOperatorBySlackId2(userId);
                return {
                  userId,
                  username,
                  displayName: operator?.name || username,
                  role: operator?.role || "user",
                  avatar: operator?.avatar || null
                };
              }
              const senderIdMatch = text.match(/"sender_id":\s*"([A-Z0-9]+)"/);
              const senderMatch = text.match(/"sender":\s*"([^"]+)"/);
              if (senderIdMatch) {
                const userId = senderIdMatch[1];
                const username = senderMatch ? senderMatch[1] : userId;
                const operator = getOperatorBySlackId2(userId);
                return {
                  userId,
                  username,
                  displayName: operator?.name || username,
                  role: operator?.role || "user",
                  avatar: operator?.avatar || null
                };
              }
            } catch (e) {
            }
          }
          return null;
        } catch (e) {
          return null;
        }
      }
      function getSessionTopic(sessionId) {
        if (!sessionId) return null;
        try {
          const transcriptPath = findTranscriptPath(sessionId);
          if (!transcriptPath) return null;
          const fd = fs2.openSync(transcriptPath, "r");
          const buffer = Buffer.alloc(5e4);
          const bytesRead = fs2.readSync(fd, buffer, 0, 5e4, 0);
          fs2.closeSync(fd);
          if (bytesRead === 0) return null;
          const content2 = buffer.toString("utf8", 0, bytesRead);
          const lines = content2.split("\n").filter((l) => l.trim());
          let textSamples = [];
          for (const line of lines.slice(0, 30)) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === "message" && entry.message?.content) {
                const msgContent = entry.message.content;
                if (Array.isArray(msgContent)) {
                  msgContent.forEach((c) => {
                    if (c.type === "text" && c.text) {
                      textSamples.push(c.text.slice(0, 500));
                    }
                  });
                } else if (typeof msgContent === "string") {
                  textSamples.push(msgContent.slice(0, 500));
                }
              }
            } catch (e) {
            }
          }
          if (textSamples.length === 0) return null;
          const topics = detectTopics(textSamples.join(" "));
          return topics.length > 0 ? topics.slice(0, 2).join(", ") : null;
        } catch (e) {
          return null;
        }
      }
      function mapSession(s) {
        const minutesAgo = s.ageMs ? s.ageMs / 6e4 : Infinity;
        let channel = "other";
        if (s.key.includes("slack")) channel = "slack";
        else if (s.key.includes("telegram")) channel = "telegram";
        else if (s.key.includes("discord")) channel = "discord";
        else if (s.key.includes("signal")) channel = "signal";
        else if (s.key.includes("whatsapp")) channel = "whatsapp";
        let sessionType = "channel";
        if (s.key.includes(":subagent:")) sessionType = "subagent";
        else if (s.key.includes(":cron:")) sessionType = "cron";
        else if (s.key === "agent:main:main") sessionType = "main";
        const originator = getSessionOriginator(s.sessionId);
        const label = s.groupChannel || s.displayName || parseSessionLabel(s.key);
        const topic = getSessionTopic(s.sessionId);
        const totalTokens = s.totalTokens || 0;
        const sessionAgeMinutes = Math.max(1, Math.min(minutesAgo, 24 * 60));
        const burnRate = Math.round(totalTokens / sessionAgeMinutes);
        return {
          sessionKey: s.key,
          sessionId: s.sessionId,
          label,
          groupChannel: s.groupChannel || null,
          displayName: s.displayName || null,
          kind: s.kind,
          channel,
          sessionType,
          active: minutesAgo < 15,
          recentlyActive: minutesAgo < 60,
          minutesAgo: Math.round(minutesAgo),
          tokens: s.totalTokens || 0,
          model: s.model,
          originator,
          topic,
          metrics: {
            burnRate,
            toolCalls: 0,
            minutesActive: Math.max(1, Math.min(Math.round(minutesAgo), 24 * 60))
          }
        };
      }
      async function refreshSessionsCache() {
        if (sessionsCache.refreshing) return;
        sessionsCache.refreshing = true;
        try {
          const output = await runOpenClawAsync2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const sessions2 = data.sessions || [];
            const mapped = sessions2.map((s) => mapSession(s));
            const withOriginator = mapped.filter((s) => s.originator != null);
            sessionsCache = {
              sessions: mapped,
              timestamp: Date.now(),
              refreshing: false
            };
            console.log(
              `[Sessions Cache] Refreshed: ${mapped.length} sessions (${withOriginator.length} with originator)`
            );
          }
        } catch (e) {
          console.error("[Sessions Cache] Refresh error:", e.message);
        }
        sessionsCache.refreshing = false;
      }
      function getSessionsCached() {
        const now = Date.now();
        const isStale = now - sessionsCache.timestamp > SESSIONS_CACHE_TTL;
        if (isStale && !sessionsCache.refreshing) {
          refreshSessionsCache();
        }
        return sessionsCache.sessions;
      }
      function getSessions(options = {}) {
        const limit = Object.prototype.hasOwnProperty.call(options, "limit") ? options.limit : 20;
        const returnCount = options.returnCount || false;
        if (limit === null) {
          const cached = getSessionsCached();
          const totalCount = cached.length;
          return returnCount ? { sessions: cached, totalCount } : cached;
        }
        try {
          const output = runOpenClaw2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const totalCount = data.count || data.sessions?.length || 0;
            let sessions2 = data.sessions || [];
            if (limit != null) {
              sessions2 = sessions2.slice(0, limit);
            }
            const mapped = sessions2.map((s) => mapSession(s));
            return returnCount ? { sessions: mapped, totalCount } : mapped;
          }
        } catch (e) {
          console.error("Failed to get sessions:", e.message);
        }
        return returnCount ? { sessions: [], totalCount: 0 } : [];
      }
      function readTranscript(sessionId) {
        const transcriptPath = findTranscriptPath(sessionId);
        try {
          if (!transcriptPath) return [];
          const content2 = fs2.readFileSync(transcriptPath, "utf8");
          return content2.trim().split("\n").map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          }).filter(Boolean);
        } catch (e) {
          console.error("Failed to read transcript:", e.message);
          return [];
        }
      }
      function getSessionDetail(sessionKey) {
        try {
          const listOutput = runOpenClaw2("sessions --json 2>/dev/null");
          let sessionInfo = null;
          const jsonStr = extractJSON2(listOutput);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            sessionInfo = data.sessions?.find((s) => s.key === sessionKey);
          }
          if (!sessionInfo) {
            return { error: "Session not found" };
          }
          const transcript = readTranscript(sessionInfo.sessionId);
          let messages = [];
          let tools = {};
          let facts = [];
          let needsAttention = [];
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalCost = 0;
          let detectedModel = sessionInfo.model || null;
          transcript.forEach((entry) => {
            if (entry.type !== "message" || !entry.message) return;
            const msg = entry.message;
            if (!msg.role) return;
            if (msg.usage) {
              totalInputTokens += msg.usage.input || msg.usage.inputTokens || 0;
              totalOutputTokens += msg.usage.output || msg.usage.outputTokens || 0;
              totalCacheRead += msg.usage.cacheRead || msg.usage.cacheReadTokens || 0;
              totalCacheWrite += msg.usage.cacheWrite || msg.usage.cacheWriteTokens || 0;
              if (msg.usage.cost?.total) totalCost += msg.usage.cost.total;
            }
            if (msg.role === "assistant" && msg.model && !detectedModel) {
              detectedModel = msg.model;
            }
            let text = "";
            if (typeof msg.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textPart = msg.content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
              msg.content.filter((c) => c.type === "toolCall" || c.type === "tool_use").forEach((tc) => {
                const name = tc.name || tc.tool || "unknown";
                tools[name] = (tools[name] || 0) + 1;
              });
            }
            if (text && msg.role !== "toolResult") {
              messages.push({ role: msg.role, text, timestamp: entry.timestamp });
            }
            if (msg.role === "user" && text) {
              const lowerText = text.toLowerCase();
              if (text.includes("?")) {
                const questions = text.match(/[^.!?\n]*\?/g) || [];
                questions.slice(0, 2).forEach((q) => {
                  if (q.length > 15 && q.length < 200) {
                    needsAttention.push(`\u2753 ${q.trim()}`);
                  }
                });
              }
              if (lowerText.includes("todo") || lowerText.includes("remind") || lowerText.includes("need to")) {
                const match = text.match(/(?:todo|remind|need to)[^.!?\n]*/i);
                if (match) needsAttention.push(`\u{1F4CB} ${match[0].slice(0, 100)}`);
              }
            }
            if (msg.role === "assistant" && text) {
              const lowerText = text.toLowerCase();
              ["\u2705", "done", "created", "updated", "fixed", "deployed"].forEach((keyword) => {
                if (lowerText.includes(keyword)) {
                  const lines = text.split("\n").filter((l) => l.toLowerCase().includes(keyword));
                  lines.slice(0, 2).forEach((line) => {
                    if (line.length > 5 && line.length < 150) {
                      facts.push(line.trim().slice(0, 100));
                    }
                  });
                }
              });
            }
          });
          let summary = "No activity yet.";
          const userMessages = messages.filter((m) => m.role === "user");
          const assistantMessages = messages.filter((m) => m.role === "assistant");
          let topics = [];
          if (messages.length > 0) {
            summary = `${messages.length} messages (${userMessages.length} user, ${assistantMessages.length} assistant). `;
            const allText = messages.map((m) => m.text).join(" ");
            topics = detectTopics(allText);
            if (topics.length > 0) {
              summary += `Topics: ${topics.join(", ")}.`;
            }
          }
          const toolsArray = Object.entries(tools).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
          const ageMs = sessionInfo.ageMs || 0;
          const lastActive = ageMs < 6e4 ? "Just now" : ageMs < 36e5 ? `${Math.round(ageMs / 6e4)} minutes ago` : ageMs < 864e5 ? `${Math.round(ageMs / 36e5)} hours ago` : `${Math.round(ageMs / 864e5)} days ago`;
          let channelDisplay = "Other";
          if (sessionInfo.groupChannel) {
            channelDisplay = sessionInfo.groupChannel;
          } else if (sessionInfo.displayName) {
            channelDisplay = sessionInfo.displayName;
          } else if (sessionKey.includes("slack")) {
            const parts = sessionKey.split(":");
            const channelIdx = parts.indexOf("channel");
            if (channelIdx >= 0 && parts[channelIdx + 1]) {
              const channelId = parts[channelIdx + 1].toLowerCase();
              channelDisplay = CHANNEL_MAP[channelId] || `#${channelId}`;
            } else {
              channelDisplay = "Slack";
            }
          } else if (sessionKey.includes("telegram")) {
            channelDisplay = "Telegram";
          }
          const finalTotalTokens = totalInputTokens + totalOutputTokens || sessionInfo.totalTokens || 0;
          const finalInputTokens = totalInputTokens || sessionInfo.inputTokens || 0;
          const finalOutputTokens = totalOutputTokens || sessionInfo.outputTokens || 0;
          const modelDisplay = (detectedModel || sessionInfo.model || "-").replace("anthropic/", "").replace("openai/", "");
          return {
            key: sessionKey,
            kind: sessionInfo.kind,
            channel: channelDisplay,
            groupChannel: sessionInfo.groupChannel || channelDisplay,
            model: modelDisplay,
            tokens: finalTotalTokens,
            inputTokens: finalInputTokens,
            outputTokens: finalOutputTokens,
            cacheRead: totalCacheRead,
            cacheWrite: totalCacheWrite,
            estCost: totalCost > 0 ? `$${totalCost.toFixed(4)}` : null,
            lastActive,
            summary,
            topics,
            // Array of detected topics
            facts: [...new Set(facts)].slice(0, 8),
            needsAttention: [...new Set(needsAttention)].slice(0, 5),
            tools: toolsArray.slice(0, 10),
            messages: messages.slice(-15).reverse().map((m) => ({
              role: m.role,
              text: m.text.slice(0, 500)
            }))
          };
        } catch (e) {
          console.error("Failed to get session detail:", e.message);
          return { error: e.message };
        }
      }
      return {
        findTranscriptPath,
        getSessionOriginator,
        getSessionTopic,
        mapSession,
        refreshSessionsCache,
        getSessionsCached,
        getSessions,
        readTranscript,
        getSessionDetail,
        parseSessionLabel
      };
    }
    module2.exports = { createSessionsModule: createSessionsModule2, CHANNEL_MAP };
  }
});

// src/cron.js
var require_cron = __commonJS({
  "src/cron.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function cronToHuman(expr) {
      if (!expr || expr === "\u2014") return null;
      const parts = expr.split(" ");
      if (parts.length < 5) return null;
      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      function formatTime(h, m) {
        const hNum = parseInt(h, 10);
        const mNum = parseInt(m, 10);
        if (isNaN(hNum)) return null;
        const ampm = hNum >= 12 ? "pm" : "am";
        const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
        return mNum === 0 ? `${h12}${ampm}` : `${h12}:${mNum.toString().padStart(2, "0")}${ampm}`;
      }
      if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return "Every minute";
      }
      if (minute.startsWith("*/")) {
        const interval = minute.slice(2);
        return `Every ${interval} minutes`;
      }
      if (hour.startsWith("*/")) {
        const interval = hour.slice(2);
        const minStr = minute === "0" ? "" : `:${minute.padStart(2, "0")}`;
        return `Every ${interval} hours${minStr ? " at " + minStr : ""}`;
      }
      if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return `Hourly at :${minute.padStart(2, "0")}`;
      }
      let timeStr = "";
      if (minute !== "*" && hour !== "*" && !hour.startsWith("*/")) {
        timeStr = formatTime(hour, minute);
      }
      if (timeStr && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return `Daily at ${timeStr}`;
      }
      if ((dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") && dayOfMonth === "*" && month === "*") {
        return timeStr ? `Weekdays at ${timeStr}` : "Weekdays";
      }
      if ((dayOfWeek === "0,6" || dayOfWeek === "6,0") && dayOfMonth === "*" && month === "*") {
        return timeStr ? `Weekends at ${timeStr}` : "Weekends";
      }
      if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
        const days = dayOfWeek.split(",").map((d) => {
          const num = parseInt(d, 10);
          return dayNames[num] || d;
        });
        const dayStr = days.length === 1 ? days[0] : days.join(", ");
        return timeStr ? `${dayStr} at ${timeStr}` : `Every ${dayStr}`;
      }
      if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
        const day = parseInt(dayOfMonth, 10);
        const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
        return timeStr ? `${day}${suffix} of month at ${timeStr}` : `${day}${suffix} of every month`;
      }
      if (timeStr) {
        return `At ${timeStr}`;
      }
      return expr;
    }
    function readCronState(getOpenClawDir2) {
      try {
        const statePath = path2.join(getOpenClawDir2(), "cron", "jobs-state.json");
        if (fs2.existsSync(statePath)) {
          const data = JSON.parse(fs2.readFileSync(statePath, "utf8"));
          return data.jobs || {};
        }
      } catch (e) {
        console.error("Failed to read cron state:", e.message);
      }
      return {};
    }
    function getCronJobs2(getOpenClawDir2) {
      try {
        const cronPath = path2.join(getOpenClawDir2(), "cron", "jobs.json");
        if (fs2.existsSync(cronPath)) {
          const data = JSON.parse(fs2.readFileSync(cronPath, "utf8"));
          const liveState = readCronState(getOpenClawDir2);
          return (data.jobs || []).map((j) => {
            const state2 = liveState[j.id]?.state || j.state || {};
            let scheduleStr = "\u2014";
            let scheduleHuman = null;
            if (j.schedule) {
              if (j.schedule.kind === "cron" && j.schedule.expr) {
                scheduleStr = j.schedule.expr;
                scheduleHuman = cronToHuman(j.schedule.expr);
              } else if (j.schedule.kind === "once") {
                scheduleStr = "once";
                scheduleHuman = "One-time";
              } else if (j.schedule.kind === "every" && j.schedule.everyMs) {
                const mins = Math.round(j.schedule.everyMs / 6e4);
                scheduleHuman = `Every ${mins} minutes`;
                scheduleStr = `*/${mins} * * * *`;
              }
            }
            let nextRunStr = "\u2014";
            const nextRunMs = state2.nextRunAtMs;
            if (nextRunMs) {
              const next = new Date(nextRunMs);
              const now = /* @__PURE__ */ new Date();
              const diffMs = next - now;
              const diffMins = Math.round(diffMs / 6e4);
              if (diffMins < 0) {
                nextRunStr = "overdue";
              } else if (diffMins < 60) {
                nextRunStr = `${diffMins}m`;
              } else if (diffMins < 1440) {
                nextRunStr = `${Math.round(diffMins / 60)}h`;
              } else {
                nextRunStr = `${Math.round(diffMins / 1440)}d`;
              }
            }
            let lastRunStr = null;
            if (state2.lastRunAtMs) {
              const last = new Date(state2.lastRunAtMs);
              const now = /* @__PURE__ */ new Date();
              const diffMs = now - last;
              const diffMins = Math.round(diffMs / 6e4);
              if (diffMins < 60) {
                lastRunStr = `${diffMins}m ago`;
              } else if (diffMins < 1440) {
                lastRunStr = `${Math.round(diffMins / 60)}h ago`;
              } else {
                lastRunStr = `${Math.round(diffMins / 1440)}d ago`;
              }
            }
            return {
              id: j.id,
              name: j.name || j.id.slice(0, 8),
              description: j.description || "",
              schedule: scheduleStr,
              scheduleHuman,
              nextRun: nextRunStr,
              nextRunAtMs: state2.nextRunAtMs || null,
              enabled: j.enabled !== false,
              lastStatus: state2.lastStatus || state2.lastRunStatus || null,
              lastError: state2.lastError || null,
              lastRunAtMs: state2.lastRunAtMs || null,
              lastRunStr,
              lastDurationMs: state2.lastDurationMs || null,
              consecutiveErrors: state2.consecutiveErrors || 0,
              lastDelivered: state2.lastDelivered !== false
            };
          });
        }
      } catch (e) {
        console.error("Failed to get cron:", e.message);
      }
      return [];
    }
    module2.exports = {
      cronToHuman,
      getCronJobs: getCronJobs2,
      readCronState
    };
  }
});

// src/cerebro.js
var require_cerebro = __commonJS({
  "src/cerebro.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { formatTimeAgo } = require_utils();
    function getCerebroTopics2(cerebroDir, options = {}) {
      const { offset = 0, limit = 20, status: filterStatus = "all" } = options;
      const topicsDir = path2.join(cerebroDir, "topics");
      const orphansDir = path2.join(cerebroDir, "orphans");
      const topics = [];
      const result = {
        initialized: false,
        cerebroPath: cerebroDir,
        topics: { active: 0, resolved: 0, parked: 0, total: 0 },
        threads: 0,
        orphans: 0,
        recentTopics: [],
        lastUpdated: null
      };
      try {
        if (!fs2.existsSync(cerebroDir)) {
          return result;
        }
        result.initialized = true;
        let latestModified = null;
        if (!fs2.existsSync(topicsDir)) {
          return result;
        }
        const topicNames = fs2.readdirSync(topicsDir).filter((name) => {
          const topicPath = path2.join(topicsDir, name);
          return fs2.statSync(topicPath).isDirectory() && !name.startsWith("_");
        });
        topicNames.forEach((name) => {
          const topicMdPath = path2.join(topicsDir, name, "topic.md");
          const topicDirPath = path2.join(topicsDir, name);
          let stat;
          let content2 = "";
          if (fs2.existsSync(topicMdPath)) {
            stat = fs2.statSync(topicMdPath);
            content2 = fs2.readFileSync(topicMdPath, "utf8");
          } else {
            stat = fs2.statSync(topicDirPath);
          }
          try {
            const frontmatterMatch = content2.match(/^---\n([\s\S]*?)\n---/);
            let title = name;
            let topicStatus = "active";
            let category = "general";
            let created = null;
            if (frontmatterMatch) {
              const frontmatter = frontmatterMatch[1];
              const titleMatch = frontmatter.match(/title:\s*(.+)/);
              const statusMatch = frontmatter.match(/status:\s*(.+)/);
              const categoryMatch = frontmatter.match(/category:\s*(.+)/);
              const createdMatch = frontmatter.match(/created:\s*(.+)/);
              if (titleMatch) title = titleMatch[1].trim();
              if (statusMatch) topicStatus = statusMatch[1].trim().toLowerCase();
              if (categoryMatch) category = categoryMatch[1].trim();
              if (createdMatch) created = createdMatch[1].trim();
            }
            const threadsDir = path2.join(topicsDir, name, "threads");
            let threadCount = 0;
            if (fs2.existsSync(threadsDir)) {
              threadCount = fs2.readdirSync(threadsDir).filter((f) => f.endsWith(".md") || f.endsWith(".json")).length;
            }
            result.threads += threadCount;
            if (topicStatus === "active") result.topics.active++;
            else if (topicStatus === "resolved") result.topics.resolved++;
            else if (topicStatus === "parked") result.topics.parked++;
            if (!latestModified || stat.mtime > latestModified) {
              latestModified = stat.mtime;
            }
            topics.push({
              name,
              title,
              status: topicStatus,
              category,
              created,
              threads: threadCount,
              lastModified: stat.mtimeMs
            });
          } catch (e) {
            console.error(`Failed to parse topic ${name}:`, e.message);
          }
        });
        result.topics.total = topics.length;
        const statusPriority = { active: 0, resolved: 1, parked: 2 };
        topics.sort((a, b) => {
          const statusDiff = (statusPriority[a.status] || 3) - (statusPriority[b.status] || 3);
          if (statusDiff !== 0) return statusDiff;
          return b.lastModified - a.lastModified;
        });
        let filtered = topics;
        if (filterStatus !== "all") {
          filtered = topics.filter((t) => t.status === filterStatus);
        }
        const paginated = filtered.slice(offset, offset + limit);
        result.recentTopics = paginated.map((t) => ({
          name: t.name,
          title: t.title,
          status: t.status,
          threads: t.threads,
          age: formatTimeAgo(new Date(t.lastModified))
        }));
        if (fs2.existsSync(orphansDir)) {
          try {
            result.orphans = fs2.readdirSync(orphansDir).filter((f) => f.endsWith(".md")).length;
          } catch (e) {
          }
        }
        result.lastUpdated = latestModified ? latestModified.toISOString() : null;
      } catch (e) {
        console.error("Failed to get Cerebro topics:", e.message);
      }
      return result;
    }
    function updateTopicStatus2(cerebroDir, topicId, newStatus) {
      const topicDir = path2.join(cerebroDir, "topics", topicId);
      const topicFile = path2.join(topicDir, "topic.md");
      if (!fs2.existsSync(topicDir)) {
        return { error: `Topic '${topicId}' not found`, code: 404 };
      }
      if (!fs2.existsSync(topicFile)) {
        const content3 = `---
title: ${topicId}
status: ${newStatus}
category: general
created: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}
---

# ${topicId}

## Overview
*Topic tracking file.*

## Notes
`;
        fs2.writeFileSync(topicFile, content3, "utf8");
        return {
          topic: {
            id: topicId,
            name: topicId,
            title: topicId,
            status: newStatus
          }
        };
      }
      let content2 = fs2.readFileSync(topicFile, "utf8");
      let title = topicId;
      const frontmatterMatch = content2.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        let frontmatter = frontmatterMatch[1];
        const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/i);
        if (titleMatch) title = titleMatch[1];
        if (frontmatter.includes("status:")) {
          frontmatter = frontmatter.replace(
            /status:\s*(active|resolved|parked)/i,
            `status: ${newStatus}`
          );
        } else {
          frontmatter = frontmatter.trim() + `
status: ${newStatus}`;
        }
        content2 = content2.replace(/^---\n[\s\S]*?\n---/, `---
${frontmatter}
---`);
      } else {
        const headerMatch = content2.match(/^#\s*(.+)/m);
        if (headerMatch) title = headerMatch[1];
        const frontmatter = `---
title: ${title}
status: ${newStatus}
category: general
created: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}
---

`;
        content2 = frontmatter + content2;
      }
      fs2.writeFileSync(topicFile, content2, "utf8");
      return {
        topic: {
          id: topicId,
          name: topicId,
          title,
          status: newStatus
        }
      };
    }
    module2.exports = {
      getCerebroTopics: getCerebroTopics2,
      updateTopicStatus: updateTopicStatus2
    };
  }
});

// src/tokens.js
var require_tokens = __commonJS({
  "src/tokens.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { formatNumber, formatTokens } = require_utils();
    var TOKEN_RATES = {
      input: 15,
      // $15/1M input tokens
      output: 75,
      // $75/1M output tokens
      cacheRead: 1.5,
      // $1.50/1M (90% discount from input)
      cacheWrite: 18.75
      // $18.75/1M (25% premium on input)
    };
    var tokenUsageCache = { data: null, timestamp: 0, refreshing: false };
    var TOKEN_USAGE_CACHE_TTL = 3e4;
    var refreshInterval = null;
    function emptyUsageBucket() {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
    }
    async function refreshTokenUsageAsync2(getOpenClawDir2) {
      if (tokenUsageCache.refreshing) return;
      tokenUsageCache.refreshing = true;
      try {
        const sessionsDir = path2.join(getOpenClawDir2(), "agents", "main", "sessions");
        const files = await fs2.promises.readdir(sessionsDir);
        const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1e3;
        const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1e3;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1e3;
        const usage24h = emptyUsageBucket();
        const usage3d = emptyUsageBucket();
        const usage7d = emptyUsageBucket();
        const batchSize = 50;
        for (let i = 0; i < jsonlFiles.length; i += batchSize) {
          const batch = jsonlFiles.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (file) => {
              const filePath = path2.join(sessionsDir, file);
              try {
                const stat = await fs2.promises.stat(filePath);
                if (stat.mtimeMs < sevenDaysAgo) return;
                const content2 = await fs2.promises.readFile(filePath, "utf8");
                const lines = content2.trim().split("\n");
                for (const line of lines) {
                  if (!line) continue;
                  try {
                    const entry = JSON.parse(line);
                    const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
                    if (entryTime < sevenDaysAgo) continue;
                    if (entry.message?.usage) {
                      const u = entry.message.usage;
                      const input = u.input || 0;
                      const output = u.output || 0;
                      const cacheRead = u.cacheRead || 0;
                      const cacheWrite = u.cacheWrite || 0;
                      const cost = u.cost?.total || 0;
                      if (entryTime >= oneDayAgo) {
                        usage24h.input += input;
                        usage24h.output += output;
                        usage24h.cacheRead += cacheRead;
                        usage24h.cacheWrite += cacheWrite;
                        usage24h.cost += cost;
                        usage24h.requests++;
                      }
                      if (entryTime >= threeDaysAgo) {
                        usage3d.input += input;
                        usage3d.output += output;
                        usage3d.cacheRead += cacheRead;
                        usage3d.cacheWrite += cacheWrite;
                        usage3d.cost += cost;
                        usage3d.requests++;
                      }
                      usage7d.input += input;
                      usage7d.output += output;
                      usage7d.cacheRead += cacheRead;
                      usage7d.cacheWrite += cacheWrite;
                      usage7d.cost += cost;
                      usage7d.requests++;
                    }
                  } catch (e) {
                  }
                }
              } catch (e) {
              }
            })
          );
          await new Promise((resolve) => setImmediate(resolve));
        }
        const finalizeBucket = (bucket) => ({
          ...bucket,
          tokensNoCache: bucket.input + bucket.output,
          tokensWithCache: bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite
        });
        const result = {
          // Primary (24h) for backward compatibility
          ...finalizeBucket(usage24h),
          // All three windows
          windows: {
            "24h": finalizeBucket(usage24h),
            "3d": finalizeBucket(usage3d),
            "7d": finalizeBucket(usage7d)
          }
        };
        tokenUsageCache = { data: result, timestamp: Date.now(), refreshing: false };
        console.log(
          `[Token Usage] Cached: 24h=${usage24h.requests} 3d=${usage3d.requests} 7d=${usage7d.requests} requests`
        );
      } catch (e) {
        console.error("[Token Usage] Refresh error:", e.message);
        tokenUsageCache.refreshing = false;
      }
    }
    function getDailyTokenUsage2(getOpenClawDir2) {
      const now = Date.now();
      const isStale = now - tokenUsageCache.timestamp > TOKEN_USAGE_CACHE_TTL;
      if (isStale && !tokenUsageCache.refreshing && getOpenClawDir2) {
        refreshTokenUsageAsync2(getOpenClawDir2);
      }
      const emptyResult = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
        windows: {
          "24h": {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            requests: 0,
            tokensNoCache: 0,
            tokensWithCache: 0
          },
          "3d": {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            requests: 0,
            tokensNoCache: 0,
            tokensWithCache: 0
          },
          "7d": {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            requests: 0,
            tokensNoCache: 0,
            tokensWithCache: 0
          }
        }
      };
      return tokenUsageCache.data || emptyResult;
    }
    function calculateCostForBucket(bucket, rates = TOKEN_RATES) {
      const inputCost = bucket.input / 1e6 * rates.input;
      const outputCost = bucket.output / 1e6 * rates.output;
      const cacheReadCost = bucket.cacheRead / 1e6 * rates.cacheRead;
      const cacheWriteCost = bucket.cacheWrite / 1e6 * rates.cacheWrite;
      return {
        inputCost,
        outputCost,
        cacheReadCost,
        cacheWriteCost,
        totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost
      };
    }
    function getCostBreakdown2(config, getSessions, getOpenClawDir2) {
      const usage = getDailyTokenUsage2(getOpenClawDir2);
      if (!usage) {
        return { error: "Failed to get usage data" };
      }
      const costs = calculateCostForBucket(usage);
      const planCost = config.billing?.claudePlanCost || 200;
      const planName = config.billing?.claudePlanName || "Claude Code Max";
      const windowConfigs = {
        "24h": { days: 1, label: "24h" },
        "3d": { days: 3, label: "3dma" },
        "7d": { days: 7, label: "7dma" }
      };
      const windows = {};
      for (const [key, windowConfig] of Object.entries(windowConfigs)) {
        const bucket = usage.windows?.[key] || usage;
        const bucketCosts = calculateCostForBucket(bucket);
        const dailyAvg = bucketCosts.totalCost / windowConfig.days;
        const monthlyProjected = dailyAvg * 30;
        const monthlySavings = monthlyProjected - planCost;
        windows[key] = {
          label: windowConfig.label,
          days: windowConfig.days,
          totalCost: bucketCosts.totalCost,
          dailyAvg,
          monthlyProjected,
          monthlySavings,
          savingsPercent: monthlySavings > 0 ? Math.round(monthlySavings / monthlyProjected * 100) : 0,
          requests: bucket.requests,
          tokens: {
            input: bucket.input,
            output: bucket.output,
            cacheRead: bucket.cacheRead,
            cacheWrite: bucket.cacheWrite
          }
        };
      }
      return {
        // Raw token counts (24h for backward compatibility)
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        requests: usage.requests,
        // Pricing rates
        rates: {
          input: TOKEN_RATES.input.toFixed(2),
          output: TOKEN_RATES.output.toFixed(2),
          cacheRead: TOKEN_RATES.cacheRead.toFixed(2),
          cacheWrite: TOKEN_RATES.cacheWrite.toFixed(2)
        },
        // Cost calculation breakdown (24h)
        calculation: {
          inputCost: costs.inputCost,
          outputCost: costs.outputCost,
          cacheReadCost: costs.cacheReadCost,
          cacheWriteCost: costs.cacheWriteCost
        },
        // Totals (24h for backward compatibility)
        totalCost: costs.totalCost,
        planCost,
        planName,
        // Period
        period: "24 hours",
        // Multi-window data for moving averages
        windows,
        // Top sessions by tokens
        topSessions: getTopSessionsByTokens(5, getSessions)
      };
    }
    function getTopSessionsByTokens(limit = 5, getSessions) {
      try {
        const sessions2 = getSessions({ limit: null });
        return sessions2.filter((s) => s.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, limit).map((s) => ({
          label: s.label,
          tokens: s.tokens,
          channel: s.channel,
          active: s.active
        }));
      } catch (e) {
        console.error("[TopSessions] Error:", e.message);
        return [];
      }
    }
    function getTokenStats2(sessions2, capacity, config = {}) {
      let activeMainCount = capacity?.main?.active ?? 0;
      let activeSubagentCount = capacity?.subagent?.active ?? 0;
      let activeCount = activeMainCount + activeSubagentCount;
      let mainLimit = capacity?.main?.max ?? 12;
      let subagentLimit = capacity?.subagent?.max ?? 24;
      if (!capacity && sessions2 && sessions2.length > 0) {
        activeCount = 0;
        activeMainCount = 0;
        activeSubagentCount = 0;
        sessions2.forEach((s) => {
          if (s.active) {
            activeCount++;
            if (s.key && s.key.includes(":subagent:")) {
              activeSubagentCount++;
            } else {
              activeMainCount++;
            }
          }
        });
      }
      const usage = getDailyTokenUsage2();
      const totalInput = usage?.input || 0;
      const totalOutput = usage?.output || 0;
      const total = totalInput + totalOutput;
      const costs = calculateCostForBucket(usage);
      const estCost = costs.totalCost;
      const planCost = config?.billing?.claudePlanCost ?? 200;
      const planName = config?.billing?.claudePlanName ?? "Claude Code Max";
      const monthlyApiCost = estCost * 30;
      const monthlySavings = monthlyApiCost - planCost;
      const savingsPositive = monthlySavings > 0;
      const sessionCount = sessions2?.length || 1;
      const avgTokensPerSession = Math.round(total / sessionCount);
      const avgCostPerSession = estCost / sessionCount;
      const windowConfigs = {
        "24h": { days: 1, label: "24h" },
        "3dma": { days: 3, label: "3dma" },
        "7dma": { days: 7, label: "7dma" }
      };
      const savingsWindows = {};
      for (const [key, windowConfig] of Object.entries(windowConfigs)) {
        const bucketKey = key.replace("dma", "d").replace("24h", "24h");
        const bucket = usage.windows?.[bucketKey === "24h" ? "24h" : bucketKey] || usage;
        const bucketCosts = calculateCostForBucket(bucket);
        const dailyAvg = bucketCosts.totalCost / windowConfig.days;
        const monthlyProjected = dailyAvg * 30;
        const windowSavings = monthlyProjected - planCost;
        const windowSavingsPositive = windowSavings > 0;
        savingsWindows[key] = {
          label: windowConfig.label,
          estCost: `$${formatNumber(dailyAvg)}`,
          estMonthlyCost: `$${Math.round(monthlyProjected).toLocaleString()}`,
          estSavings: windowSavingsPositive ? `$${formatNumber(windowSavings)}/mo` : null,
          savingsPercent: windowSavingsPositive ? Math.round(windowSavings / monthlyProjected * 100) : 0,
          requests: bucket.requests
        };
      }
      return {
        total: formatTokens(total),
        input: formatTokens(totalInput),
        output: formatTokens(totalOutput),
        cacheRead: formatTokens(usage?.cacheRead || 0),
        cacheWrite: formatTokens(usage?.cacheWrite || 0),
        requests: usage?.requests || 0,
        activeCount,
        activeMainCount,
        activeSubagentCount,
        mainLimit,
        subagentLimit,
        estCost: `$${formatNumber(estCost)}`,
        planCost: `$${planCost.toFixed(0)}`,
        planName,
        // 24h savings (backward compatible)
        estSavings: savingsPositive ? `$${formatNumber(monthlySavings)}/mo` : null,
        savingsPercent: savingsPositive ? Math.round(monthlySavings / monthlyApiCost * 100) : 0,
        estMonthlyCost: `$${Math.round(monthlyApiCost).toLocaleString()}`,
        // Multi-window savings (24h, 3da, 7da)
        savingsWindows,
        // Per-session averages
        avgTokensPerSession: formatTokens(avgTokensPerSession),
        avgCostPerSession: `$${avgCostPerSession.toFixed(2)}`,
        sessionCount
      };
    }
    function startTokenUsageRefresh2(getOpenClawDir2) {
      refreshTokenUsageAsync2(getOpenClawDir2);
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      refreshInterval = setInterval(() => {
        refreshTokenUsageAsync2(getOpenClawDir2);
      }, TOKEN_USAGE_CACHE_TTL);
      return refreshInterval;
    }
    module2.exports = {
      TOKEN_RATES,
      emptyUsageBucket,
      refreshTokenUsageAsync: refreshTokenUsageAsync2,
      getDailyTokenUsage: getDailyTokenUsage2,
      calculateCostForBucket,
      getCostBreakdown: getCostBreakdown2,
      getTopSessionsByTokens,
      getTokenStats: getTokenStats2,
      startTokenUsageRefresh: startTokenUsageRefresh2
    };
  }
});

// src/llm-usage.js
var require_llm_usage = __commonJS({
  "src/llm-usage.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { execFile } = require("child_process");
    var { getSafeEnv, isCliAvailable, recordCliSuccess, recordCliFailure } = require_openclaw();
    var llmUsageCache = { data: null, timestamp: 0, refreshing: false };
    var LLM_CACHE_TTL_MS = 6e4;
    function refreshLlmUsageAsync() {
      if (llmUsageCache.refreshing) return;
      if (!isCliAvailable()) return;
      llmUsageCache.refreshing = true;
      const profile = process.env.OPENCLAW_PROFILE || "";
      const args2 = profile ? ["--profile", profile, "status", "--usage", "--json"] : ["status", "--usage", "--json"];
      execFile(
        "openclaw",
        args2,
        { encoding: "utf8", timeout: 2e4, env: getSafeEnv() },
        (err, stdout) => {
          llmUsageCache.refreshing = false;
          if (err) {
            recordCliFailure();
            return;
          }
          recordCliSuccess();
          try {
            const jsonStart = stdout.indexOf("{");
            const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
            const parsed = JSON.parse(jsonStr);
            if (parsed.usage) {
              const result = transformLiveUsageData(parsed.usage);
              llmUsageCache.data = result;
              llmUsageCache.timestamp = Date.now();
              console.log("[LLM Usage] Cache refreshed");
            }
          } catch (e) {
            console.error("[LLM Usage] Parse error:", e.message);
          }
        }
      );
    }
    function transformLiveUsageData(usage) {
      const anthropic = usage.providers?.find((p) => p.provider === "anthropic");
      const codexProvider = usage.providers?.find((p) => p.provider === "openai-codex");
      if (anthropic?.error) {
        return {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          source: "error",
          error: anthropic.error,
          errorType: anthropic.error.includes("403") ? "auth" : "unknown",
          claude: {
            session: { usedPct: null, remainingPct: null, resetsIn: null, error: anthropic.error },
            weekly: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
            sonnet: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
            lastSynced: null
          },
          codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
          routing: {
            total: 0,
            claudeTasks: 0,
            codexTasks: 0,
            claudePct: 0,
            codexPct: 0,
            codexFloor: 20
          }
        };
      }
      const session5h = anthropic?.windows?.find((w) => w.label === "5h");
      const weekAll = anthropic?.windows?.find((w) => w.label === "Week");
      const sonnetWeek = anthropic?.windows?.find((w) => w.label === "Sonnet");
      const codex5h = codexProvider?.windows?.find((w) => w.label === "5h");
      const codexDay = codexProvider?.windows?.find((w) => w.label === "Day");
      const formatReset = (resetAt) => {
        if (!resetAt) return "?";
        const diff = resetAt - Date.now();
        if (diff < 0) return "now";
        if (diff < 36e5) return Math.round(diff / 6e4) + "m";
        if (diff < 864e5) return Math.round(diff / 36e5) + "h";
        return Math.round(diff / 864e5) + "d";
      };
      return {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        source: "live",
        claude: {
          session: {
            usedPct: Math.round(session5h?.usedPercent || 0),
            remainingPct: Math.round(100 - (session5h?.usedPercent || 0)),
            resetsIn: formatReset(session5h?.resetAt)
          },
          weekly: {
            usedPct: Math.round(weekAll?.usedPercent || 0),
            remainingPct: Math.round(100 - (weekAll?.usedPercent || 0)),
            resets: formatReset(weekAll?.resetAt)
          },
          sonnet: {
            usedPct: Math.round(sonnetWeek?.usedPercent || 0),
            remainingPct: Math.round(100 - (sonnetWeek?.usedPercent || 0)),
            resets: formatReset(sonnetWeek?.resetAt)
          },
          lastSynced: (/* @__PURE__ */ new Date()).toISOString()
        },
        codex: {
          sessionsToday: 0,
          tasksToday: 0,
          usage5hPct: Math.round(codex5h?.usedPercent || 0),
          usageDayPct: Math.round(codexDay?.usedPercent || 0)
        },
        routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 }
      };
    }
    function getLlmUsage2(statePath) {
      const now = Date.now();
      if (!llmUsageCache.data || now - llmUsageCache.timestamp > LLM_CACHE_TTL_MS) {
        refreshLlmUsageAsync();
      }
      if (llmUsageCache.data && llmUsageCache.data.source !== "error") {
        return llmUsageCache.data;
      }
      const stateFile = path2.join(statePath, "llm-routing.json");
      try {
        if (fs2.existsSync(stateFile)) {
          const data = JSON.parse(fs2.readFileSync(stateFile, "utf8"));
          const sessionValid = data.claude?.session?.resets_in && data.claude.session.resets_in !== "unknown";
          const weeklyValid = data.claude?.weekly_all_models?.resets && data.claude.weekly_all_models.resets !== "unknown";
          if (sessionValid || weeklyValid) {
            return {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              source: "file",
              claude: {
                session: {
                  usedPct: Math.round((data.claude?.session?.used_pct || 0) * 100),
                  remainingPct: Math.round((data.claude?.session?.remaining_pct || 1) * 100),
                  resetsIn: data.claude?.session?.resets_in || "?"
                },
                weekly: {
                  usedPct: Math.round((data.claude?.weekly_all_models?.used_pct || 0) * 100),
                  remainingPct: Math.round((data.claude?.weekly_all_models?.remaining_pct || 1) * 100),
                  resets: data.claude?.weekly_all_models?.resets || "?"
                },
                sonnet: {
                  usedPct: Math.round((data.claude?.weekly_sonnet?.used_pct || 0) * 100),
                  remainingPct: Math.round((data.claude?.weekly_sonnet?.remaining_pct || 1) * 100),
                  resets: data.claude?.weekly_sonnet?.resets || "?"
                },
                lastSynced: data.claude?.last_synced || null
              },
              codex: {
                sessionsToday: data.codex?.sessions_today || 0,
                tasksToday: data.codex?.tasks_today || 0,
                usage5hPct: data.codex?.usage_5h_pct || 0,
                usageDayPct: data.codex?.usage_day_pct || 0
              },
              routing: {
                total: data.routing?.total_tasks || 0,
                claudeTasks: data.routing?.claude_tasks || 0,
                codexTasks: data.routing?.codex_tasks || 0,
                claudePct: data.routing?.total_tasks > 0 ? Math.round(data.routing.claude_tasks / data.routing.total_tasks * 100) : 0,
                codexPct: data.routing?.total_tasks > 0 ? Math.round(data.routing.codex_tasks / data.routing.total_tasks * 100) : 0,
                codexFloor: Math.round((data.routing?.codex_floor_pct || 0.2) * 100)
              }
            };
          }
        }
      } catch (e) {
        console.error("[LLM Usage] File fallback failed:", e.message);
      }
      return {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        source: "error",
        error: "API key lacks user:profile OAuth scope \u2014 using /api/ollama-usage for Ollama stats",
        errorType: "auth",
        claude: {
          session: { usedPct: null, remainingPct: null, resetsIn: null, error: "Auth required" },
          weekly: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
          sonnet: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
          lastSynced: null
        },
        codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
        routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 },
        ollamaEndpoint: "/api/ollama-usage"
      };
    }
    function getRoutingStats2(skillsPath, statePath, hours = 24) {
      const safeHours = parseInt(hours, 10) || 24;
      try {
        const { execFileSync } = require("child_process");
        const skillDir = path2.join(skillsPath, "llm_routing");
        const output = execFileSync(
          "python",
          ["-m", "llm_routing", "stats", "--hours", String(safeHours), "--json"],
          {
            encoding: "utf8",
            timeout: 1e4,
            cwd: skillDir,
            env: getSafeEnv()
          }
        );
        return JSON.parse(output);
      } catch (e) {
        try {
          const logFile = path2.join(statePath, "routing-log.jsonl");
          if (!fs2.existsSync(logFile)) {
            return { total_requests: 0, by_model: {}, by_task_type: {} };
          }
          const cutoff = Date.now() - hours * 3600 * 1e3;
          const lines = fs2.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
          const stats = {
            total_requests: 0,
            by_model: {},
            by_task_type: {},
            escalations: 0,
            avg_latency_ms: 0,
            success_rate: 0
          };
          let latencies = [];
          let successes = 0;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              const ts = new Date(entry.timestamp).getTime();
              if (ts < cutoff) continue;
              stats.total_requests++;
              const model = entry.selected_model || "unknown";
              stats.by_model[model] = (stats.by_model[model] || 0) + 1;
              const tt = entry.task_type || "unknown";
              stats.by_task_type[tt] = (stats.by_task_type[tt] || 0) + 1;
              if (entry.escalation_reason) stats.escalations++;
              if (entry.latency_ms) latencies.push(entry.latency_ms);
              if (entry.success === true) successes++;
            } catch {
            }
          }
          if (latencies.length > 0) {
            stats.avg_latency_ms = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
          }
          if (stats.total_requests > 0) {
            stats.success_rate = Math.round(successes / stats.total_requests * 100);
          }
          return stats;
        } catch (e2) {
          console.error("Failed to read routing stats:", e2.message);
          return { error: e2.message };
        }
      }
    }
    function startLlmUsageRefresh2() {
      setTimeout(() => refreshLlmUsageAsync(), 1e3);
      setInterval(() => refreshLlmUsageAsync(), LLM_CACHE_TTL_MS);
    }
    module2.exports = {
      refreshLlmUsageAsync,
      transformLiveUsageData,
      getLlmUsage: getLlmUsage2,
      getRoutingStats: getRoutingStats2,
      startLlmUsageRefresh: startLlmUsageRefresh2
    };
  }
});

// src/actions.js
var require_actions = __commonJS({
  "src/actions.js"(exports2, module2) {
    var ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
      "gateway-status",
      "gateway-restart",
      "sessions-list",
      "cron-list",
      "health-check",
      "clear-stale-sessions"
    ]);
    function executeAction2(action, deps) {
      const { runOpenClaw: runOpenClaw2, extractJSON: extractJSON2, PORT: PORT2 } = deps;
      const results = { success: false, action, output: "", error: null };
      if (!ALLOWED_ACTIONS.has(action)) {
        results.error = `Unknown action: ${action}`;
        return results;
      }
      try {
        switch (action) {
          case "gateway-status":
            results.output = runOpenClaw2("gateway status 2>&1") || "Unknown";
            results.success = true;
            break;
          case "gateway-restart":
            results.output = "To restart gateway, run: openclaw gateway restart";
            results.success = true;
            results.note = "Dashboard cannot restart gateway for safety";
            break;
          case "sessions-list":
            results.output = runOpenClaw2("sessions 2>&1") || "No sessions";
            results.success = true;
            break;
          case "cron-list":
            results.output = runOpenClaw2("cron list 2>&1") || "No cron jobs";
            results.success = true;
            break;
          case "health-check": {
            const gateway = runOpenClaw2("gateway status 2>&1");
            const sessions2 = runOpenClaw2("sessions --json 2>&1");
            let sessionCount = 0;
            try {
              const data = JSON.parse(sessions2);
              sessionCount = data.sessions?.length || 0;
            } catch (e) {
            }
            results.output = [
              `Gateway: ${gateway?.includes("running") ? "OK Running" : "NOT Running"}`,
              `Sessions: ${sessionCount}`,
              `Dashboard: OK Running on port ${PORT2}`
            ].join("\n");
            results.success = true;
            break;
          }
          case "clear-stale-sessions": {
            const staleOutput = runOpenClaw2("sessions --json 2>&1");
            let staleCount = 0;
            try {
              const staleJson = extractJSON2(staleOutput);
              if (staleJson) {
                const data = JSON.parse(staleJson);
                staleCount = (data.sessions || []).filter((s) => s.ageMs > 24 * 60 * 60 * 1e3).length;
              }
            } catch (e) {
            }
            results.output = `Found ${staleCount} stale sessions (>24h old).
To clean: openclaw sessions prune`;
            results.success = true;
            break;
          }
        }
      } catch (e) {
        results.error = e.message;
      }
      return results;
    }
    module2.exports = { executeAction: executeAction2, ALLOWED_ACTIONS };
  }
});

// src/data.js
var require_data = __commonJS({
  "src/data.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function migrateDataDir2(dataDir, legacyDataDir) {
      try {
        if (!fs2.existsSync(legacyDataDir)) return;
        if (!fs2.existsSync(dataDir)) {
          fs2.mkdirSync(dataDir, { recursive: true });
        }
        const legacyFiles = fs2.readdirSync(legacyDataDir);
        if (legacyFiles.length === 0) return;
        let migrated = 0;
        for (const file of legacyFiles) {
          const srcPath = path2.join(legacyDataDir, file);
          const destPath = path2.join(dataDir, file);
          if (fs2.existsSync(destPath)) continue;
          const stat = fs2.statSync(srcPath);
          if (stat.isFile()) {
            fs2.copyFileSync(srcPath, destPath);
            migrated++;
            console.log(`[Migration] Copied ${file} to profile-aware data dir`);
          }
        }
        if (migrated > 0) {
          console.log(`[Migration] Migrated ${migrated} file(s) to ${dataDir}`);
          console.log(`[Migration] Legacy data preserved at ${legacyDataDir}`);
        }
      } catch (e) {
        console.error("[Migration] Failed to migrate data:", e.message);
      }
    }
    module2.exports = { migrateDataDir: migrateDataDir2 };
  }
});

// src/state.js
var require_state = __commonJS({
  "src/state.js"(exports2, module2) {
    var fs2 = require("fs");
    var os = require("os");
    var path2 = require("path");
    var { execFileSync } = require("child_process");
    var { formatBytes, formatTimeAgo } = require_utils();
    function createStateModule2(deps) {
      const {
        CONFIG: CONFIG2,
        getOpenClawDir: getOpenClawDir2,
        getSessions,
        getSystemVitals: getSystemVitals2,
        getCronJobs: getCronJobs2,
        loadOperators: loadOperators2,
        calculateOperatorStats: calculateOperatorStats2,
        getLlmUsage: getLlmUsage2,
        getDailyTokenUsage: getDailyTokenUsage2,
        getTokenStats: getTokenStats2,
        getCerebroTopics: getCerebroTopics2,
        runOpenClaw: runOpenClaw2,
        extractJSON: extractJSON2,
        readTranscript
      } = deps;
      const PATHS2 = CONFIG2.paths;
      let cachedState = null;
      let lastStateUpdate = 0;
      const STATE_CACHE_TTL = 3e4;
      let stateRefreshInterval = null;
      function getSystemStatus() {
        const hostname = os.hostname();
        let uptime = "\u2014";
        try {
          const uptimeRaw = execFileSync("uptime", [], { encoding: "utf8" });
          const match = uptimeRaw.match(/up\s+([^,]+)/);
          if (match) uptime = match[1].trim();
        } catch (e) {
        }
        let gateway = "Unknown";
        try {
          const status = runOpenClaw2("gateway status 2>/dev/null");
          if (status && status.includes("running")) {
            gateway = "Running";
          } else if (status && status.includes("stopped")) {
            gateway = "Stopped";
          }
        } catch (e) {
        }
        return {
          hostname,
          gateway,
          model: "claude-opus-4-5",
          uptime
        };
      }
      function getRecentActivity() {
        const activities = [];
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const memoryFile = path2.join(PATHS2.memory, `${today}.md`);
        try {
          if (fs2.existsSync(memoryFile)) {
            const content2 = fs2.readFileSync(memoryFile, "utf8");
            const lines = content2.split("\n").filter((l) => l.startsWith("- "));
            lines.slice(-5).forEach((line) => {
              const text = line.replace(/^- /, "").slice(0, 80);
              activities.push({
                icon: text.includes("\u2705") ? "\u2705" : text.includes("\u274C") ? "\u274C" : "\u{1F4DD}",
                text: text.replace(/[\u2705\u274C\uD83D\uDCDD\uD83D\uDD27]/g, "").trim(),
                time: today
              });
            });
          }
        } catch (e) {
          console.error("Failed to read activity:", e.message);
        }
        return activities.reverse();
      }
      function getCapacity() {
        const result = {
          main: { active: 0, max: 12 },
          subagent: { active: 0, max: 24 }
        };
        const openclawDir = getOpenClawDir2();
        try {
          const configPath = path2.join(openclawDir, "openclaw.json");
          if (fs2.existsSync(configPath)) {
            const config = JSON.parse(fs2.readFileSync(configPath, "utf8"));
            if (config?.agents?.defaults?.maxConcurrent) {
              result.main.max = config.agents.defaults.maxConcurrent;
            }
            if (config?.agents?.defaults?.subagents?.maxConcurrent) {
              result.subagent.max = config.agents.defaults.subagents.maxConcurrent;
            }
          }
        } catch (e) {
        }
        try {
          const output = runOpenClaw2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const sessions2 = data.sessions || [];
            const fiveMinMs = 5 * 60 * 1e3;
            for (const s of sessions2) {
              if (s.ageMs > fiveMinMs) continue;
              const key = s.key || "";
              if (key.includes(":subagent:") || key.includes(":cron:")) {
                result.subagent.active++;
              } else {
                result.main.active++;
              }
            }
            return result;
          }
        } catch (e) {
          console.error("Failed to get capacity from sessions, falling back to filesystem:", e.message);
        }
        try {
          const sessionsDir = path2.join(openclawDir, "agents", "main", "sessions");
          if (fs2.existsSync(sessionsDir)) {
            const fiveMinAgo = Date.now() - 5 * 60 * 1e3;
            const files = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
            let mainActive = 0;
            let subActive = 0;
            for (const file of files) {
              try {
                const filePath = path2.join(sessionsDir, file);
                const stat = fs2.statSync(filePath);
                if (stat.mtimeMs < fiveMinAgo) continue;
                let isSubagent = false;
                try {
                  const fd = fs2.openSync(filePath, "r");
                  const buffer = Buffer.alloc(512);
                  fs2.readSync(fd, buffer, 0, 512, 0);
                  fs2.closeSync(fd);
                  const firstLine = buffer.toString("utf8").split("\n")[0];
                  const parsed = JSON.parse(firstLine);
                  const key = parsed.key || parsed.id || "";
                  isSubagent = key.includes(":subagent:") || key.includes(":cron:");
                } catch (parseErr) {
                  isSubagent = file.includes("subagent");
                }
                if (isSubagent) {
                  subActive++;
                } else {
                  mainActive++;
                }
              } catch (e) {
              }
            }
            result.main.active = mainActive;
            result.subagent.active = subActive;
          }
        } catch (e) {
          console.error("Failed to count active sessions from filesystem:", e.message);
        }
        return result;
      }
      function getMemoryStats() {
        const memoryDir = PATHS2.memory;
        const memoryFile = path2.join(PATHS2.workspace, "MEMORY.md");
        const stats = {
          totalFiles: 0,
          totalSize: 0,
          totalSizeFormatted: "0 B",
          memoryMdSize: 0,
          memoryMdSizeFormatted: "0 B",
          memoryMdLines: 0,
          recentFiles: [],
          oldestFile: null,
          newestFile: null
        };
        try {
          const collectMemoryFiles = (dir, baseDir) => {
            const entries = fs2.readdirSync(dir, { withFileTypes: true });
            const files = [];
            for (const entry of entries) {
              const entryPath = path2.join(dir, entry.name);
              if (entry.isDirectory()) {
                files.push(...collectMemoryFiles(entryPath, baseDir));
              } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
                const stat = fs2.statSync(entryPath);
                const relativePath = path2.relative(baseDir, entryPath);
                files.push({
                  name: relativePath,
                  size: stat.size,
                  sizeFormatted: formatBytes(stat.size),
                  modified: stat.mtime
                });
              }
            }
            return files;
          };
          if (fs2.existsSync(memoryFile)) {
            const memStat = fs2.statSync(memoryFile);
            stats.memoryMdSize = memStat.size;
            stats.memoryMdSizeFormatted = formatBytes(memStat.size);
            const content2 = fs2.readFileSync(memoryFile, "utf8");
            stats.memoryMdLines = content2.split("\n").length;
            stats.totalSize += memStat.size;
            stats.totalFiles++;
          }
          if (fs2.existsSync(memoryDir)) {
            const files = collectMemoryFiles(memoryDir, memoryDir).sort(
              (a, b) => b.modified - a.modified
            );
            stats.totalFiles += files.length;
            files.forEach((f) => stats.totalSize += f.size);
            stats.recentFiles = files.slice(0, 5).map((f) => ({
              name: f.name,
              sizeFormatted: f.sizeFormatted,
              age: formatTimeAgo(f.modified)
            }));
            if (files.length > 0) {
              stats.newestFile = files[0].name;
              stats.oldestFile = files[files.length - 1].name;
            }
          }
          stats.totalSizeFormatted = formatBytes(stats.totalSize);
        } catch (e) {
          console.error("Failed to get memory stats:", e.message);
        }
        return stats;
      }
      function getData() {
        const allSessions = getSessions({ limit: null });
        const pageSize = 20;
        const displaySessions = allSessions.slice(0, pageSize);
        const tokenStats = getTokenStats2(allSessions);
        const capacity = getCapacity();
        const memory = getMemoryStats();
        const statusCounts = {
          all: allSessions.length,
          live: allSessions.filter((s) => s.active).length,
          recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
          idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length
        };
        const totalPages = Math.ceil(allSessions.length / pageSize);
        return {
          sessions: displaySessions,
          tokenStats,
          capacity,
          memory,
          pagination: {
            page: 1,
            pageSize,
            total: allSessions.length,
            totalPages,
            hasPrev: false,
            hasNext: totalPages > 1
          },
          statusCounts
        };
      }
      function getFullState() {
        const now = Date.now();
        if (cachedState && now - lastStateUpdate < STATE_CACHE_TTL) {
          return cachedState;
        }
        let sessions2 = [];
        let tokenStats = {};
        let statusCounts = { all: 0, live: 0, recent: 0, idle: 0 };
        let vitals = {};
        let capacity = {};
        let operators = { operators: [], roles: {} };
        let llmUsage = {};
        let cron = [];
        let memory = {};
        let cerebro = {};
        let subagents = [];
        let allSessions = [];
        let totalSessionCount = 0;
        try {
          allSessions = getSessions({ limit: null });
          totalSessionCount = allSessions.length;
          sessions2 = allSessions.slice(0, 20);
        } catch (e) {
          console.error("[State] sessions:", e.message);
        }
        try {
          vitals = getSystemVitals2();
        } catch (e) {
          console.error("[State] vitals:", e.message);
        }
        try {
          capacity = getCapacity();
        } catch (e) {
          console.error("[State] capacity:", e.message);
        }
        try {
          tokenStats = getTokenStats2(allSessions, capacity, CONFIG2);
        } catch (e) {
          console.error("[State] tokenStats:", e.message);
        }
        try {
          const liveSessions = allSessions.filter((s) => s.active);
          const recentSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
          const idleSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
          statusCounts = {
            all: totalSessionCount,
            live: liveSessions.length,
            recent: recentSessions.length,
            idle: idleSessions.length
          };
        } catch (e) {
          console.error("[State] statusCounts:", e.message);
        }
        try {
          const operatorData = loadOperators2();
          operators = calculateOperatorStats2(operatorData, allSessions);
        } catch (e) {
          console.error("[State] operators:", e.message);
        }
        try {
          llmUsage = getLlmUsage2();
        } catch (e) {
          console.error("[State] llmUsage:", e.message);
        }
        try {
          cron = getCronJobs2();
        } catch (e) {
          console.error("[State] cron:", e.message);
        }
        try {
          memory = getMemoryStats();
        } catch (e) {
          console.error("[State] memory:", e.message);
        }
        try {
          cerebro = getCerebroTopics2();
        } catch (e) {
          console.error("[State] cerebro:", e.message);
        }
        try {
          const retentionHours = parseInt(process.env.SUBAGENT_RETENTION_HOURS || "12", 10);
          const retentionMs = retentionHours * 60 * 60 * 1e3;
          subagents = allSessions.filter((s) => s.sessionKey && s.sessionKey.includes(":subagent:")).filter((s) => (s.minutesAgo || 0) * 6e4 < retentionMs).map((s) => {
            const match = s.sessionKey.match(/:subagent:([a-f0-9-]+)$/);
            const subagentId = match ? match[1] : s.sessionId;
            return {
              id: subagentId,
              shortId: subagentId.slice(0, 8),
              task: s.label || s.displayName || "Sub-agent task",
              tokens: s.tokens || 0,
              ageMs: (s.minutesAgo || 0) * 6e4,
              active: s.active,
              recentlyActive: s.recentlyActive
            };
          });
        } catch (e) {
          console.error("[State] subagents:", e.message);
        }
        cachedState = {
          vitals,
          sessions: sessions2,
          tokenStats,
          statusCounts,
          capacity,
          operators,
          llmUsage,
          cron,
          memory,
          cerebro,
          subagents,
          pagination: {
            page: 1,
            pageSize: 20,
            total: totalSessionCount,
            totalPages: Math.max(1, Math.ceil(totalSessionCount / 20)),
            hasPrev: false,
            hasNext: totalSessionCount > 20
          },
          timestamp: now
        };
        lastStateUpdate = now;
        return cachedState;
      }
      function refreshState() {
        lastStateUpdate = 0;
        return getFullState();
      }
      function startStateRefresh(broadcastSSE2, intervalMs = 3e4) {
        if (stateRefreshInterval) return;
        stateRefreshInterval = setInterval(() => {
          try {
            const newState = refreshState();
            broadcastSSE2("update", newState);
          } catch (e) {
            console.error("[State] Refresh error:", e.message);
          }
        }, intervalMs);
        console.log(`[State] Background refresh started (${intervalMs}ms interval)`);
      }
      function stopStateRefresh() {
        if (stateRefreshInterval) {
          clearInterval(stateRefreshInterval);
          stateRefreshInterval = null;
          console.log("[State] Background refresh stopped");
        }
      }
      function getSubagentStatus() {
        const subagents = [];
        try {
          const output = runOpenClaw2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const subagentSessions = (data.sessions || []).filter(
              (s) => s.key && s.key.includes(":subagent:")
            );
            for (const s of subagentSessions) {
              const ageMs = s.ageMs || Infinity;
              const isActive = ageMs < 5 * 60 * 1e3;
              const isRecent = ageMs < 30 * 60 * 1e3;
              const match = s.key.match(/:subagent:([a-f0-9-]+)$/);
              const subagentId = match ? match[1] : s.sessionId;
              const shortId = subagentId.slice(0, 8);
              let taskSummary = "Unknown task";
              let label = null;
              const transcript = readTranscript(s.sessionId);
              for (const entry of transcript.slice(0, 15)) {
                if (entry.type === "message" && entry.message?.role === "user") {
                  const content2 = entry.message.content;
                  let text = "";
                  if (typeof content2 === "string") {
                    text = content2;
                  } else if (Array.isArray(content2)) {
                    const textPart = content2.find((c) => c.type === "text");
                    if (textPart) text = textPart.text || "";
                  }
                  if (!text) continue;
                  const labelMatch = text.match(/Label:\s*([^\n]+)/i);
                  if (labelMatch) {
                    label = labelMatch[1].trim();
                  }
                  let taskMatch = text.match(/You were created to handle:\s*\*\*([^*]+)\*\*/i);
                  if (taskMatch) {
                    taskSummary = taskMatch[1].trim();
                    break;
                  }
                  taskMatch = text.match(/\*\*([A-Z]{2,5}-\d+:\s*[^*]+)\*\*/);
                  if (taskMatch) {
                    taskSummary = taskMatch[1].trim();
                    break;
                  }
                  const firstLine = text.split("\n")[0].replace(/^\*\*|\*\*$/g, "").trim();
                  if (firstLine.length > 10 && firstLine.length < 100) {
                    taskSummary = firstLine;
                    break;
                  }
                }
              }
              const messageCount = transcript.filter(
                (e) => e.type === "message" && e.message?.role
              ).length;
              subagents.push({
                id: subagentId,
                shortId,
                sessionId: s.sessionId,
                label: label || shortId,
                task: taskSummary,
                model: s.model?.replace("anthropic/", "") || "unknown",
                status: isActive ? "active" : isRecent ? "idle" : "stale",
                ageMs,
                ageFormatted: ageMs < 6e4 ? "Just now" : ageMs < 36e5 ? `${Math.round(ageMs / 6e4)}m ago` : `${Math.round(ageMs / 36e5)}h ago`,
                messageCount,
                tokens: s.totalTokens || 0
              });
            }
          }
        } catch (e) {
          console.error("Failed to get subagent status:", e.message);
        }
        return subagents.sort((a, b) => a.ageMs - b.ageMs);
      }
      return {
        getSystemStatus,
        getRecentActivity,
        getCapacity,
        getMemoryStats,
        getFullState,
        refreshState,
        startStateRefresh,
        stopStateRefresh,
        getData,
        getSubagentStatus
      };
    }
    module2.exports = { createStateModule: createStateModule2 };
  }
});

// src/mission-control.js
var require_mission_control = __commonJS({
  "src/mission-control.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var DEFAULT_DATA_DIR = path2.join(
      process.env.HOME || "/Users/michaeljones",
      ".openclaw/workspace/mission-control"
    );
    function ensureDataDir(dataDir = DEFAULT_DATA_DIR) {
      if (!fs2.existsSync(dataDir)) {
        fs2.mkdirSync(dataDir, { recursive: true });
      }
      return dataDir;
    }
    function safeReadJson(filePath, fallback) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const raw = fs2.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.error(`[mission-control] Failed to read ${filePath}: ${e.message}`);
        return fallback;
      }
    }
    function safeWriteJson(filePath, data) {
      try {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return true;
      } catch (e) {
        console.error(`[mission-control] Failed to write ${filePath}: ${e.message}`);
        return false;
      }
    }
    var DISMISSED_FILE = path2.join(
      process.env.HOME || "/Users/michaeljones",
      ".openclaw/workspace/Corvus/Operations/mission-control-dismissed.json"
    );
    function readDismissed() {
      return safeReadJson(DISMISSED_FILE, { dismissedIds: [] });
    }
    function writeDismissed(data) {
      ensureDataDir(path2.dirname(DISMISSED_FILE));
      return safeWriteJson(DISMISSED_FILE, data);
    }
    function addDismissed(id) {
      const data = readDismissed();
      if (data.dismissedIds.some((d) => d.id === id)) return data;
      data.dismissedIds.push({ id, dismissedAt: (/* @__PURE__ */ new Date()).toISOString() });
      writeDismissed(data);
      return data;
    }
    function removeDismissed(id) {
      const data = readDismissed();
      const before = data.dismissedIds.length;
      data.dismissedIds = data.dismissedIds.filter((d) => d.id !== id);
      const changed = data.dismissedIds.length !== before;
      if (changed) writeDismissed(data);
      return data;
    }
    function isDismissed(id) {
      const data = readDismissed();
      return data.dismissedIds.some((d) => d.id === id);
    }
    function getDismissedIdSet() {
      const data = readDismissed();
      return new Set(data.dismissedIds.map((d) => d.id));
    }
    function readCronState(getOpenClawDir2) {
      const statePath = path2.join(getOpenClawDir2(), "cron", "jobs-state.json");
      const data = safeReadJson(statePath, { version: 1, jobs: {} });
      return data.jobs || {};
    }
    function readCronJobs(getOpenClawDir2) {
      const jobsPath = path2.join(getOpenClawDir2(), "cron", "jobs.json");
      const data = safeReadJson(jobsPath, { version: 1, jobs: [] });
      return data.jobs || [];
    }
    function getRecentCronFailures2(getOpenClawDir2, hoursWindow = 24) {
      const state2 = readCronState(getOpenClawDir2);
      const jobs = readCronJobs(getOpenClawDir2);
      const now = Date.now();
      const cutoff = now - hoursWindow * 60 * 60 * 1e3;
      const failures = [];
      for (const job of jobs) {
        const s = state2[job.id]?.state || {};
        const lastRunAt = s.lastRunAtMs || 0;
        const lastStatus = s.lastStatus || s.lastRunStatus || null;
        const lastError = s.lastError || null;
        const consecutive = s.consecutiveErrors || 0;
        if (lastRunAt < cutoff) continue;
        if (lastStatus !== "error" && !lastError) continue;
        if (lastStatus === "ok" && !lastError) continue;
        failures.push({
          id: job.id,
          name: job.name || job.id.slice(0, 8),
          description: job.description || "",
          lastStatus,
          lastError,
          lastRunAtMs: lastRunAt,
          consecutiveErrors: consecutive,
          lastDurationMs: s.lastDurationMs || 0,
          enabled: job.enabled !== false
        });
      }
      failures.sort((a, b) => b.lastRunAtMs - a.lastRunAtMs);
      return failures;
    }
    var BRAIN_DUMP_FILE = "brain-dump.json";
    function readBrainDump(dataDir) {
      ensureDataDir(dataDir);
      return safeReadJson(path2.join(dataDir, BRAIN_DUMP_FILE), []);
    }
    function writeBrainDump(dataDir, tasks) {
      ensureDataDir(dataDir);
      return safeWriteJson(path2.join(dataDir, BRAIN_DUMP_FILE), tasks);
    }
    function deriveMode(parsed = {}) {
      if (parsed.mode) return parsed.mode;
      const tags = (parsed.tags || []).map((t) => String(t).toLowerCase().replace(/^#/, ""));
      if (tags.includes("assigned-corvus") && parsed.assignee === "corvus") {
        return "autonomous";
      }
      if (tags.includes("planning") || tags.includes("assigned-mike")) {
        return "planning";
      }
      if (parsed.assignee === "corvus" || parsed.assignee === "claude") {
        return "autonomous";
      }
      if (parsed.assignee === "mike" || parsed.assignee === "anna") {
        return "planning";
      }
      return null;
    }
    function addBrainDump(dataDir, rawText, parsed = {}) {
      const tasks = readBrainDump(dataDir);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const id = `bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const explicitMode = parsed.mode || null;
      const derived = explicitMode || deriveMode(parsed);
      const modeSetBy = explicitMode ? "mike" : "auto";
      const task = {
        id,
        rawText,
        title: parsed.title || rawText.slice(0, 80),
        description: parsed.description || rawText,
        project: parsed.project || null,
        priority: parsed.priority || null,
        // "urgent-important" | "important-not-urgent" | "urgent-not-important" | "neither"
        due: parsed.due || null,
        assignee: parsed.assignee || null,
        // "corvus" | "claude" | "mike" | null
        tags: parsed.tags || [],
        status: "unsorted",
        createdAt: now,
        updatedAt: now,
        postponeCount: 0,
        iceboxFrozenUntil: null,
        // Planning vs Autonomous (Phase 4, 2026-06-25)
        // Values: "planning" | "autonomous" | "mixed" | null (legacy = needs triage)
        mode: derived,
        modeSetAt: now,
        modeSetBy,
        // "mike" | "corvus" | "auto"
        // Phase 2: Obsidian sync fields
        obsidianRef: null,
        // "[[2026-06-09#^task-7d4f]]"
        blockId: null,
        // "task-7d4f"
        mdLine: null,
        // cached markdown line
        archivedAt: null,
        archiveReason: null
      };
      tasks.push(task);
      writeBrainDump(dataDir, tasks);
      return task;
    }
    function updateBrainDumpTask(dataDir, id, updates) {
      const tasks = readBrainDump(dataDir);
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) return null;
      const existing = tasks[idx];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const next = { ...existing, ...updates, updatedAt: now };
      if (Object.prototype.hasOwnProperty.call(updates, "mode") && updates.mode !== existing.mode) {
        next.modeSetAt = now;
        next.modeSetBy = updates.modeSetBy || "mike";
      }
      if (existing.mode == null && next.mode == null && (updates.assignee !== void 0 || updates.tags !== void 0)) {
        const derived = deriveMode({
          assignee: next.assignee,
          tags: next.tags
        });
        if (derived) {
          next.mode = derived;
          next.modeSetAt = now;
          next.modeSetBy = "auto";
        }
      }
      if (!Object.prototype.hasOwnProperty.call(updates, "lastTouchedAt")) {
        next.lastTouchedAt = now;
      }
      tasks[idx] = next;
      writeBrainDump(dataDir, tasks);
      return tasks[idx];
    }
    function deleteBrainDumpTask(dataDir, id) {
      const tasks = readBrainDump(dataDir);
      const next = tasks.filter((t) => t.id !== id);
      writeBrainDump(dataDir, next);
      return tasks.length !== next.length;
    }
    function filterTasksByPriority(tasks, priority) {
      switch (priority) {
        case "unsorted":
          return tasks.filter(
            (t) => t.status === "unsorted" || t.status === "backlog" || !t.priority && t.status !== "icebox"
          );
        case "urgent-important":
          return tasks.filter((t) => t.priority === "urgent-important");
        case "schedule":
        case "important-not-urgent":
          return tasks.filter((t) => t.priority === "important-not-urgent");
        case "delegate":
        case "urgent-not-important":
          return tasks.filter(
            (t) => t.priority === "urgent-not-important" || t.assignee === "corvus" || t.assignee === "claude"
          );
        case "icebox":
          return tasks.filter((t) => t.status === "icebox");
        default:
          return tasks;
      }
    }
    var ACTIVITY_FEED_FILE = "activity-feed.json";
    var MAX_FEED_ENTRIES = 200;
    function appendActivity(dataDir, entry) {
      ensureDataDir(dataDir);
      const feed = readActivity(dataDir);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const item = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts: now,
        type: entry.type || "info",
        source: entry.source || "unknown",
        severity: entry.severity || "info",
        message: entry.message || "",
        actionUrl: entry.actionUrl || null,
        acknowledged: false
      };
      feed.unshift(item);
      if (feed.length > MAX_FEED_ENTRIES) {
        feed.length = MAX_FEED_ENTRIES;
      }
      writeActivity(dataDir, feed);
      return item;
    }
    function readActivity(dataDir) {
      ensureDataDir(dataDir);
      return safeReadJson(path2.join(dataDir, ACTIVITY_FEED_FILE), []);
    }
    function writeActivity(dataDir, feed) {
      ensureDataDir(dataDir);
      return safeWriteJson(path2.join(dataDir, ACTIVITY_FEED_FILE), feed);
    }
    function acknowledgeActivity(dataDir, id) {
      const feed = readActivity(dataDir);
      const item = feed.find((f) => f.id === id);
      if (!item) return null;
      item.acknowledged = true;
      item.acknowledgedAt = (/* @__PURE__ */ new Date()).toISOString();
      writeActivity(dataDir, feed);
      return item;
    }
    function dismissActivity(dataDir, id) {
      const feed = readActivity(dataDir);
      const next = feed.filter((f) => f.id !== id);
      writeActivity(dataDir, next);
      return feed.length !== next.length;
    }
    function getThreeThings(getOpenClawDir2, dataDir) {
      const items = [];
      const dismissedSet = getDismissedIdSet();
      const failures = getRecentCronFailures2(getOpenClawDir2, 24);
      for (const f of failures.slice(0, 3)) {
        const id = `cron:${f.id}`;
        if (dismissedSet.has(id)) continue;
        items.push({
          id,
          kind: "failure",
          icon: "\u{1F534}",
          severity: "critical",
          title: f.name,
          detail: f.lastError ? f.lastError.slice(0, 120) : `Status: ${f.lastStatus}`,
          source: "openclaw-cron",
          actionUrl: `/api/cron/${f.id}/runs`,
          meta: {
            consecutiveErrors: f.consecutiveErrors,
            lastRunAtMs: f.lastRunAtMs
          }
        });
      }
      const tasks = readBrainDump(dataDir);
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1e3;
      const pendingDecisions = tasks.filter((t) => {
        const created = new Date(t.createdAt).getTime();
        const isOld = created < dayAgo;
        const needsDecision = t.status === "unsorted" || t.status === "backlog" || t.assignee === "mike" && t.status !== "done";
        return isOld && needsDecision;
      }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      for (const d of pendingDecisions.slice(0, 3)) {
        const id = `task:${d.id}`;
        if (dismissedSet.has(id)) continue;
        items.push({
          id,
          kind: "decision",
          icon: "\u{1F7E1}",
          severity: "warning",
          title: d.title,
          detail: `Waiting ${Math.round((now - new Date(d.createdAt).getTime()) / 36e5)}h \u2014 ${d.assignee || "unassigned"}`,
          source: "brain-dump",
          actionUrl: `#brain-dump/${d.id}`,
          meta: {
            createdAt: d.createdAt,
            assignee: d.assignee
          }
        });
      }
      const feed = readActivity(dataDir);
      const unacked = feed.filter(
        (f) => !f.acknowledged && (f.type === "failure" || f.type === "decision" || f.type === "completion")
      ).slice(0, 3);
      for (const u of unacked) {
        const id = `act:${u.id}`;
        if (dismissedSet.has(id)) continue;
        const icon = u.type === "failure" ? "\u{1F534}" : u.type === "decision" ? "\u{1F7E1}" : "\u{1F535}";
        items.push({
          id,
          kind: u.type,
          icon,
          severity: u.severity || "info",
          title: `${u.source}: ${u.message.slice(0, 60)}`,
          detail: u.message,
          source: u.source,
          actionUrl: u.actionUrl,
          meta: { ts: u.ts }
        });
      }
      const capped = items.slice(0, 3);
      return {
        items: capped,
        total: items.length,
        sources: {
          failures: failures.length,
          decisions: pendingDecisions.length,
          unacked: unacked.length
        }
      };
    }
    function getFilteredFeed(dataDir) {
      const feed = readActivity(dataDir);
      const alwaysShow = [];
      let digestCount = 0;
      let neverShowCount = 0;
      for (const item of feed) {
        if (item.type === "heartbeat") {
          neverShowCount++;
          continue;
        }
        if (item.type === "info" && item.severity !== "warning" && item.severity !== "critical") {
          digestCount++;
          continue;
        }
        alwaysShow.push(item);
      }
      return {
        items: alwaysShow,
        digestCount,
        neverShowCount,
        totalUnfiltered: feed.length
      };
    }
    function priorityEmojiForTask(t) {
      if (t.status === "icebox") return "\u{1F9CA}";
      if (t.priority === "urgent-important") return "\u{1F53A}";
      if (t.priority === "important-not-urgent") return "\u23EB";
      if (t.priority === "urgent-not-important") return "\u{1F53C}";
      return null;
    }
    var PRIORITY_RANK = { "\u{1F53A}": 4, "\u23EB": 3, "\u{1F53C}": 2, "\u23EC": 1, "\u{1F9CA}": 0 };
    function ageDaysForTask(t, nowMs = Date.now()) {
      const ts = t.lastTouchedAt || t.updatedAt || t.createdAt;
      if (!ts) return 0;
      const ms = nowMs - new Date(ts).getTime();
      if (Number.isNaN(ms)) return 0;
      return Math.max(0, Math.floor(ms / 864e5));
    }
    function todayDateLA() {
      const d = /* @__PURE__ */ new Date();
      const offset = d.getTimezoneOffset();
      const laOffset = 420;
      const adjusted = new Date(d.getTime() - (offset - laOffset) * 6e4);
      return adjusted.toISOString().slice(0, 10);
    }
    function shapeTaskForView(t) {
      const priorityEmoji = priorityEmojiForTask(t);
      const mode = t.mode == null ? null : t.mode;
      return {
        id: t.id,
        title: t.title || t.rawText || "Untitled",
        status: t.status,
        priority: priorityEmoji,
        due: t.due || null,
        project: t.project || null,
        assignee: t.assignee || null,
        tags: t.tags || [],
        mode,
        modeLabel: mode,
        // alias kept for legacy JS consumers
        modeSetBy: t.modeSetBy || null,
        modeSetAt: t.modeSetAt || null,
        postponeCount: t.postponeCount || 0,
        ageDays: ageDaysForTask(t),
        lastTouchedAt: t.lastTouchedAt || t.updatedAt || t.createdAt || null,
        createdAt: t.createdAt || null,
        source: t.source || "brain-dump",
        obsidianRef: t.obsidianRef || null,
        blockId: t.blockId || null
      };
    }
    function sortForToday(tasks) {
      return [...tasks].sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] || 0;
        const pb = PRIORITY_RANK[b.priority] || 0;
        if (pb !== pa) return pb - pa;
        return (b.ageDays || 0) - (a.ageDays || 0);
      });
    }
    function sortForOutstanding(tasks) {
      return [...tasks].sort((a, b) => {
        const ad = b.ageDays || 0;
        const bd = a.ageDays || 0;
        if (ad !== bd) return ad - bd;
        const pa = PRIORITY_RANK[a.priority] || 0;
        const pb = PRIORITY_RANK[b.priority] || 0;
        return pb - pa;
      });
    }
    function filterTasksForToday(tasks, options = {}) {
      const today = options.today || todayDateLA();
      return tasks.filter((t) => {
        if (t.status === "done" || t.status === "archived") return false;
        if (t.mode === "autonomous") return false;
        if (t.due == null) return true;
        return t.due <= today;
      });
    }
    function filterTasksForOutstanding(tasks) {
      return tasks.filter((t) => t.status !== "done" && t.status !== "archived");
    }
    function parseArrayParam(searchParams, name) {
      const all = searchParams.getAll(name);
      if (all.length === 0) return [];
      return all.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    }
    function applyPriorityFilter(tasks, priorities) {
      if (!priorities || priorities.length === 0) return tasks;
      const set = new Set(priorities);
      return tasks.filter((t) => {
        if (set.has(t.priority)) return true;
        return set.has("all");
      });
    }
    function applyProjectFilter(tasks, projects2) {
      if (!projects2 || projects2.length === 0) return tasks;
      const set = new Set(projects2.map((p) => String(p).toLowerCase()));
      return tasks.filter((t) => {
        const proj = (t.project || "").toLowerCase();
        return proj && set.has(proj);
      });
    }
    function applyModeFilter(tasks, modes) {
      if (!modes || modes.length === 0) return tasks;
      const set = new Set(modes);
      return tasks.filter((t) => {
        if (t.mode == null) return set.has("legacy") || set.has("null");
        return set.has(t.mode);
      });
    }
    var PROJECT_REGISTRY_FILE = "projects-registry.json";
    function readProjectRegistry(dataDir) {
      ensureDataDir(dataDir);
      return safeReadJson(path2.join(dataDir, PROJECT_REGISTRY_FILE), []);
    }
    function writeProjectRegistry(dataDir, projects2) {
      ensureDataDir(dataDir);
      return safeWriteJson(path2.join(dataDir, PROJECT_REGISTRY_FILE), projects2);
    }
    function slugify(s) {
      return String(s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "untitled";
    }
    function promoteTaskToProject(dataDir, taskId) {
      const tasks = readBrainDump(dataDir);
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) return { ok: false, error: "Task not found" };
      const task = tasks[idx];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: task.title,
        slug: slugify(task.title),
        parentId: task.parentId || null,
        createdAt: now,
        promotedToProjectAt: now,
        sourceTaskId: task.id,
        status: "open",
        links: {
          tags: task.tags || []
        }
      };
      const registry = readProjectRegistry(dataDir);
      registry.push(project);
      writeProjectRegistry(dataDir, registry);
      tasks[idx] = {
        ...task,
        type: "project",
        promotedToProjectAt: now,
        promotedToProjectId: project.id,
        updatedAt: now
      };
      if (task.parentId) {
        project.parentId = task.parentId;
      }
      writeBrainDump(dataDir, tasks);
      return { ok: true, project };
    }
    function createMissionControlAPI2(deps) {
      const { getOpenClawDir: getOpenClawDir2 } = deps;
      const dataDir = deps.dataDir || DEFAULT_DATA_DIR;
      ensureDataDir(dataDir);
      return {
        /**
         * GET /api/mission/three-things
         */
        threeThings(req, res) {
          const result = getThreeThings(getOpenClawDir2, dataDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
        },
        /**
         * POST /api/mission/three-things/dismiss   { id }
         * Removes an item from the Three Things list (persists to disk).
         */
        threeThingsDismiss(req, res) {
          let body = "";
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const { id } = JSON.parse(body);
              if (!id || typeof id !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "id is required" }));
                return;
              }
              addDismissed(id);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, id }, null, 2));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
            }
          });
        },
        /**
         * POST /api/mission/three-things/undismiss  { id }
         * Restores a previously dismissed item.
         */
        threeThingsUndismiss(req, res) {
          let body = "";
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const { id } = JSON.parse(body);
              if (!id || typeof id !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "id is required" }));
                return;
              }
              removeDismissed(id);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, id }, null, 2));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
            }
          });
        },
        /**
         * GET /api/mission/three-things/dismissed
         * Returns the dismissed-IDs list (for debugging / UI badge).
         */
        threeThingsDismissedList(req, res) {
          const data = readDismissed();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        },
        /**
         * GET /api/mission/braindump?priority=urgent-important
         * Optional ?priority= filter — restricts the returned task set by priority.
         * Special values:
         *   "all"         — no filter (default)
         *   "unsorted"    — status=unsorted OR no priority set
         *   "urgent-important" | "important-not-urgent" | "urgent-not-important" — by priority field
         *   "schedule" / "delegate" / "icebox" — semantic aliases that match the kanban column keys
         */
        brainDumpList(req, res) {
          const url = new URL(req.url, "http://x");
          const priority = url.searchParams.get("priority");
          const project = url.searchParams.get("project");
          const mode = url.searchParams.get("mode");
          let tasks = readBrainDump(dataDir);
          if (priority && priority !== "all") {
            tasks = filterTasksByPriority(tasks, priority);
          }
          const priorities = parseArrayParam(url.searchParams, "priority");
          if (priorities.length > 0 && priority !== "all") {
            tasks = applyPriorityFilter(tasks, priorities);
          }
          const projects2 = parseArrayParam(url.searchParams, "project");
          if (projects2.length > 0) {
            tasks = applyProjectFilter(tasks, projects2);
          }
          const modes = parseArrayParam(url.searchParams, "mode");
          if (modes.length > 0) {
            tasks = applyModeFilter(tasks, modes);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ tasks }, null, 2));
        },
        brainDumpCreate(req, res) {
          let body = "";
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const { rawText, parsed } = JSON.parse(body);
              if (!rawText || typeof rawText !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "rawText is required" }));
                return;
              }
              const task = addBrainDump(dataDir, rawText, parsed || {});
              appendActivity(dataDir, {
                type: "completion",
                source: "brain-dump",
                severity: "info",
                message: `New task: ${task.title}`
              });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ task }, null, 2));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
            }
          });
        },
        brainDumpUpdate(req, res, id) {
          let body = "";
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const updates = JSON.parse(body);
              const task = updateBrainDumpTask(dataDir, id, updates);
              if (!task) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Task not found" }));
                return;
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ task }, null, 2));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
            }
          });
        },
        brainDumpDelete(req, res, id) {
          const ok = deleteBrainDumpTask(dataDir, id);
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }, null, 2));
        },
        /**
         * GET /api/mission/feed
         * POST /api/mission/feed  { type, source, message, severity?, actionUrl? }
         * PATCH /api/mission/feed/:id/ack
         * DELETE /api/mission/feed/:id
         */
        feedList(req, res) {
          const result = getFilteredFeed(dataDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
        },
        feedAppend(req, res) {
          let body = "";
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const entry = JSON.parse(body);
              const item = appendActivity(dataDir, entry);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ item }, null, 2));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
            }
          });
        },
        feedAck(req, res, id) {
          const item = acknowledgeActivity(dataDir, id);
          if (!item) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ item }, null, 2));
        },
        feedDismiss(req, res, id) {
          const ok = dismissActivity(dataDir, id);
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }, null, 2));
        },
        /**
         * GET /api/mission/today
         * Returns Mike's inbox for today (planning-mode + legacy, not autonomous).
         *
         * Query params:
         *   ?priority=🔺&priority=⏫  - filter by priority emoji(s)
         *   ?project=rt               - filter by project tag(s)
         *   ?mode=planning            - filter by mode (default: planning+mixed+legacy)
         *
         * Response shape:
         *   {
         *     tasks: [...],           // shaped via shapeTaskForView
         *     count: N,
         *     planningCount: N,
         *     autonomousCount: N,     // 0 by design (Today excludes autonomous)
         *     legacyCount: N,         // tasks with mode == null
         *     mixedCount: N,
         *     asOf: ISO,
         *     today: "YYYY-MM-DD"
         *   }
         */
        today(req, res) {
          const url = new URL(req.url, "http://x");
          const today = todayDateLA();
          const all = readBrainDump(dataDir);
          let tasks = filterTasksForToday(all, { today });
          const projects2 = parseArrayParam(url.searchParams, "project");
          tasks = applyProjectFilter(tasks, projects2);
          let shaped = tasks.map((t) => shapeTaskForView(t));
          const priorities = parseArrayParam(url.searchParams, "priority");
          shaped = applyPriorityFilter(shaped, priorities);
          const counts = shaped.reduce(
            (acc, t) => {
              if (t.mode == null) acc.legacyCount++;
              else if (t.mode === "planning") acc.planningCount++;
              else if (t.mode === "mixed") acc.mixedCount++;
              else if (t.mode === "autonomous") acc.autonomousCount++;
              return acc;
            },
            { planningCount: 0, autonomousCount: 0, mixedCount: 0, legacyCount: 0 }
          );
          const STALLED_DAYS = 7;
          let stalledCount = 0;
          shaped = sortForToday(shaped).map((t) => {
            if (t.due && t.due < today) t.overdue = true;
            if ((t.ageDays || 0) >= STALLED_DAYS) {
              t.stalled = true;
              stalledCount++;
            }
            return t;
          });
          let obsidianTasks = [];
          try {
            obsidianTasks = deps.getDailyTasks ? deps.getDailyTasks(today) : [];
          } catch (e) {
            console.error("[mission-control] getDailyTasks failed:", e.message);
          }
          let brief = null;
          try {
            brief = deps.getBrief ? deps.getBrief() : null;
          } catch (e) {
            console.error("[mission-control] getBrief failed:", e.message);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              {
                tasks: shaped,
                count: shaped.length,
                ...counts,
                stalledCount,
                obsidianTasks,
                brief,
                asOf: (/* @__PURE__ */ new Date()).toISOString(),
                today
              },
              null,
              2
            )
          );
        },
        /**
         * GET /api/mission/tasks
         * General-purpose outstanding tasks endpoint.
         * Returns ALL open tasks (not just today), filtered by query params.
         *
         * Query params:
         *   ?priority=🔺&priority=⏫  - filter by priority emoji(s)
         *   ?project=rt               - filter by project tag(s)
         *   ?mode=autonomous          - filter by mode
         *   ?status=todo              - filter by status (single)
         *
         * Sort: age desc, then priority desc.
         */
        tasksList(req, res) {
          const url = new URL(req.url, "http://x");
          const all = readBrainDump(dataDir);
          let tasks = filterTasksForOutstanding(all);
          const projects2 = parseArrayParam(url.searchParams, "project");
          tasks = applyProjectFilter(tasks, projects2);
          const modes = parseArrayParam(url.searchParams, "mode");
          tasks = applyModeFilter(tasks, modes);
          const status = url.searchParams.get("status");
          if (status) tasks = tasks.filter((t) => t.status === status);
          let shaped = tasks.map((t) => shapeTaskForView(t));
          const priorities = parseArrayParam(url.searchParams, "priority");
          shaped = applyPriorityFilter(shaped, priorities);
          shaped = sortForOutstanding(shaped);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              {
                tasks: shaped,
                count: shaped.length,
                asOf: (/* @__PURE__ */ new Date()).toISOString()
              },
              null,
              2
            )
          );
        },
        /**
         * GET /api/mission/outstanding
         * Backwards-compat alias for /api/mission/tasks — same shape.
         * Returns ALL open tasks sorted by age (default: age desc).
         */
        outstanding(req, res) {
          return this.tasksList(req, res);
        },
        /**
         * POST /api/mission/tasks/:id/promote-to-project
         * "Task → Project (defer)" — when a task has ≥3 postponements OR the user
         * manually triggers it, convert the task into a project entry.
         *
         * Returns: { ok: true, project: {...} } or { ok: false, error }
         */
        promoteToProject(req, res, id) {
          const result = promoteTaskToProject(dataDir, id);
          if (!result.ok) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result, null, 2));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
        },
        /**
         * GET /api/mission/projects
         * Returns the project registry.
         */
        projectsList(req, res) {
          const projects2 = readProjectRegistry(dataDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ projects: projects2, count: projects2.length }, null, 2));
        },
        /**
         * GET /api/mission/cron-failures
         */
        cronFailures(req, res) {
          const hours = parseInt(new URL(req.url, "http://x").searchParams.get("hours") || "24", 10);
          const failures = getRecentCronFailures2(getOpenClawDir2, hours);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ failures }, null, 2));
        },
        // Expose data dir for tests / clients
        _dataDir: dataDir
      };
    }
    module2.exports = {
      createMissionControlAPI: createMissionControlAPI2,
      // Helpers (exported for tests)
      getRecentCronFailures: getRecentCronFailures2,
      getThreeThings,
      getFilteredFeed,
      readBrainDump,
      writeBrainDump,
      addBrainDump,
      updateBrainDumpTask,
      deleteBrainDumpTask,
      filterTasksByPriority,
      readActivity,
      appendActivity,
      acknowledgeActivity,
      dismissActivity,
      // Dismissed Three-Things state
      readDismissed,
      writeDismissed,
      addDismissed,
      removeDismissed,
      isDismissed,
      getDismissedIdSet,
      // Planning vs Autonomous (Phase 4)
      deriveMode,
      filterTasksForToday,
      filterTasksForOutstanding,
      shapeTaskForView,
      sortForToday,
      sortForOutstanding,
      applyPriorityFilter,
      applyProjectFilter,
      applyModeFilter,
      parseArrayParam,
      priorityEmojiForTask,
      ageDaysForTask,
      todayDateLA,
      // Project registry (Phase 4)
      readProjectRegistry,
      writeProjectRegistry,
      promoteTaskToProject,
      slugify,
      PROJECT_REGISTRY_FILE,
      DEFAULT_DATA_DIR,
      DISMISSED_FILE
    };
  }
});

// src/mc-phase2.js
var require_mc_phase2 = __commonJS({
  "src/mc-phase2.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { spawn } = require("child_process");
    var VAULT_DIR = path2.join(
      process.env.HOME || "/Users/michaeljones",
      "Dev/Obsidian/Mike_Thinking_Space"
    );
    var DAILY_PLANS_DIR = path2.join(VAULT_DIR, "Week and Daily Plans");
    var ROLLOVER_SCRIPT = path2.join(VAULT_DIR, "Scripts/task-rollover.py");
    var TOP_LEVEL_PROJECT_LINKS = {
      apollo: "[[Apollo Media Server]]",
      rt: "[[Resilient Tomorrow]]",
      vp: "[[Velocity Partners]]",
      corvus: "[[Corvus]]",
      ghn: "[[GHN]]",
      distills: "[[Distills]]"
    };
    var SUB_PROJECT_LINKS = {
      solar: "[[Projects/solar/Solar Build Plan]]",
      neighborhoodshare: "[[Projects/solar/Solar Build Plan]]"
      // alias
    };
    var VELOCITY_CAP_DEFAULT = 5;
    var AUTO_ARCHIVE_DAYS = 60;
    function ensureDataDir(dataDir) {
      if (!fs2.existsSync(dataDir)) {
        fs2.mkdirSync(dataDir, { recursive: true });
      }
      return dataDir;
    }
    function safeReadJson(filePath, fallback) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const raw = fs2.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.error(`[mc-phase2] Failed to read ${filePath}: ${e.message}`);
        return fallback;
      }
    }
    function safeWriteJson(filePath, data) {
      try {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return true;
      } catch (e) {
        console.error(`[mc-phase2] Failed to write ${filePath}: ${e.message}`);
        return false;
      }
    }
    function readBrainDump(dataDir) {
      ensureDataDir(dataDir);
      return safeReadJson(path2.join(dataDir, "brain-dump.json"), []);
    }
    function writeBrainDump(dataDir, tasks) {
      ensureDataDir(dataDir);
      return safeWriteJson(path2.join(dataDir, "brain-dump.json"), tasks);
    }
    function generateBlockId() {
      return Array.from(
        { length: 6 },
        () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
      ).join("");
    }
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
    function getTodayDate() {
      const d = /* @__PURE__ */ new Date();
      const offset = d.getTimezoneOffset();
      const laOffset = 420;
      const adjusted = new Date(d.getTime() - (offset - laOffset) * 6e4);
      return adjusted.toISOString().slice(0, 10);
    }
    function readDailyTasks2(dateStr, limit = 15) {
      const filePath = path2.join(DAILY_PLANS_DIR, `${dateStr}.md`);
      if (!fs2.existsSync(filePath)) return [];
      let content2 = "";
      try {
        content2 = fs2.readFileSync(filePath, "utf8");
      } catch {
        return [];
      }
      const tasks = [];
      for (const line of content2.split("\n")) {
        const m = line.match(/^\s*-\s*\[ \]\s+(.*)$/);
        if (!m) continue;
        const raw = m[1].trim();
        const refMatch = raw.match(/\^(task-[a-z0-9]+)\s*$/i);
        const ref = refMatch ? refMatch[1] : null;
        const text = raw.replace(/\s*\^task-[a-z0-9]+\s*$/i, "").trim();
        if (text) tasks.push({ text, raw, ref });
        if (tasks.length >= limit) break;
      }
      return tasks;
    }
    function ensureDailyNote(dateStr) {
      const filePath = path2.join(DAILY_PLANS_DIR, `${dateStr}.md`);
      if (fs2.existsSync(filePath)) {
        return filePath;
      }
      const content2 = `---
title: "${dateStr}"
accessed_by: "mission-control"
---

## Today's Focus

## By Project

## Notes

`;
      fs2.mkdirSync(DAILY_PLANS_DIR, { recursive: true });
      fs2.writeFileSync(filePath, content2, "utf8");
      return filePath;
    }
    function buildMarkdownTask(card, column) {
      const blockId = card.blockId || `task-${generateBlockId()}`;
      const dateStr = getTodayDate();
      let text = card.title || card.rawText || "Untitled task";
      const { links, unknown } = resolveProjectLinks(card.tags);
      if (links.length > 0) {
        text += " " + links.join(" ");
      }
      if (unknown.length > 0) {
        text += " " + unknown.map((t) => t.startsWith("#") ? t : `#${t}`).join(" ");
      }
      if (card.assignee) {
        text += ` #assigned-${card.assignee}`;
      }
      let priorityEmoji = "";
      if (column === "do-first" || column === "urgent-important") priorityEmoji = "\u{1F53A}";
      else if (column === "schedule" || column === "important-not-urgent") priorityEmoji = "\u23EB";
      else if (column === "icebox") priorityEmoji = "\u{1F9CA}";
      else if (column === "delegate" || column === "urgent-not-important") priorityEmoji = "\u{1F53C}";
      if (priorityEmoji) {
        text += ` ${priorityEmoji}`;
      }
      if (column === "do-first" || column === "urgent-important") {
        text += ` \u{1F4C5} ${dateStr}`;
      } else if (column === "schedule" || column === "important-not-urgent") {
        const due = /* @__PURE__ */ new Date();
        due.setDate(due.getDate() + 3);
        text += ` \u{1F4C5} ${due.toISOString().slice(0, 10)}`;
      }
      text += ` \u2795 ${dateStr}`;
      if (card.postponeCount && card.postponeCount > 0) {
        text += ` [\u21A9:: ${card.postponeCount}]`;
      }
      text += ` ^${blockId}`;
      const mdLine = `- [ ] ${text}`;
      return { mdLine, blockId, filePath: ensureDailyNote(dateStr) };
    }
    function appendMarkdownTask(card, column) {
      const { mdLine, blockId, filePath } = buildMarkdownTask(card, column);
      try {
        let content2 = fs2.readFileSync(filePath, "utf8");
        const sectionMatch = content2.match(/\n## By Project\s*\n/);
        if (!sectionMatch) {
          content2 += `

### ${card.project || "General"}
${mdLine}
`;
        } else {
          const insertIdx = sectionMatch.index + sectionMatch[0].length;
          const projectName = card.project || "General";
          const projectRe = new RegExp(`\\n#### ${projectName}\\s*\\n`);
          const projMatch = content2.match(projectRe);
          if (projMatch) {
            const afterProj = projMatch.index + projMatch[0].length;
            const nextSection = content2.indexOf("\n#### ", afterProj);
            const insertPoint = nextSection === -1 ? content2.length : nextSection;
            content2 = content2.slice(0, insertPoint) + mdLine + "\n" + content2.slice(insertPoint);
          } else {
            const afterSection = content2.indexOf("\n", insertIdx) + 1;
            const insertion = `
#### ${projectName}
${mdLine}
`;
            content2 = content2.slice(0, afterSection) + insertion + content2.slice(afterSection);
          }
        }
        fs2.writeFileSync(filePath, content2, "utf8");
        const obsidianRef = `[[${path2.basename(filePath, ".md")}#^${blockId}]]`;
        return { ok: true, obsidianRef, mdLine, blockId };
      } catch (e) {
        console.error(`[mc-phase2] Failed to write MD task: ${e.message}`);
        return { ok: false, error: e.message };
      }
    }
    function cancelMarkdownTask(obsidianRef) {
      if (!obsidianRef) return { ok: false, error: "No obsidianRef" };
      try {
        const match = obsidianRef.match(/\[\[(\d{4}-\d{2}-\d{2})#\^(task-[a-z0-9]{6})\]\]/);
        if (!match) return { ok: false, error: "Invalid obsidianRef format" };
        const [, dateStr, blockId] = match;
        const filePath = path2.join(DAILY_PLANS_DIR, `${dateStr}.md`);
        if (!fs2.existsSync(filePath)) return { ok: false, error: "File not found" };
        let content2 = fs2.readFileSync(filePath, "utf8");
        const taskRe = new RegExp(`^- \\[ \\][^
]*\\^${blockId}$`, "gm");
        const replaced = content2.replace(taskRe, (line) => {
          return line.replace("- [ ]", "- [~]").replace(/\^task-[a-z0-9]{6}$/, "~cancelled~ $&");
        });
        if (replaced === content2) {
          return { ok: false, error: "Task not found in markdown" };
        }
        fs2.writeFileSync(filePath, replaced, "utf8");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    function updateMarkdownTask(obsidianRef, updates) {
      if (!obsidianRef) return { ok: false, error: "No obsidianRef" };
      try {
        const match = obsidianRef.match(/\[\[(\d{4}-\d{2}-\d{2})#\^(task-[a-z0-9]{6})\]\]/);
        if (!match) return { ok: false, error: "Invalid obsidianRef format" };
        const [, dateStr, blockId] = match;
        const filePath = path2.join(DAILY_PLANS_DIR, `${dateStr}.md`);
        if (!fs2.existsSync(filePath)) return { ok: false, error: "File not found" };
        let content2 = fs2.readFileSync(filePath, "utf8");
        const taskRe = new RegExp(`^- \\[ \\][^
]*\\^${blockId}$`, "gm");
        let modified = false;
        const replaced = content2.replace(taskRe, (line) => {
          let newLine = line;
          if (updates.title) {
            const metaRe = /(#\w+|\[\[|📅|➕|🔺|⏫|🔼|🧊|\[↩)/;
            const metaIdx = newLine.search(metaRe);
            const prefix = newLine.slice(0, "- [ ] ".length);
            const suffix = metaIdx === -1 ? "" : newLine.slice(metaIdx);
            newLine = `${prefix}${updates.title}${suffix}`;
          }
          if (updates.due) {
            newLine = newLine.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `\u{1F4C5} ${updates.due}`);
          }
          if (updates.assignee !== void 0) {
            newLine = newLine.replace(/#assigned-\w+/g, "");
            if (updates.assignee) {
              newLine = newLine.replace(/\^task-/, ` #assigned-${updates.assignee} ^`);
            }
          }
          modified = true;
          return newLine;
        });
        if (!modified) return { ok: false, error: "Task not found" };
        fs2.writeFileSync(filePath, replaced, "utf8");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    function autoArchiveStale(dataDir) {
      const tasks = readBrainDump(dataDir);
      const now = Date.now();
      const staleCutoff = now - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1e3;
      const archived = [];
      const remaining = [];
      for (const t of tasks) {
        const created = new Date(t.createdAt || "1970-01-01").getTime();
        const isStale = created < staleCutoff;
        const hasDue = t.due || (t.tags || []).some((tag) => tag.match(/📅|📆/));
        const hasPriority = t.priority && t.priority !== "neither";
        const hasHighPriority = (t.tags || []).some(
          (tag) => ["\u{1F53A}", "\u23EB"].includes(tag)
        );
        if (isStale && !hasDue && !hasPriority && !hasHighPriority && t.status !== "done") {
          t.status = "archived";
          t.archivedAt = (/* @__PURE__ */ new Date()).toISOString();
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
    function syncDoneStatus(dataDir) {
      const tasks = readBrainDump(dataDir);
      let fixed = 0;
      for (const t of tasks) {
        if (t.status === "done" && !t.completedAt) {
          t.completedAt = (/* @__PURE__ */ new Date()).toISOString();
          fixed++;
        }
      }
      if (fixed > 0) writeBrainDump(dataDir, tasks);
      return { fixed };
    }
    function readVelocityConfig(dataDir) {
      return safeReadJson(path2.join(dataDir, "velocity-config.json"), {
        defaultCap: VELOCITY_CAP_DEFAULT,
        perProject: {}
      });
    }
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
    function invokeRollover(dateStr = null) {
      return new Promise((resolve) => {
        const args2 = [ROLLOVER_SCRIPT];
        if (dateStr) args2.push("--date", dateStr);
        const child = spawn("python3", args2, {
          cwd: VAULT_DIR,
          env: { ...process.env, PYTHONUNBUFFERED: "1" }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => stdout += d);
        child.stderr.on("data", (d) => stderr += d);
        child.on("close", (code) => {
          resolve({
            ok: code === 0,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        });
        child.on("error", (err) => {
          resolve({ ok: false, error: err.message });
        });
      });
    }
    function createPhase2API2(deps) {
      const { getOpenClawDir: getOpenClawDir2 } = deps;
      const dataDir = deps.dataDir || path2.join(
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
          req.on("data", (chunk) => body += chunk);
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
              card.status = column;
              card.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
              const mdResult = appendMarkdownTask(card, column);
              if (!mdResult.ok) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Failed to write markdown: " + mdResult.error }));
                return;
              }
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
                    blockId: mdResult.blockId
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
          const statusMap = {
            dofirst: ["do-first", "urgent-important", "todo"],
            schedule: ["schedule", "important-not-urgent"],
            delegate: ["delegate", "urgent-not-important"],
            icebox: ["icebox"],
            unsorted: ["unsorted", "backlog"],
            done: ["done", "archived"]
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
                modeBreakdown: filtered.reduce(
                  (acc, c) => {
                    const m = c.mode == null ? "legacy" : c.mode;
                    acc[m] = (acc[m] || 0) + 1;
                    return acc;
                  },
                  { planning: 0, autonomous: 0, mixed: 0, legacy: 0 }
                )
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
          req.on("data", (chunk) => body += chunk);
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
              Object.assign(card, updates, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
          if (card.obsidianRef) {
            const mdResult = cancelMarkdownTask(card.obsidianRef);
            if (!mdResult.ok) {
              console.warn(`[mc-phase2] MD cancel failed for ${id}: ${mdResult.error}`);
            }
          }
          card.status = "archived";
          card.archivedAt = (/* @__PURE__ */ new Date()).toISOString();
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
          req.on("data", (chunk) => body += chunk);
          req.on("end", async () => {
            let dateStr = null;
            try {
              const parsed = JSON.parse(body);
              dateStr = parsed.date;
            } catch {
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
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const { file, diff } = JSON.parse(body);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify(
                  {
                    ok: true,
                    message: "Sync acknowledged (Phase 2.5)",
                    file,
                    diffLines: (diff || []).length
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
                velocity: velocityResult
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
        _dataDir: dataDir
      };
    }
    module2.exports = {
      createPhase2API: createPhase2API2,
      // Helpers for tests
      resolveProjectLinks,
      buildMarkdownTask,
      generateBlockId,
      getTodayDate,
      ensureDailyNote,
      readDailyTasks: readDailyTasks2,
      autoArchiveStale,
      checkVelocityCap,
      invokeRollover
    };
  }
});

// src/agents.js
var require_agents = __commonJS({
  "src/agents.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { getCronJobs: getCronJobs2 } = require_cron();
    var HOME = process.env.HOME || "/Users/michaeljones";
    var SUBAGENT_RUNS_FILE = path2.join(HOME, ".openclaw/subagents/runs.json");
    var AGENT_LOG_FILE = path2.join(HOME, ".openclaw/workspace/Corvus/Operations/agent-log.jsonl");
    function safeReadJson(filePath, fallback) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const raw = fs2.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.error(`[agents] Failed to read ${filePath}: ${e.message}`);
        return fallback;
      }
    }
    function readAgentLog() {
      if (!fs2.existsSync(AGENT_LOG_FILE)) return [];
      try {
        const raw = fs2.readFileSync(AGENT_LOG_FILE, "utf8");
        const lines = raw.split("\n").filter((l) => l.trim());
        const records = [];
        for (const line of lines) {
          try {
            records.push(JSON.parse(line));
          } catch (e) {
          }
        }
        return records;
      } catch (e) {
        console.error(`[agents] Failed to read log: ${e.message}`);
        return [];
      }
    }
    function deriveStatus(run) {
      if (!run.endedAt && (!run.outcome || run.outcome.status === "running" || !run.outcome.status)) {
        return "running";
      }
      const reason = run.endedReason || "";
      const outcomeStatus = run.outcome?.status || "";
      if (reason === "subagent-complete") return "completed";
      if (reason === "subagent-failed") return "failed";
      if (outcomeStatus === "ok" || outcomeStatus === "success" || outcomeStatus === "completed") {
        return "completed";
      }
      if (outcomeStatus === "error" || outcomeStatus === "failed" || outcomeStatus === "timeout" || outcomeStatus === "cancelled") {
        return outcomeStatus === "timeout" ? "failed" : "failed";
      }
      return "completed";
    }
    function mapAgent(run) {
      const status = deriveStatus(run);
      const startedMs = run.startedAt || run.createdAt || null;
      const endedMs = run.endedAt || run.outcome?.endedAt || null;
      let elapsedSeconds = null;
      if (startedMs) {
        if (endedMs) {
          elapsedSeconds = Math.round((endedMs - startedMs) / 1e3);
        } else if (status === "running") {
          elapsedSeconds = Math.round((Date.now() - startedMs) / 1e3);
        }
      }
      return {
        runId: run.runId,
        name: run.label || run.runId,
        label: run.label || null,
        status,
        model: run.model || null,
        runtime: "subagent",
        startedAt: startedMs ? new Date(startedMs).toISOString() : null,
        completedAt: endedMs ? new Date(endedMs).toISOString() : null,
        elapsedSeconds,
        parentSession: run.requesterSessionKey || null,
        childSessionKey: run.childSessionKey || null,
        controllerSessionKey: run.controllerSessionKey || null,
        task: run.task || null,
        endedReason: run.endedReason || null,
        outcome: run.outcome || null,
        spawnMode: run.spawnMode || null,
        mode: run.spawnMode === "run" ? "autonomous" : "interactive",
        requesterOrigin: run.requesterOrigin || null,
        runTimeoutSeconds: run.runTimeoutSeconds || null,
        resultSummary: run.outcome?.status ? `outcome=${run.outcome.status}${run.endedReason ? `, reason=${run.endedReason}` : ""}` : null
      };
    }
    function readSubagentRuns() {
      const data = safeReadJson(SUBAGENT_RUNS_FILE, { version: 2, runs: {} });
      const runs = data.runs || {};
      return Object.values(runs);
    }
    function getRunningAgents() {
      const runs = readSubagentRuns();
      return runs.filter((r) => deriveStatus(r) === "running").map(mapAgent).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    }
    function getCompletedAgents(sinceIso = null) {
      const runs = readSubagentRuns();
      const sinceMs = sinceIso ? new Date(sinceIso).getTime() : Date.now() - 7 * 24 * 60 * 60 * 1e3;
      return runs.filter((r) => {
        const endedMs = r.endedAt || r.outcome?.endedAt || 0;
        return endedMs >= sinceMs && deriveStatus(r) !== "running";
      }).map(mapAgent).sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    }
    function getAllHistory(sinceIso = null) {
      const sinceMs = sinceIso ? new Date(sinceIso).getTime() : Date.now() - 7 * 24 * 60 * 60 * 1e3;
      const fromRuns = getCompletedAgents(sinceIso).map((a) => ({ ...a, source: "runs.json" }));
      const logRecords = readAgentLog().filter((r) => {
        const ts = new Date(r.completedAt || r.startedAt || r.ts || 0).getTime();
        return ts >= sinceMs;
      }).map((r) => ({
        ...r,
        source: "agent-log.jsonl",
        status: r.status || deriveStatus(r)
      }));
      const byRunId = /* @__PURE__ */ new Map();
      for (const r of fromRuns) {
        byRunId.set(r.runId, r);
      }
      for (const r of logRecords) {
        const id = r.runId || r.name;
        if (!byRunId.has(id)) {
          byRunId.set(id, r);
        }
      }
      return Array.from(byRunId.values()).sort(
        (a, b) => new Date(b.completedAt || b.startedAt || 0).getTime() - new Date(a.completedAt || a.startedAt || 0).getTime()
      );
    }
    function findAgent(identifier) {
      const all = [...getRunningAgents(), ...getCompletedAgents()];
      const lower = String(identifier).toLowerCase();
      const byId = all.find((a) => a.runId === identifier);
      if (byId) return byId;
      const byLabel = all.find((a) => a.label === identifier);
      if (byLabel) return byLabel;
      const byLabelCi = all.find((a) => (a.label || "").toLowerCase() === lower);
      if (byLabelCi) return byLabelCi;
      return null;
    }
    function createAgentsAPI2(deps = {}) {
      const getOpenClawDir2 = deps.getOpenClawDir;
      return {
        /**
         * GET /api/mission/agents
         * Returns currently-running sub-agents.
         */
        list(req, res) {
          const agents2 = getRunningAgents();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              {
                agents: agents2,
                count: agents2.length,
                asOf: (/* @__PURE__ */ new Date()).toISOString()
              },
              null,
              2
            )
          );
        },
        /**
         * GET /api/mission/agents/schedule
         * The scheduled-automation board: OpenClaw cron jobs with real last-run
         * status, upcoming runs first. Surfaces failing/overdue jobs so silent
         * cron breakage is visible (audit F9).
         */
        scheduleBoard(req, res) {
          let jobs = [];
          try {
            jobs = getOpenClawDir2 ? getCronJobs2(getOpenClawDir2) : [];
          } catch (e) {
            console.error("[agents] scheduleBoard failed:", e.message);
          }
          const isFailing = (j) => (j.consecutiveErrors || 0) > 0 || j.lastStatus === "error" || j.lastStatus === "failed";
          const sorted = jobs.slice().sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            const an = a.nextRunAtMs || Infinity;
            const bn = b.nextRunAtMs || Infinity;
            return an - bn;
          });
          const summary = {
            total: jobs.length,
            enabled: jobs.filter((j) => j.enabled).length,
            disabled: jobs.filter((j) => !j.enabled).length,
            failing: jobs.filter(isFailing).length
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              { jobs: sorted, summary, asOf: (/* @__PURE__ */ new Date()).toISOString() },
              null,
              2
            )
          );
        },
        /**
         * GET /api/mission/agents/history?since=ISO_DATE
         * Returns agents that have completed since the given timestamp.
         */
        history(req, res) {
          const url = new URL(req.url, "http://x");
          const since = url.searchParams.get("since");
          let agents2;
          let windowStart;
          try {
            agents2 = getAllHistory(since);
            windowStart = since ? new Date(since).toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString();
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid since parameter: " + e.message }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              {
                agents: agents2,
                count: agents2.length,
                windowStart,
                windowEnd: (/* @__PURE__ */ new Date()).toISOString()
              },
              null,
              2
            )
          );
        },
        /**
         * GET /api/mission/agents/:name
         * Returns one agent by runId or label.
         */
        detail(req, res, identifier) {
          const agent = findAgent(decodeURIComponent(identifier));
          if (!agent) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Agent not found", identifier }, null, 2));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(agent, null, 2));
        }
      };
    }
    module2.exports = {
      createAgentsAPI: createAgentsAPI2,
      // Helpers (exported for tests + reuse)
      deriveStatus,
      mapAgent,
      readSubagentRuns,
      readAgentLog,
      getRunningAgents,
      getCompletedAgents,
      getAllHistory,
      findAgent,
      SUBAGENT_RUNS_FILE,
      AGENT_LOG_FILE
    };
  }
});

// src/ollama-usage.js
var require_ollama_usage = __commonJS({
  "src/ollama-usage.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var ollamaUsageCache = { data: null, timestamp: 0, refreshing: false };
    var OLLAMA_CACHE_TTL_MS = 6e4;
    function getOllamaDir() {
      return path2.join(process.env.HOME || "/Users/michaeljones", ".openclaw");
    }
    function getSessionsDir() {
      return path2.join(getOllamaDir(), "agents", "main", "sessions");
    }
    function parseSessionFile(filePath, cutoffMs) {
      const entries = [];
      try {
        const content2 = fs2.readFileSync(filePath, "utf8");
        const lines = content2.trim().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "message" || !entry.message) continue;
            const msg = entry.message;
            if (msg.role !== "assistant" || !msg.usage) continue;
            const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
            if (ts < cutoffMs) continue;
            const usage = msg.usage;
            if (!usage.totalTokens && !usage.input && !usage.output) continue;
            entries.push({
              model: msg.model || (msg.provider === "ollama" ? "ollama-unknown" : "unknown"),
              provider: msg.provider || "unknown",
              input: usage.input || 0,
              output: usage.output || 0,
              cacheRead: usage.cacheRead || 0,
              cacheWrite: usage.cacheWrite || 0,
              totalTokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0),
              cost: usage.cost?.total || 0,
              timestamp: ts
            });
          } catch (e) {
          }
        }
      } catch (e) {
      }
      return entries;
    }
    function getOllamaUsage() {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1e3;
      const threeDaysMs = 3 * dayMs;
      const sevenDaysMs = 7 * dayMs;
      const cutoff24h = now - dayMs;
      const cutoff3d = now - threeDaysMs;
      const cutoff7d = now - sevenDaysMs;
      const sessionsDir = getSessionsDir();
      if (!fs2.existsSync(sessionsDir)) {
        return { models: {}, routing: {}, timestamp: (/* @__PURE__ */ new Date()).toISOString(), source: "ollama-transcripts" };
      }
      const modelAgg = {};
      let totalRequests7d = 0;
      let totalRequests3d = 0;
      let totalRequests24h = 0;
      const files = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const filePath = path2.join(sessionsDir, file);
        try {
          const stat = fs2.statSync(filePath);
          if (stat.mtimeMs < cutoff7d) continue;
        } catch (e) {
          continue;
        }
        const entries7d = parseSessionFile(filePath, cutoff7d);
        for (const entry of entries7d) {
          if (!modelAgg[entry.model]) {
            modelAgg[entry.model] = {
              tokens24h: { input: 0, output: 0, total: 0 },
              tokens3d: { input: 0, output: 0, total: 0 },
              tokens7d: { input: 0, output: 0, total: 0 },
              requests24h: 0,
              requests3d: 0,
              requests7d: 0,
              cost7d: 0
            };
          }
          const m = modelAgg[entry.model];
          m.tokens7d.input += entry.input;
          m.tokens7d.output += entry.output;
          m.tokens7d.total += entry.totalTokens;
          m.requests7d++;
          m.cost7d += entry.cost;
          totalRequests7d++;
          if (entry.timestamp >= cutoff3d) {
            m.tokens3d.input += entry.input;
            m.tokens3d.output += entry.output;
            m.tokens3d.total += entry.totalTokens;
            m.requests3d++;
            totalRequests3d++;
          }
          if (entry.timestamp >= cutoff24h) {
            m.tokens24h.input += entry.input;
            m.tokens24h.output += entry.output;
            m.tokens24h.total += entry.totalTokens;
            m.requests24h++;
            totalRequests24h++;
          }
        }
      }
      for (const model of Object.values(modelAgg)) {
        model.avgTokensPerRequest7d = model.requests7d > 0 ? Math.round(model.tokens7d.total / model.requests7d) : 0;
      }
      const routingByModel = {};
      for (const [name, data] of Object.entries(modelAgg)) {
        routingByModel[name] = {
          requests7d: data.requests7d,
          requests3d: data.requests3d,
          requests24h: data.requests24h,
          pct7d: totalRequests7d > 0 ? Math.round(data.requests7d / totalRequests7d * 100) : 0
        };
      }
      return {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        source: "ollama-transcripts",
        models: modelAgg,
        routing: {
          total7d: totalRequests7d,
          total3d: totalRequests3d,
          total24h: totalRequests24h,
          byModel: routingByModel
        }
      };
    }
    function getOllamaUsageCached2() {
      const now = Date.now();
      if (!ollamaUsageCache.data || now - ollamaUsageCache.timestamp > OLLAMA_CACHE_TTL_MS) {
        refreshOllamaUsageAsync2();
      }
      return ollamaUsageCache.data;
    }
    function refreshOllamaUsageAsync2() {
      if (ollamaUsageCache.refreshing) return;
      ollamaUsageCache.refreshing = true;
      try {
        const data = getOllamaUsage();
        ollamaUsageCache.data = data;
        ollamaUsageCache.timestamp = Date.now();
        const modelCount = Object.keys(data.models).length;
        console.log(`[Ollama Usage] Refreshed: ${modelCount} models, ${data.routing.total7d} requests (7d)`);
      } catch (e) {
        console.error("[Ollama Usage] Refresh failed:", e.message);
      }
      ollamaUsageCache.refreshing = false;
    }
    module2.exports = {
      getOllamaUsage,
      getOllamaUsageCached: getOllamaUsageCached2,
      refreshOllamaUsageAsync: refreshOllamaUsageAsync2
    };
  }
});

// src/health.js
var require_health = __commonJS({
  "src/health.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var HOME = process.env.HOME || "/Users/michaeljones";
    var LEDGER_VOLUME = "/Volumes/MacMini_Extended";
    var LEDGER_FILE = path2.join(LEDGER_VOLUME, "llm-memory/memory.jsonl");
    var CROSS_CONTEXT_FILE = path2.join(HOME, ".openclaw/workspace/memory/cross-system-context.md");
    var SCHEDULER_LAST_RUN = "/tmp/corvus-scheduler-last-run.json";
    var PUBLISHER_LAST_RUN = "/tmp/corvus-publisher-last-run.json";
    var GATEWAY_ERR_LOG = path2.join(HOME, ".openclaw/logs/gateway.err.log");
    var SERVER_ERR_LOG = path2.join(__dirname, "..", "..", "server.err");
    var SERVER_OUT_LOG = path2.join(__dirname, "..", "..", "server.log");
    var EMPTY_CONTEXT_MAX_BYTES = 200;
    var LOG_WARN_BYTES = 25 * 1024 * 1024;
    var STUB_WARN_COUNT = 15;
    var healthCache = { data: null, timestamp: 0, refreshing: false };
    var HEALTH_TTL_MS = 3e4;
    function statOrNull(p) {
      try {
        return fs2.statSync(p);
      } catch {
        return null;
      }
    }
    function fmtBytes(n) {
      if (n == null) return "\u2014";
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    }
    function relAge(mtimeMs) {
      const diff = Date.now() - mtimeMs;
      if (diff < 6e4) return "just now";
      if (diff < 36e5) return `${Math.round(diff / 6e4)}m ago`;
      if (diff < 864e5) return `${Math.round(diff / 36e5)}h ago`;
      return `${Math.round(diff / 864e5)}d ago`;
    }
    function tailBytes(filePath, maxBytes) {
      const st = statOrNull(filePath);
      if (!st) return "";
      try {
        const start = Math.max(0, st.size - maxBytes);
        const fd = fs2.openSync(filePath, "r");
        try {
          const len = st.size - start;
          const buf = Buffer.alloc(len);
          fs2.readSync(fd, buf, 0, len, start);
          return buf.toString("utf8");
        } finally {
          fs2.closeSync(fd);
        }
      } catch {
        return "";
      }
    }
    function checkMount() {
      const ok = fs2.existsSync(LEDGER_VOLUME) && fs2.existsSync(LEDGER_FILE);
      return {
        id: "ledger-mount",
        label: "Memory ledger volume",
        ok,
        severity: "error",
        detail: ok ? `Mounted \xB7 ${LEDGER_VOLUME}` : `NOT mounted \u2014 ${LEDGER_VOLUME} missing. Cross-system memory is blind until it's back.`
      };
    }
    function checkMemoryInjection() {
      const st = statOrNull(CROSS_CONTEXT_FILE);
      if (!st) {
        return {
          id: "memory-injection",
          label: "Memory injection (cross-system-context)",
          ok: false,
          severity: "error",
          detail: "cross-system-context.md missing \u2014 the 06:30 refresh never wrote it."
        };
      }
      const empty = st.size <= EMPTY_CONTEXT_MAX_BYTES;
      return {
        id: "memory-injection",
        label: "Memory injection (cross-system-context)",
        ok: !empty,
        severity: "error",
        value: fmtBytes(st.size),
        detail: empty ? `Empty placeholder (${st.size} B, written ${relAge(st.mtimeMs)}). Volume was likely unmounted at 06:30 cron time \u2014 Claude Code is starting cold.` : `${fmtBytes(st.size)} of context, refreshed ${relAge(st.mtimeMs)}.`
      };
    }
    function checkLedgerStubs() {
      const st = statOrNull(LEDGER_FILE);
      if (!st) {
        return {
          id: "ledger-stubs",
          label: "Ledger stub pile-up",
          ok: false,
          severity: "warn",
          detail: "Ledger unreadable (volume unmounted?)."
        };
      }
      let total = 0;
      let stubs = 0;
      let latestDate = "";
      try {
        const raw = fs2.readFileSync(LEDGER_FILE, "utf8");
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          total++;
          try {
            const e = JSON.parse(line);
            if (e && e.status === "stub") stubs++;
            if (e && e.date && e.date > latestDate) latestDate = e.date;
          } catch {
          }
        }
      } catch (e) {
        return {
          id: "ledger-stubs",
          label: "Ledger stub pile-up",
          ok: false,
          severity: "warn",
          detail: `Ledger read failed: ${e.message}`
        };
      }
      const ok = stubs < STUB_WARN_COUNT;
      return {
        id: "ledger-stubs",
        label: "Ledger stub pile-up",
        ok,
        severity: "warn",
        value: `${stubs} stub / ${total}`,
        detail: `${stubs} unfilled stub${stubs === 1 ? "" : "s"} of ${total} entries` + (latestDate ? ` \xB7 latest ${latestDate}` : "") + (ok ? "" : " \u2014 sessions are being recorded but not summarized.")
      };
    }
    var PARKED_SINCE_MS = Date.parse("2026-07-07T00:00:00-07:00");
    function checkParkedJob(id, label, filePath) {
      const st = statOrNull(filePath);
      if (st && st.mtimeMs > PARKED_SINCE_MS) {
        return {
          id,
          label,
          ok: false,
          severity: "warn",
          value: relAge(st.mtimeMs),
          detail: `Parked job fired ${relAge(st.mtimeMs)} \u2014 its LaunchAgent should be unloaded (launchctl bootout + disable).`
        };
      }
      return {
        id,
        label,
        ok: true,
        severity: "warn",
        value: "parked",
        detail: "Parked by design \u2014 Mike is publishing manually first; automation returns at roadmap stage 5."
      };
    }
    function checkGateway() {
      const st = statOrNull(GATEWAY_ERR_LOG);
      const tail = tailBytes(GATEWAY_ERR_LOG, 512 * 1024);
      const sigabrt = (tail.match(/SIGABRT|signal 6|exited.*-6/gi) || []).length;
      const failed = (tail.match(/candidate_failed/gi) || []).length;
      const succeeded = (tail.match(/candidate_succeeded|candidate_ok/gi) || []).length;
      const oversized = st && st.size > LOG_WARN_BYTES;
      const problems = [];
      if (sigabrt > 0) problems.push(`${sigabrt} SIGABRT marker${sigabrt === 1 ? "" : "s"} (recent)`);
      if (failed + succeeded > 0) {
        const rate = Math.round(failed / (failed + succeeded) * 100);
        if (rate >= 50) problems.push(`fallback ladder failing ${rate}%`);
      }
      if (oversized) problems.push(`err log ${fmtBytes(st.size)} (unrotated)`);
      return {
        id: "gateway",
        label: "OpenClaw gateway",
        ok: problems.length === 0,
        severity: sigabrt > 0 ? "error" : "warn",
        value: st ? fmtBytes(st.size) : "no log",
        detail: problems.length === 0 ? `Healthy \xB7 err log ${st ? fmtBytes(st.size) : "?"} (last 512 KB scanned).` : problems.join(" \xB7 ")
      };
    }
    function checkCliPolls() {
      const st = statOrNull(SERVER_ERR_LOG);
      const oversized = st && st.size > LOG_WARN_BYTES;
      const tail = tailBytes(SERVER_ERR_LOG, 64 * 1024);
      const recentCliSpam = (tail.match(/openclaw (sessions|status)|Command failed: openclaw/gi) || []).length;
      const ok = !oversized && recentCliSpam === 0;
      return {
        id: "cli-polls",
        label: "Dashboard CLI polls",
        ok,
        severity: "warn",
        value: st ? fmtBytes(st.size) : "\u2014",
        detail: ok ? `Quiet \xB7 server.err ${st ? fmtBytes(st.size) : "?"}, no recent CLI-failure spam.` : `server.err ${st ? fmtBytes(st.size) : "?"}${recentCliSpam ? `, ${recentCliSpam} recent openclaw-CLI failures in tail` : ""} \u2014 truncate it and confirm the CLI gate is on.`
      };
    }
    function computeHealth() {
      const checks = [
        checkMount(),
        checkMemoryInjection(),
        checkLedgerStubs(),
        checkParkedJob("scheduler", "Corvus scheduler", SCHEDULER_LAST_RUN),
        checkParkedJob("publisher", "Corvus publisher", PUBLISHER_LAST_RUN),
        checkGateway(),
        checkCliPolls()
      ];
      const errors = checks.filter((c) => !c.ok && c.severity === "error").length;
      const warnings = checks.filter((c) => !c.ok && c.severity === "warn").length;
      const overall = errors > 0 ? "error" : warnings > 0 ? "warn" : "ok";
      return {
        overall,
        counts: { ok: checks.filter((c) => c.ok).length, warnings, errors, total: checks.length },
        checks,
        asOf: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    function refreshHealthAsync() {
      if (healthCache.refreshing) return;
      healthCache.refreshing = true;
      try {
        healthCache.data = computeHealth();
        healthCache.timestamp = Date.now();
      } catch (e) {
        console.error("[health] compute failed:", e.message);
      } finally {
        healthCache.refreshing = false;
      }
    }
    function getHealthCached() {
      if (!healthCache.data || Date.now() - healthCache.timestamp > HEALTH_TTL_MS) {
        refreshHealthAsync();
      }
      return healthCache.data || computeHealth();
    }
    function createHealthAPI2(_deps = {}) {
      return {
        list(req, res) {
          const data = getHealthCached();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        }
      };
    }
    module2.exports = { createHealthAPI: createHealthAPI2, getHealthCached, refreshHealthAsync, computeHealth };
  }
});

// src/system-mind.js
var require_system_mind = __commonJS({
  "src/system-mind.js"(exports2, module2) {
    var fs2 = require("fs");
    var LEDGER_VOLUME = "/Volumes/MacMini_Extended";
    var LEDGER_FILE = `${LEDGER_VOLUME}/llm-memory/memory.jsonl`;
    var MAX_SESSIONS = 12;
    var MAX_ITEMS_PER_FIELD = 4;
    var cache = { data: null, timestamp: 0, refreshing: false };
    var TTL_MS = 6e4;
    function readLedger() {
      if (!fs2.existsSync(LEDGER_FILE)) {
        return { mounted: fs2.existsSync(LEDGER_VOLUME), entries: [] };
      }
      const entries = [];
      try {
        const raw = fs2.readFileSync(LEDGER_FILE, "utf8");
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          try {
            const e = JSON.parse(line);
            if (e && typeof e === "object") entries.push(e);
          } catch {
          }
        }
      } catch (e) {
        console.error("[system-mind] ledger read failed:", e.message);
      }
      return { mounted: true, entries };
    }
    var byDateDesc = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));
    function shapeSession(e) {
      return {
        id: e.id,
        date: e.date,
        environment: e.environment || "unknown",
        project: e.project || (Array.isArray(e.projects) ? e.projects.join(", ") : "") || "",
        summary: (e.summary || "").trim(),
        decisions: (e.decisions || []).map((d) => (typeof d === "string" ? d : d && (d.summary || d.decision)) || "").filter((s) => s && s.trim()).slice(0, 3),
        openThreads: (e.open_threads || []).filter((t) => String(t).trim()).slice(0, 2),
        topics: (e.topics || []).slice(0, 5),
        obsidianNote: e.obsidian_note || null
      };
    }
    function shapeConsolidation(e) {
      if (!e) return null;
      const pick = (field) => (e[field] || []).map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_ITEMS_PER_FIELD);
      return {
        date: e.date,
        model: e.model || e.generated_by || null,
        sessionsReviewed: e.sessions_reviewed || null,
        connections: pick("connections"),
        patterns: pick("patterns"),
        hypotheses: pick("hypotheses"),
        tensions: pick("tensions"),
        recurringThreads: pick("recurring_threads"),
        obsidianNote: e.obsidian_note || null
      };
    }
    function computeSystemMind() {
      const { mounted, entries } = readLedger();
      if (!mounted) {
        return { mounted: false, asOf: (/* @__PURE__ */ new Date()).toISOString() };
      }
      const live = entries.filter((e) => e.status !== "stub");
      const stubCount = entries.length - live.length;
      const sessions2 = live.filter((e) => e.type === "session_summary").sort(byDateDesc).slice(0, MAX_SESSIONS).map(shapeSession);
      const consolidation = shapeConsolidation(
        live.filter((e) => e.type === "consolidation").sort(byDateDesc)[0]
      );
      return {
        mounted: true,
        sessions: sessions2,
        consolidation,
        counts: {
          total: entries.length,
          sessions: live.filter((e) => e.type === "session_summary").length,
          consolidations: live.filter((e) => e.type === "consolidation").length,
          stubs: stubCount
        },
        asOf: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    function refreshSystemMindAsync() {
      if (cache.refreshing) return;
      cache.refreshing = true;
      try {
        cache.data = computeSystemMind();
        cache.timestamp = Date.now();
      } catch (e) {
        console.error("[system-mind] compute failed:", e.message);
      } finally {
        cache.refreshing = false;
      }
    }
    function getSystemMindCached2() {
      if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
        refreshSystemMindAsync();
      }
      return cache.data || computeSystemMind();
    }
    function createSystemMindAPI2(_deps = {}) {
      return {
        list(req, res) {
          const data = getSystemMindCached2();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        }
      };
    }
    module2.exports = { createSystemMindAPI: createSystemMindAPI2, getSystemMindCached: getSystemMindCached2, refreshSystemMindAsync, computeSystemMind };
  }
});

// src/focus.js
var require_focus = __commonJS({
  "src/focus.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var VAULT_ROOT = "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space";
    var TASK_DATA_DIR = path2.join(VAULT_ROOT, "Corvus", "Task Data");
    var NORTH_STAR_FILE = path2.join(VAULT_ROOT, "Projects", "North Star.md");
    var VAULT_NAME = "Mike_Thinking_Space";
    var PRIORITY_WEIGHT = { "\u{1F53A}": 4, "\u23EB": 3, "\u{1F53C}": 2, "\u{1F53D}": 1 };
    var BUCKETS = [
      { key: "money", label: "Money", emoji: "\u{1F4B0}" },
      { key: "health", label: "Health", emoji: "\u2764\uFE0F" },
      { key: "family", label: "Family", emoji: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}" },
      { key: "freedom", label: "Freedom", emoji: "\u{1F54A}\uFE0F" },
      { key: "legacy", label: "Legacy", emoji: "\u{1F331}" }
    ];
    var PROJECT_BUCKET = {
      GHN: "money",
      "Velocity Partners": "money",
      Distills: "money",
      "Resilient Tomorrow": "legacy",
      "Solar / NeighborhoodShare": "legacy",
      "Personal / Family": "family"
    };
    var cache = { data: null, timestamp: 0, refreshing: false };
    var TTL_MS = 6e4;
    function daysBetween(fromISO, toISO) {
      return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 864e5);
    }
    function scoreTask(t, today) {
      if (!t || t.is_completed || !String(t.text || "").trim()) return -Infinity;
      let s = PRIORITY_WEIGHT[t.priority] || 2;
      if (t.due) {
        if (t.due <= today) s += 3;
        else if (daysBetween(today, t.due) <= 2) s += 1;
      }
      const p = t.postpone || 0;
      if (p >= 20) s += 3;
      else if (p >= 10) s += 2;
      else if (p >= 5) s += 1;
      if (t.assigned === "mike") s += 2;
      return s;
    }
    function cleanTaskText(text) {
      return String(text || "").replace(/\*\*/g, "").replace(/\[↩::\s*\d+\]/g, "").replace(/[🔺⏫🔼🔽]/gu, "").replace(/\s+/g, " ").trim();
    }
    function hasRealText(t) {
      return Boolean(t && cleanTaskText(t.text));
    }
    function bucketForProject(project) {
      return PROJECT_BUCKET[project] || null;
    }
    function obsidianUriFor(sourceFile) {
      if (!sourceFile || !sourceFile.startsWith(VAULT_ROOT)) return null;
      const rel = sourceFile.slice(VAULT_ROOT.length + 1).replace(/\.md$/, "");
      return `obsidian://open?vault=${VAULT_NAME}&file=${encodeURIComponent(rel)}`;
    }
    function shapeTask(t, today) {
      return {
        text: cleanTaskText(t.text),
        project: t.project || "Uncategorized",
        bucket: bucketForProject(t.project),
        due: t.due || null,
        overdue: Boolean(t.due && t.due <= today),
        postpone: t.postpone || 0,
        priority: t.priority || null,
        tags: t.tags || [],
        assigned: t.assigned || null,
        obsidianUri: obsidianUriFor(t.source_file)
      };
    }
    function pickFocus(tasks, today) {
      const open = (tasks || []).filter((t) => t && !t.is_completed && hasRealText(t));
      const mine = open.filter((t) => t.assigned !== "corvus");
      const corvusPlate = open.length - mine.length;
      const ranked = mine.map((t) => ({ t, score: scoreTask(t, today) })).sort((a, b) => b.score - a.score).map((r) => r.t);
      const hero = ranked[0] || null;
      const next = ranked.slice(1, 3);
      const lowEnergyPick = ranked.slice(1).find((t) => (PRIORITY_WEIGHT[t.priority] || 2) <= 2 && (t.postpone || 0) <= 3) || null;
      return { hero, next, lowEnergyPick, corvusPlate };
    }
    function readLatestTaskData(dir) {
      try {
        const files = fs2.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-tasks\.json$/.test(f)).sort().reverse();
        if (!files.length) return null;
        return JSON.parse(fs2.readFileSync(path2.join(dir, files[0]), "utf8"));
      } catch {
        return null;
      }
    }
    function readNorthStar(file) {
      let vision = null;
      try {
        const raw = fs2.readFileSync(file, "utf8");
        const m = raw.match(/^\*\*"([\s\S]*?)"\*\*/m);
        if (m) vision = m[1].replace(/\s+/g, " ").trim();
      } catch {
      }
      return { vision, buckets: BUCKETS.map((b) => ({ ...b })) };
    }
    function todayISO() {
      return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    }
    function computeFocus(opts = {}) {
      const taskDataDir = opts.taskDataDir || TASK_DATA_DIR;
      const northStarFile = opts.northStarFile || NORTH_STAR_FILE;
      const today = opts.today || todayISO();
      const northStar = readNorthStar(northStarFile);
      const data = readLatestTaskData(taskDataDir);
      if (!data) {
        return { available: false, northStar, asOf: (/* @__PURE__ */ new Date()).toISOString() };
      }
      const open = (data.tasks || []).filter((t) => t && !t.is_completed && hasRealText(t));
      const { hero, next, lowEnergyPick, corvusPlate } = pickFocus(data.tasks, today);
      for (const b of northStar.buckets) b.taskCount = 0;
      for (const t of open) {
        if (t.assigned === "corvus") continue;
        const key = bucketForProject(t.project);
        const b = key && northStar.buckets.find((x) => x.key === key);
        if (b) b.taskCount += 1;
      }
      return {
        available: true,
        date: data.date,
        generatedAt: data.generated_at || null,
        stale: data.date < today,
        northStar,
        now: {
          hero: hero ? shapeTask(hero, today) : null,
          next: next.map((t) => shapeTask(t, today))
        },
        lowEnergyPick: lowEnergyPick ? shapeTask(lowEnergyPick, today) : null,
        calendar: (data.calendar_events || []).slice(0, 6).map((e) => ({
          title: e.title || "",
          time: e.time || ""
        })),
        counts: {
          open: open.length,
          overdue: open.filter((t) => t.due && t.due <= today).length,
          dueToday: open.filter((t) => t.due === today).length,
          drifting: open.filter((t) => (t.postpone || 0) >= 10).length,
          corvusPlate
        },
        asOf: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    function refreshFocusAsync(opts) {
      if (cache.refreshing) return;
      cache.refreshing = true;
      try {
        cache.data = computeFocus(opts);
        cache.timestamp = Date.now();
      } catch (e) {
        console.error("[focus] compute failed:", e.message);
      } finally {
        cache.refreshing = false;
      }
    }
    function getFocusCached(opts) {
      if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
        refreshFocusAsync(opts);
      }
      return cache.data || computeFocus(opts);
    }
    function createFocusAPI2(deps = {}) {
      const opts = {
        taskDataDir: deps.taskDataDir,
        northStarFile: deps.northStarFile
      };
      return {
        list(req, res) {
          const data = deps.taskDataDir ? computeFocus(opts) : getFocusCached(opts);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        }
      };
    }
    module2.exports = {
      scoreTask,
      cleanTaskText,
      bucketForProject,
      pickFocus,
      shapeTask,
      BUCKETS,
      readLatestTaskData,
      readNorthStar,
      computeFocus,
      createFocusAPI: createFocusAPI2,
      getFocusCached
    };
  }
});

// src/corvus-proxy.js
var require_corvus_proxy = __commonJS({
  "src/corvus-proxy.js"(exports2, module2) {
    var http2 = require("http");
    var CORVUS_HOST = "127.0.0.1";
    var CORVUS_PORT = 4321;
    var REQ_TIMEOUT_MS = 2500;
    var cache = { data: null, timestamp: 0, refreshing: false };
    var TTL_MS = 3e4;
    function getJson(pathname) {
      return new Promise((resolve) => {
        const req = http2.get(
          { host: CORVUS_HOST, port: CORVUS_PORT, path: pathname, timeout: REQ_TIMEOUT_MS },
          (res) => {
            if (res.statusCode !== 200) {
              res.resume();
              return resolve(null);
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c) => body += c);
            res.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve(null);
              }
            });
          }
        );
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(null));
      });
    }
    function stageFor(draft) {
      const phase = String(draft.phase || "").toLowerCase();
      const type = String(draft.contentType || "").toLowerCase();
      if (phase.includes("publish") || type.includes("published")) return "published";
      if (phase.includes("schedul")) return "scheduled";
      if (type.includes("adapt") || phase.includes("adapt")) return "adapted";
      return "draft";
    }
    var STAGE_ORDER = ["draft", "adapted", "scheduled", "published"];
    async function computeContent() {
      const [draftsRaw, sessionRaw] = await Promise.all([
        getJson("/api/drafts"),
        getJson("/api/sessions/latest")
      ]);
      if (draftsRaw == null && sessionRaw == null) {
        return { up: false, asOf: (/* @__PURE__ */ new Date()).toISOString() };
      }
      const drafts = Array.isArray(draftsRaw) ? draftsRaw : [];
      const stages = { draft: [], adapted: [], scheduled: [], published: [] };
      for (const d of drafts) {
        const item = {
          name: d.name || d.path,
          path: d.path || null,
          folder: d.date || null,
          // corvus puts the folder name in `date`
          contentType: d.contentType || null,
          phase: d.phase || null,
          mtime: d.mtime || null
        };
        (stages[stageFor(d)] || stages.draft).push(item);
      }
      for (const k of STAGE_ORDER) {
        stages[k].sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));
      }
      const s = sessionRaw && sessionRaw.session;
      const latestSession = s ? {
        articleId: s.article_id || null,
        lastActivity: s.last_activity || null,
        messageCount: s.message_count || 0
      } : null;
      return {
        up: true,
        stages,
        stageOrder: STAGE_ORDER,
        total: drafts.length,
        latestSession,
        asOf: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    function refreshContentAsync() {
      if (cache.refreshing) return;
      cache.refreshing = true;
      computeContent().then((data) => {
        cache.data = data;
        cache.timestamp = Date.now();
      }).catch((e) => console.error("[corvus-proxy] compute failed:", e.message)).finally(() => {
        cache.refreshing = false;
      });
    }
    function getContentCached() {
      if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
        refreshContentAsync();
      }
      return cache.data || { up: null, loading: true, asOf: (/* @__PURE__ */ new Date()).toISOString() };
    }
    function createContentAPI2(_deps = {}) {
      return {
        list(req, res) {
          const data = getContentCached();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        }
      };
    }
    module2.exports = { createContentAPI: createContentAPI2, getContentCached, refreshContentAsync, computeContent };
  }
});

// src/needs-you.js
var require_needs_you = __commonJS({
  "src/needs-you.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var QUEUE_FILE = "/Users/michaeljones/.openclaw/workspace/Corvus/Operations/capture-queue.json";
    var VAULT_TASK_DATA_DIR = path2.join(
      "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space",
      "Corvus",
      "Task Data"
    );
    var CORVUS_DASHBOARD_URL = "http://localhost:4321";
    var MAX_CONTENT_CHARS = 220;
    var cache = { data: null, timestamp: 0, refreshing: false };
    var TTL_MS = 3e4;
    function healthItems(getHealth) {
      try {
        const h = getHealth();
        return (h && h.checks ? h.checks : []).filter((c) => c.ok === false).map((c) => ({
          type: "health",
          id: c.id,
          severity: c.severity || "warn",
          label: c.label,
          detail: c.detail || ""
        }));
      } catch {
        return [];
      }
    }
    function queueItems(queueFile) {
      try {
        const parsed = JSON.parse(fs2.readFileSync(queueFile, "utf8"));
        if (!Array.isArray(parsed)) return [];
        return parsed.map((e) => ({
          type: "queue",
          id: e.id || "",
          captureType: e.capture_type || null,
          pendingMike: /PENDING_MIKE/i.test(String(e.content || "")),
          content: String(e.content || "").slice(0, MAX_CONTENT_CHARS),
          capturedAt: e.captured_at || null
        }));
      } catch {
        return [];
      }
    }
    function discussionItems(readTasks) {
      try {
        const data = readTasks();
        return (data && data.tasks || []).filter(
          (t) => t && !t.is_completed && Array.isArray(t.tags) && t.tags.some((tag) => String(tag).toLowerCase() === "#discussion")
        ).map((t, i) => ({
          type: "discussion",
          id: `discussion-${i}`,
          text: String(t.text || "").replace(/\*\*/g, "").replace(/[🔺⏫🔼🔽💬]/gu, "").trim(),
          postpone: t.postpone || 0,
          project: t.project || "Uncategorized"
        })).filter((t) => t.text);
      } catch {
        return [];
      }
    }
    function draftsItem(getContent) {
      try {
        const c = getContent();
        if (!c || c.up === false) return null;
        const drafts = c.stages && c.stages.draft || [];
        if (!drafts.length) return null;
        return {
          type: "drafts",
          id: "drafts-backlog",
          count: drafts.length,
          latest: drafts[0].name || null,
          link: CORVUS_DASHBOARD_URL
        };
      } catch {
        return null;
      }
    }
    function computeNeedsYou(deps = {}) {
      const getHealth = deps.getHealth || require_health().getHealthCached;
      const getContent = deps.getContent || require_corvus_proxy().getContentCached;
      const readTasks = deps.readTasks || (() => require_focus().readLatestTaskData(VAULT_TASK_DATA_DIR));
      const queueFile = deps.queueFile || QUEUE_FILE;
      const health2 = healthItems(getHealth);
      const queue = queueItems(queueFile);
      const discussion = discussionItems(readTasks);
      const drafts = draftsItem(getContent);
      const items = [
        ...health2,
        ...queue.filter((q) => q.pendingMike),
        ...discussion,
        ...queue.filter((q) => !q.pendingMike),
        ...drafts ? [drafts] : []
      ];
      return {
        items,
        counts: {
          total: items.length,
          health: health2.length,
          queue: queue.length,
          discussion: discussion.length,
          drafts: drafts ? drafts.count : 0
        },
        asOf: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    function refreshNeedsYouAsync() {
      if (cache.refreshing) return;
      cache.refreshing = true;
      try {
        cache.data = computeNeedsYou();
        cache.timestamp = Date.now();
      } catch (e) {
        console.error("[needs-you] compute failed:", e.message);
      } finally {
        cache.refreshing = false;
      }
    }
    function getNeedsYouCached() {
      if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
        refreshNeedsYouAsync();
      }
      return cache.data || computeNeedsYou();
    }
    function createNeedsYouAPI2(deps = {}) {
      const injected = Boolean(deps.getHealth || deps.queueFile || deps.readTasks || deps.getContent);
      return {
        list(req, res) {
          const data = injected ? computeNeedsYou(deps) : getNeedsYouCached();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        }
      };
    }
    module2.exports = { computeNeedsYou, createNeedsYouAPI: createNeedsYouAPI2, getNeedsYouCached };
  }
});

// src/dispatch.js
var require_dispatch = __commonJS({
  "src/dispatch.js"(exports2, module2) {
    var fs2 = require("fs");
    var QUEUE_FILE = "/Users/michaeljones/.openclaw/workspace/Corvus/Operations/capture-queue.json";
    var MAX_TEXT = 2e3;
    var INTENTS = {
      capture: { capture_type: "discussion_item", prefix: "" },
      research: { capture_type: "action_item", prefix: "research: " },
      draft: { capture_type: "action_item", prefix: "draft: " }
    };
    function slugify(text) {
      return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    }
    function buildCaptureEntry({ intent, text, context }, now = /* @__PURE__ */ new Date()) {
      const spec = INTENTS[intent];
      const iso = now.toISOString();
      return {
        id: `mc-dispatch-${iso.slice(0, 10)}-${slugify(text) || "item"}-${Math.random().toString(36).slice(2, 6)}`,
        captured_at: iso,
        source: "mission-control",
        capture_type: spec.capture_type,
        content: spec.prefix + String(text).trim() + (context ? ` [context: ${String(context).trim()}]` : "")
      };
    }
    function appendCapture(file, entry) {
      let queue = [];
      try {
        const parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
        if (Array.isArray(parsed)) queue = parsed;
      } catch {
      }
      queue.push(entry);
      const tmp = file + ".tmp";
      fs2.writeFileSync(tmp, JSON.stringify(queue, null, 2) + "\n");
      fs2.renameSync(tmp, file);
      return queue.length;
    }
    function createDispatchAPI2(deps = {}) {
      const queueFile = deps.queueFile || QUEUE_FILE;
      return {
        /**
         * POST /api/mission/dispatch   { intent, text, context? }
         */
        dispatch(req, res) {
          let body = "";
          req.on("data", (chunk) => body += chunk);
          req.on("end", () => {
            try {
              const { intent, text, context } = JSON.parse(body);
              if (!INTENTS[intent]) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: `intent must be one of: ${Object.keys(INTENTS).join(", ")}` }));
                return;
              }
              if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: `text is required (non-empty, \u2264 ${MAX_TEXT} chars)` }));
                return;
              }
              const entry = buildCaptureEntry({ intent, text, context });
              const queueLength = appendCapture(queueFile, entry);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, id: entry.id, queueLength }, null, 2));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
            }
          });
        }
      };
    }
    module2.exports = { buildCaptureEntry, appendCapture, createDispatchAPI: createDispatchAPI2, INTENTS };
  }
});

// src/projects.js
var require_projects = __commonJS({
  "src/projects.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var HOME = process.env.HOME || "/Users/michaeljones";
    var DEV_DIR = path2.join(HOME, "Dev");
    var CC_PROJECTS_DIR = path2.join(HOME, ".claude", "projects");
    var cache = { data: null, timestamp: 0, refreshing: false };
    var TTL_MS = 5 * 60 * 1e3;
    function safeReadJson(filePath) {
      try {
        return JSON.parse(fs2.readFileSync(filePath, "utf8"));
      } catch {
        return null;
      }
    }
    function encodeCcDir(absPath) {
      return absPath.replace(/[/_]/g, "-");
    }
    function lastClaudeActivity(projectDir) {
      const encoded = encodeCcDir(projectDir);
      const dir = path2.join(CC_PROJECTS_DIR, encoded);
      if (!fs2.existsSync(dir)) return null;
      let newest = null;
      try {
        for (const f of fs2.readdirSync(dir)) {
          if (!f.endsWith(".jsonl")) continue;
          const st = fs2.statSync(path2.join(dir, f));
          if (newest == null || st.mtimeMs > newest) newest = st.mtimeMs;
        }
      } catch {
      }
      return newest;
    }
    function latestChange(pm) {
      const arr = pm.changelog || pm.update_history || pm.history || [];
      if (!Array.isArray(arr) || !arr.length) return null;
      let best = arr[0];
      for (const e of arr) {
        if (e && typeof e === "object" && (e.date || "") > (best.date || "")) best = e;
      }
      if (typeof best === "string") return { date: null, label: best };
      const label = best.summary || best.milestone || best.session || best.reason || (Array.isArray(best.changes) ? best.changes[0] : null) || "";
      return { date: best.date || null, label: String(label).slice(0, 200) };
    }
    function readTasksMd(dir, sample = 4) {
      const p = path2.join(dir, "TASKS.md");
      if (!fs2.existsSync(p)) return { count: 0, items: [], hasFile: false };
      let content2 = "";
      try {
        content2 = fs2.readFileSync(p, "utf8");
      } catch {
        return { count: 0, items: [], hasFile: true };
      }
      const items = [];
      let count = 0;
      const pushItem = (label) => {
        if (items.length < sample && label) items.push(String(label).slice(0, 120));
      };
      for (const line of content2.split("\n")) {
        const cb = line.match(/^\s*-\s*\[ \]\s+(.*)$/);
        if (cb) {
          count++;
          pushItem(cb[1].trim());
          continue;
        }
        if (/^\s*\|/.test(line) && !/^\s*\|[-:\s|]+\|?\s*$/.test(line)) {
          const lower = line.toLowerCase().replace(/[_*]/g, " ");
          const done = line.includes("\u2705") || /\b(done|fixed|resolved|deployed|shipped|complete|nothing pending|n\/a)\b/.test(lower);
          const open = line.includes("\u23F3") || line.includes("\u{1F6A7}") || /in progress|pending|to ?do|blocked/.test(lower);
          if (open && !done) {
            count++;
            const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
            pushItem(cells[1] || cells[0]);
          }
        }
      }
      return { count, items, hasFile: true };
    }
    function computeProjects() {
      const projects2 = [];
      let dirs = [];
      try {
        dirs = fs2.readdirSync(DEV_DIR, { withFileTypes: true });
      } catch (e) {
        console.error("[projects] cannot read Dev dir:", e.message);
        return { projects: [], asOf: (/* @__PURE__ */ new Date()).toISOString() };
      }
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dir = path2.join(DEV_DIR, d.name);
        const pmPath = path2.join(dir, "PROJECT-MEMORY.json");
        if (dir.includes("/.worktrees/") || dir.includes("/.claude/")) continue;
        if (!fs2.existsSync(pmPath)) continue;
        const pm = safeReadJson(pmPath);
        if (!pm) continue;
        const proj = pm.project || {};
        const status = proj.status || proj.current_status || proj.current_phase || "\u2014";
        const change = latestChange(pm);
        const tasks = readTasksMd(dir);
        const activityMs = lastClaudeActivity(dir);
        projects2.push({
          name: proj.full_name || proj.name || d.name,
          dir,
          slug: d.name,
          status: String(status).slice(0, 160),
          version: proj.version || null,
          latestChange: change,
          tasks,
          lastActivity: activityMs ? new Date(activityMs).toISOString() : null,
          lastActivityMs: activityMs || 0,
          obsidianDir: dir
          // for an "open in editor" link
        });
      }
      projects2.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
      projects2.forEach((p) => delete p.lastActivityMs);
      return { projects: projects2, count: projects2.length, asOf: (/* @__PURE__ */ new Date()).toISOString() };
    }
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
    function createProjectsAPI2(_deps = {}) {
      return {
        list(req, res) {
          const data = getProjectsCached();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        }
      };
    }
    module2.exports = { createProjectsAPI: createProjectsAPI2, getProjectsCached, refreshProjectsAsync, computeProjects };
  }
});

// src/signals.js
var require_signals = __commonJS({
  "src/signals.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var HOME = process.env.HOME || "/Users/michaeljones";
    var OPS_DIR = path2.join(HOME, ".openclaw/workspace/Corvus/Operations");
    var QUEUE_PATH = path2.join(OPS_DIR, "rt-signal-scorer-queue.json");
    var SCORED_CANDIDATES = [
      path2.join(OPS_DIR, "rt-signal-scorer-scored.json"),
      path2.join(OPS_DIR, "rt-signals-scored.json"),
      path2.join(HOME, ".openclaw/workspace/Corvus/Operations/rt-signal-scored.json")
    ];
    var DISMISSED_PATH = path2.join(OPS_DIR, "mission-control-dismissed-signals.json");
    var PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
    var cache = { data: null, timestamp: 0, refreshing: false };
    var TTL_MS = 6e4;
    function safeReadJson(filePath, fallback) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const raw = fs2.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.error(`[signals] read ${filePath}: ${e.message}`);
        return fallback;
      }
    }
    function asArray(parsed) {
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      if (parsed && Array.isArray(parsed.queue)) return parsed.queue;
      if (parsed && Array.isArray(parsed.signals)) return parsed.signals;
      return [];
    }
    function loadDismissed() {
      const d = safeReadJson(DISMISSED_PATH, []);
      return new Set(Array.isArray(d) ? d : []);
    }
    function shapeSignal(s) {
      const priority = (s.priority || s.score_band || "").toLowerCase();
      return {
        id: s.id || s.url || s.topic,
        source: s.source || "unknown",
        topic: s.topic || s.title || "(untitled signal)",
        url: s.url || null,
        priority: priority || "medium",
        priorityRank: PRIORITY_RANK[priority] || 2,
        score: s.score ?? null,
        pillars: s.pillar_relevance || s.pillars || [],
        notes: (s.notes || "").slice(0, 200),
        queuedAt: s.queued_at || s.scored_at || s.date || null,
        status: s.status || null
      };
    }
    function computeSignals() {
      let raw = null;
      let sourceFile = "queue";
      for (const c of SCORED_CANDIDATES) {
        if (fs2.existsSync(c)) {
          raw = safeReadJson(c, null);
          sourceFile = "scored";
          break;
        }
      }
      if (!raw) raw = safeReadJson(QUEUE_PATH, []);
      const dismissed = loadDismissed();
      const signals2 = asArray(raw).map(shapeSignal).filter((s) => !dismissed.has(s.id)).sort((a, b) => {
        if (b.priorityRank !== a.priorityRank) return b.priorityRank - a.priorityRank;
        return String(b.queuedAt || "").localeCompare(String(a.queuedAt || ""));
      });
      return {
        signals: signals2,
        count: signals2.length,
        source: sourceFile,
        // "scored" or "queue" — UI can note when it's only the queue
        asOf: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    function refreshSignalsAsync() {
      if (cache.refreshing) return;
      cache.refreshing = true;
      try {
        cache.data = computeSignals();
        cache.timestamp = Date.now();
      } catch (e) {
        console.error("[signals] compute failed:", e.message);
      } finally {
        cache.refreshing = false;
      }
    }
    function getSignalsCached() {
      if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
        refreshSignalsAsync();
      }
      return cache.data || computeSignals();
    }
    function dismissSignal(id) {
      const dismissed = loadDismissed();
      dismissed.add(id);
      try {
        fs2.mkdirSync(OPS_DIR, { recursive: true });
        fs2.writeFileSync(DISMISSED_PATH, JSON.stringify([...dismissed], null, 2), "utf8");
      } catch (e) {
        console.error("[signals] dismiss write failed:", e.message);
        return false;
      }
      cache.timestamp = 0;
      return true;
    }
    function createSignalsAPI2(_deps = {}) {
      return {
        list(req, res) {
          const data = getSignalsCached();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        },
        dismiss(req, res, id) {
          const ok = dismissSignal(id);
          res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok, id }));
        }
      };
    }
    module2.exports = { createSignalsAPI: createSignalsAPI2, getSignalsCached, refreshSignalsAsync, computeSignals };
  }
});

// src/index.js
var http = require("http");
var fs = require("fs");
var path = require("path");
var args = process.argv.slice(2);
var cliProfile = null;
var cliPort = null;
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--profile":
    case "-p":
      cliProfile = args[++i];
      break;
    case "--port":
      cliPort = parseInt(args[++i], 10);
      break;
    case "--help":
    case "-h":
      console.log(`
OpenClaw Command Center

Usage: node lib/server.js [options]

Options:
  --profile, -p <name>  OpenClaw profile (uses ~/.openclaw-<name>)
  --port <port>         Server port (default: 3333)
  --help, -h            Show this help

Environment:
  OPENCLAW_PROFILE      Same as --profile
  PORT                  Same as --port

Examples:
  node lib/server.js --profile production
  node lib/server.js -p dev --port 3334
`);
      process.exit(0);
  }
}
if (cliProfile) {
  process.env.OPENCLAW_PROFILE = cliProfile;
}
if (cliPort) {
  process.env.PORT = cliPort.toString();
}
var { getVersion } = require_utils();
var { CONFIG, getOpenClawDir } = require_config();
var { handleJobsRequest, isJobsRoute } = require_jobs();
var { runOpenClaw, runOpenClawAsync, extractJSON, setCliEnabled } = require_openclaw();
var { getSystemVitals, checkOptionalDeps, getOptionalDeps } = require_vitals();
var { checkAuth, getUnauthorizedPage } = require_auth();
var { loadPrivacySettings, savePrivacySettings } = require_privacy();
var {
  loadOperators,
  saveOperators,
  getOperatorBySlackId,
  startOperatorsRefresh,
  calculateOperatorStats
} = require_operators();
var { createSessionsModule } = require_sessions();
var { getCronJobs } = require_cron();
var { getCerebroTopics, updateTopicStatus } = require_cerebro();
var {
  getDailyTokenUsage,
  getTokenStats,
  getCostBreakdown,
  startTokenUsageRefresh,
  refreshTokenUsageAsync
} = require_tokens();
var { getLlmUsage, getRoutingStats, startLlmUsageRefresh } = require_llm_usage();
var { executeAction } = require_actions();
var { migrateDataDir } = require_data();
var { createStateModule } = require_state();
var {
  createMissionControlAPI,
  getRecentCronFailures
} = require_mission_control();
var { createPhase2API, readDailyTasks } = require_mc_phase2();
var { createAgentsAPI } = require_agents();
var { getOllamaUsageCached, refreshOllamaUsageAsync } = require_ollama_usage();
var { createHealthAPI } = require_health();
var { createSystemMindAPI, getSystemMindCached } = require_system_mind();
var { createFocusAPI } = require_focus();
var { createNeedsYouAPI } = require_needs_you();
var { createDispatchAPI } = require_dispatch();
var { createProjectsAPI } = require_projects();
var { createSignalsAPI } = require_signals();
var { createContentAPI } = require_corvus_proxy();
var PORT = CONFIG.server.port;
var DASHBOARD_DIR = path.join(__dirname, "../public");
var PATHS = CONFIG.paths;
var AUTH_CONFIG = {
  mode: CONFIG.auth.mode,
  token: CONFIG.auth.token,
  allowedUsers: CONFIG.auth.allowedUsers,
  allowedIPs: CONFIG.auth.allowedIPs,
  publicPaths: CONFIG.auth.publicPaths
};
var DATA_DIR = path.join(getOpenClawDir(), "command-center", "data");
var LEGACY_DATA_DIR = path.join(DASHBOARD_DIR, "data");
var sseClients = /* @__PURE__ */ new Set();
function sendSSE(res, event, data) {
  try {
    res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
  } catch (e) {
  }
}
function broadcastSSE(event, data) {
  for (const client of sseClients) {
    sendSSE(client, event, data);
  }
}
var sessions = createSessionsModule({
  getOpenClawDir,
  getOperatorBySlackId: (slackId) => getOperatorBySlackId(DATA_DIR, slackId),
  runOpenClaw,
  runOpenClawAsync,
  extractJSON
});
var state = createStateModule({
  CONFIG,
  getOpenClawDir,
  getSessions: (opts) => sessions.getSessions(opts),
  getSystemVitals,
  getCronJobs: () => getCronJobs(getOpenClawDir),
  loadOperators: () => loadOperators(DATA_DIR),
  calculateOperatorStats,
  getLlmUsage: () => getLlmUsage(PATHS.state),
  getDailyTokenUsage: () => getDailyTokenUsage(getOpenClawDir),
  getTokenStats,
  getCerebroTopics: (opts) => getCerebroTopics(PATHS.cerebro, opts),
  runOpenClaw,
  extractJSON,
  readTranscript: (sessionId) => sessions.readTranscript(sessionId)
});
var missionControl = createMissionControlAPI({
  getOpenClawDir,
  getDailyTasks: (dateStr) => readDailyTasks(dateStr),
  getBrief: () => {
    const mind = getSystemMindCached();
    const latest = mind && mind.sessions && mind.sessions[0];
    if (!latest) return null;
    return {
      date: latest.date,
      project: latest.project,
      environment: latest.environment,
      summary: latest.summary,
      openThreads: latest.openThreads || []
    };
  }
});
var phase2 = createPhase2API({
  getOpenClawDir
});
var agents = createAgentsAPI({
  getOpenClawDir
});
var health = createHealthAPI({
  getOpenClawDir
});
var systemMind = createSystemMindAPI({});
var focus = createFocusAPI({});
var needsYou = createNeedsYouAPI({});
var dispatchApi = createDispatchAPI({});
var projects = createProjectsAPI({});
var signals = createSignalsAPI({});
var content = createContentAPI({});
setCliEnabled(CONFIG.integrations.openclawCli.enabled);
console.log(
  `[Config] openclaw CLI polls: ${CONFIG.integrations.openclawCli.enabled ? "enabled" : "disabled (token expired \u2014 using ollama-usage)"}`
);
process.nextTick(() => migrateDataDir(DATA_DIR, LEGACY_DATA_DIR));
startOperatorsRefresh(DATA_DIR, getOpenClawDir);
startLlmUsageRefresh();
startTokenUsageRefresh(getOpenClawDir);
function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  if (pathname.includes("..")) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const normalizedPath = path.normalize(pathname).replace(/^[/\\]+/, "");
  const filePath = path.join(DASHBOARD_DIR, normalizedPath);
  const resolvedDashboardDir = path.resolve(DASHBOARD_DIR);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(resolvedDashboardDir + path.sep) && resolvedFilePath !== resolvedDashboardDir) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };
  fs.readFile(filePath, (err, content2) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const headers = { "Content-Type": contentTypes[ext] || "text/plain" };
    if ([".html", ".css", ".js", ".json"].includes(ext)) {
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, headers);
    res.end(content2);
  });
}
function handleApi(req, res) {
  const sessionsList = sessions.getSessions();
  const capacity = state.getCapacity();
  const tokenStats = getTokenStats(sessionsList, capacity, CONFIG);
  const data = {
    sessions: sessionsList,
    cron: getCronJobs(getOpenClawDir),
    system: state.getSystemStatus(),
    activity: state.getRecentActivity(),
    tokenStats,
    capacity,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}
var server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const urlParts = req.url.split("?");
  const pathname = urlParts[0];
  const query = new URLSearchParams(urlParts[1] || "");
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: PORT, timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
    return;
  }
  const isPublicPath = AUTH_CONFIG.publicPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (!isPublicPath && AUTH_CONFIG.mode !== "none") {
    const authResult = checkAuth(req, AUTH_CONFIG);
    if (!authResult.authorized) {
      console.log(`[AUTH] Denied: ${authResult.reason} (path: ${pathname})`);
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end(getUnauthorizedPage(authResult.reason, authResult.user, AUTH_CONFIG));
      return;
    }
    req.authUser = authResult.user;
    if (authResult.user?.login || authResult.user?.email) {
      console.log(
        `[AUTH] Allowed: ${authResult.user.login || authResult.user.email} (path: ${pathname})`
      );
    } else {
      console.log(`[AUTH] Allowed: ${req.socket?.remoteAddress} (path: ${pathname})`);
    }
  }
  if (pathname === "/api/status") {
    handleApi(req, res);
  } else if (pathname === "/api/session") {
    const sessionKey = query.get("key");
    if (!sessionKey) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session key" }));
      return;
    }
    const detail = sessions.getSessionDetail(sessionKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(detail, null, 2));
  } else if (pathname === "/api/cerebro") {
    const offset = parseInt(query.get("offset") || "0", 10);
    const limit = parseInt(query.get("limit") || "20", 10);
    const statusFilter = query.get("status") || "all";
    const data = getCerebroTopics(PATHS.cerebro, { offset, limit, status: statusFilter });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname.startsWith("/api/cerebro/topic/") && pathname.endsWith("/status") && req.method === "POST") {
    const topicId = decodeURIComponent(
      pathname.replace("/api/cerebro/topic/", "").replace("/status", "")
    );
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { status: newStatus } = JSON.parse(body);
        if (!newStatus || !["active", "resolved", "parked"].includes(newStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Invalid status. Must be: active, resolved, or parked" })
          );
          return;
        }
        const result = updateTopicStatus(PATHS.cerebro, topicId, newStatus);
        if (result.error) {
          res.writeHead(result.code || 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  } else if (pathname === "/api/llm-quota") {
    const data = getLlmUsage(PATHS.state);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/cost-breakdown") {
    const data = getCostBreakdown(CONFIG, (opts) => sessions.getSessions(opts), getOpenClawDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/subagents") {
    const data = state.getSubagentStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ subagents: data }, null, 2));
  } else if (pathname === "/api/action") {
    const action = query.get("action");
    if (!action) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing action parameter" }));
      return;
    }
    const result = executeAction(action, { runOpenClaw, extractJSON, PORT });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
  } else if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    sseClients.add(res);
    console.log(`[SSE] Client connected (total: ${sseClients.size})`);
    sendSSE(res, "connected", { message: "Connected to Command Center", timestamp: Date.now() });
    const cachedState = state.getFullState();
    if (cachedState) {
      sendSSE(res, "update", cachedState);
    } else {
      sendSSE(res, "update", { sessions: [], loading: true });
    }
    req.on("close", () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
    });
    return;
  } else if (pathname === "/api/whoami") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          authMode: AUTH_CONFIG.mode,
          user: req.authUser || null
        },
        null,
        2
      )
    );
  } else if (pathname === "/api/about") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          name: "OpenClaw Command Center",
          version: getVersion(),
          description: "A Starcraft-inspired dashboard for AI agent orchestration",
          license: "MIT",
          repository: "https://github.com/jontsai/openclaw-command-center",
          builtWith: ["OpenClaw", "Node.js", "Vanilla JS"],
          inspirations: ["Starcraft", "Inside Out", "iStatMenus", "DaisyDisk", "Gmail"]
        },
        null,
        2
      )
    );
  } else if (pathname === "/api/state") {
    const fullState = state.getFullState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(fullState, null, 2));
  } else if (pathname === "/api/vitals") {
    const vitals = getSystemVitals();
    const optionalDeps = getOptionalDeps();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vitals, optionalDeps }, null, 2));
  } else if (pathname === "/api/capacity") {
    const capacity = state.getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(capacity, null, 2));
  } else if (pathname === "/api/sessions") {
    const page = parseInt(query.get("page")) || 1;
    const pageSize = parseInt(query.get("pageSize")) || 20;
    const statusFilter = query.get("status");
    const allSessions = sessions.getSessions({ limit: null });
    const statusCounts = {
      all: allSessions.length,
      live: allSessions.filter((s) => s.active).length,
      recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
      idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length
    };
    let filteredSessions = allSessions;
    if (statusFilter === "live") {
      filteredSessions = allSessions.filter((s) => s.active);
    } else if (statusFilter === "recent") {
      filteredSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    } else if (statusFilter === "idle") {
      filteredSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    }
    const total = filteredSessions.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const displaySessions = filteredSessions.slice(offset, offset + pageSize);
    const tokenStats = getTokenStats(allSessions, state.getCapacity(), CONFIG);
    const capacity = state.getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          sessions: displaySessions,
          pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages
          },
          statusCounts,
          tokenStats,
          capacity
        },
        null,
        2
      )
    );
  } else if (pathname === "/api/cron") {
    const cron = getCronJobs(getOpenClawDir);
    const failures = getRecentCronFailures(getOpenClawDir, 24 * 7);
    const failById = new Map(failures.map((f) => [f.id, f]));
    const enriched = cron.map((j) => {
      const f = failById.get(j.id);
      return {
        ...j,
        lastStatus: f?.lastStatus || null,
        lastError: f?.lastError || null,
        lastRunAtMs: f?.lastRunAtMs || null,
        consecutiveErrors: f?.consecutiveErrors || 0
      };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cron: enriched }, null, 2));
  } else if (pathname === "/api/operators") {
    const method = req.method;
    const data = loadOperators(DATA_DIR);
    if (method === "GET") {
      const allSessions = sessions.getSessions({ limit: null });
      const operatorsWithStats = calculateOperatorStats(data, allSessions);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            ...operatorsWithStats,
            timestamp: Date.now()
          },
          null,
          2
        )
      );
    } else if (method === "POST") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const newOp = JSON.parse(body);
          const existingIdx = data.operators.findIndex((op) => op.id === newOp.id);
          if (existingIdx >= 0) {
            data.operators[existingIdx] = { ...data.operators[existingIdx], ...newOp };
          } else {
            data.operators.push({
              ...newOp,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          if (saveOperators(DATA_DIR, data)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, operator: newOp }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (pathname === "/api/llm-usage") {
    const usage = getLlmUsage(PATHS.state);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(usage, null, 2));
  } else if (pathname === "/api/ollama-usage") {
    const ollamaUsage = getOllamaUsageCached();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ollamaUsage || { error: "No data yet" }, null, 2));
  } else if (pathname === "/api/routing-stats") {
    const hours = parseInt(query.get("hours") || "24", 10);
    const stats = getRoutingStats(PATHS.skills, PATHS.state, hours);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats, null, 2));
  } else if (pathname === "/api/memory") {
    const memory = state.getMemoryStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ memory }, null, 2));
  } else if (pathname === "/api/privacy") {
    if (req.method === "GET") {
      const settings = loadPrivacySettings(DATA_DIR);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings, null, 2));
    } else if (req.method === "POST" || req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const current = loadPrivacySettings(DATA_DIR);
          const merged = {
            version: current.version || 1,
            hiddenTopics: updates.hiddenTopics ?? current.hiddenTopics ?? [],
            hiddenSessions: updates.hiddenSessions ?? current.hiddenSessions ?? [],
            hiddenCrons: updates.hiddenCrons ?? current.hiddenCrons ?? [],
            hideHostname: updates.hideHostname ?? current.hideHostname ?? false
          };
          if (savePrivacySettings(DATA_DIR, merged)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, settings: merged }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save privacy settings" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (pathname === "/api/mission/three-things" && req.method === "GET") {
    missionControl.threeThings(req, res);
  } else if (pathname === "/api/mission/three-things/dismiss" && req.method === "POST") {
    missionControl.threeThingsDismiss(req, res);
  } else if (pathname === "/api/mission/three-things/undismiss" && req.method === "POST") {
    missionControl.threeThingsUndismiss(req, res);
  } else if (pathname === "/api/mission/three-things/dismissed" && req.method === "GET") {
    missionControl.threeThingsDismissedList(req, res);
  } else if (pathname === "/api/mission/braindump" && req.method === "GET") {
    missionControl.brainDumpList(req, res);
  } else if (pathname === "/api/mission/braindump" && req.method === "POST") {
    missionControl.brainDumpCreate(req, res);
  } else if (pathname.startsWith("/api/mission/braindump/") && req.method === "PATCH") {
    const id = decodeURIComponent(pathname.replace("/api/mission/braindump/", ""));
    missionControl.brainDumpUpdate(req, res, id);
  } else if (pathname.startsWith("/api/mission/braindump/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.replace("/api/mission/braindump/", ""));
    missionControl.brainDumpDelete(req, res, id);
  } else if (pathname === "/api/mission/feed" && req.method === "GET") {
    missionControl.feedList(req, res);
  } else if (pathname === "/api/mission/feed" && req.method === "POST") {
    missionControl.feedAppend(req, res);
  } else if (pathname.startsWith("/api/mission/feed/") && pathname.endsWith("/ack") && req.method === "PATCH") {
    const id = decodeURIComponent(
      pathname.replace("/api/mission/feed/", "").replace(/\/ack$/, "")
    );
    missionControl.feedAck(req, res, id);
  } else if (pathname.startsWith("/api/mission/feed/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.replace("/api/mission/feed/", ""));
    missionControl.feedDismiss(req, res, id);
  } else if (pathname === "/api/mission/cron-failures" && req.method === "GET") {
    missionControl.cronFailures(req, res);
  } else if (pathname === "/api/mission/today" && req.method === "GET") {
    missionControl.today(req, res);
  } else if (pathname === "/api/mission/tasks" && req.method === "GET") {
    missionControl.tasksList(req, res);
  } else if (pathname === "/api/mission/outstanding" && req.method === "GET") {
    missionControl.outstanding(req, res);
  } else if (pathname === "/api/mission/projects" && req.method === "GET") {
    missionControl.projectsList(req, res);
  } else if (/^\/api\/mission\/tasks\/[^/]+\/promote-to-project$/.test(pathname) && req.method === "POST") {
    const id = decodeURIComponent(
      pathname.replace("/api/mission/tasks/", "").replace(/\/promote-to-project$/, "")
    );
    missionControl.promoteToProject(req, res, id);
  } else if (pathname === "/api/mission/agents" && req.method === "GET") {
    agents.list(req, res);
  } else if (pathname === "/api/mission/agents/history" && req.method === "GET") {
    agents.history(req, res);
  } else if (pathname === "/api/mission/agents/schedule" && req.method === "GET") {
    agents.scheduleBoard(req, res);
  } else if (pathname.startsWith("/api/mission/agents/") && req.method === "GET") {
    const name = decodeURIComponent(pathname.replace("/api/mission/agents/", ""));
    if (name && name !== "history") {
      agents.detail(req, res, name);
      return;
    }
  } else if (pathname === "/api/mc/promote" && req.method === "POST") {
    phase2.promote(req, res);
  } else if (pathname.startsWith("/api/mc/kanban/") && req.method === "GET") {
    const column = decodeURIComponent(pathname.replace("/api/mc/kanban/", ""));
    phase2.kanban(req, res, column);
  } else if (pathname.startsWith("/api/mc/card/") && req.method === "PATCH") {
    const id = decodeURIComponent(pathname.replace("/api/mc/card/", ""));
    phase2.cardUpdate(req, res, id);
  } else if (pathname.startsWith("/api/mc/card/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.replace("/api/mc/card/", ""));
    phase2.cardDelete(req, res, id);
  } else if (pathname === "/api/mc/rollover" && req.method === "POST") {
    phase2.rollover(req, res);
  } else if (pathname === "/api/mc/sync-from-obsidian" && req.method === "POST") {
    phase2.syncFromObsidian(req, res);
  } else if (pathname === "/api/mc/cleanup" && req.method === "POST") {
    phase2.cleanup(req, res);
  } else if (pathname === "/api/mc/velocity" && req.method === "GET") {
    phase2.velocity(req, res);
  } else if (pathname === "/api/mission/health" && req.method === "GET") {
    health.list(req, res);
  } else if (pathname === "/api/mission/system-mind" && req.method === "GET") {
    systemMind.list(req, res);
  } else if (pathname === "/api/mission/focus" && req.method === "GET") {
    focus.list(req, res);
  } else if (pathname === "/api/mission/needs-you" && req.method === "GET") {
    needsYou.list(req, res);
  } else if (pathname === "/api/mission/dispatch" && req.method === "POST") {
    dispatchApi.dispatch(req, res);
  } else if (pathname === "/api/mission/dev-projects" && req.method === "GET") {
    projects.list(req, res);
  } else if (pathname === "/api/mission/signals" && req.method === "GET") {
    signals.list(req, res);
  } else if (pathname.startsWith("/api/mission/signals/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.replace("/api/mission/signals/", ""));
    signals.dismiss(req, res, id);
  } else if (pathname === "/api/mission/content" && req.method === "GET") {
    content.list(req, res);
  } else if (isJobsRoute(pathname)) {
    handleJobsRequest(req, res, pathname, query, req.method);
  } else {
    serveStatic(req, res);
  }
});
server.listen(PORT, () => {
  const profile = process.env.OPENCLAW_PROFILE;
  console.log(`\u{1F99E} OpenClaw Command Center running at http://localhost:${PORT}`);
  if (profile) {
    console.log(`   Profile: ${profile} (~/.openclaw-${profile})`);
  }
  console.log(`   Press Ctrl+C to stop`);
  setTimeout(async () => {
    console.log("[Startup] Pre-warming caches in background...");
    try {
      await Promise.all([sessions.refreshSessionsCache(), refreshTokenUsageAsync(getOpenClawDir)]);
      getSystemVitals();
      console.log("[Startup] Caches warmed.");
    } catch (e) {
      console.log("[Startup] Cache warming error:", e.message);
    }
    checkOptionalDeps();
  }, 100);
  const SESSIONS_CACHE_TTL = 1e4;
  setInterval(() => sessions.refreshSessionsCache(), SESSIONS_CACHE_TTL);
});
var sseRefreshing = false;
setInterval(() => {
  if (sseClients.size > 0 && !sseRefreshing) {
    sseRefreshing = true;
    try {
      const fullState = state.refreshState();
      broadcastSSE("update", fullState);
      broadcastSSE("heartbeat", { clients: sseClients.size, timestamp: Date.now() });
    } catch (e) {
      console.error("[SSE] Broadcast error:", e.message);
    }
    sseRefreshing = false;
  }
}, 15e3);
