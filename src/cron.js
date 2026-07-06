const fs = require("fs");
const path = require("path");

// Convert cron expression to human-readable text
function cronToHuman(expr) {
  if (!expr || expr === "—") return null;

  const parts = expr.split(" ");
  if (parts.length < 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Helper to format time
  function formatTime(h, m) {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (isNaN(hNum)) return null;
    const ampm = hNum >= 12 ? "pm" : "am";
    const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
    return mNum === 0 ? `${h12}${ampm}` : `${h12}:${mNum.toString().padStart(2, "0")}${ampm}`;
  }

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }

  // Every X minutes
  if (minute.startsWith("*/")) {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }

  // Every X hours (*/N in hour field)
  if (hour.startsWith("*/")) {
    const interval = hour.slice(2);
    const minStr = minute === "0" ? "" : `:${minute.padStart(2, "0")}`;
    return `Every ${interval} hours${minStr ? " at " + minStr : ""}`;
  }

  // Every hour at specific minute
  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Hourly at :${minute.padStart(2, "0")}`;
  }

  // Build time string for specific hour
  let timeStr = "";
  if (minute !== "*" && hour !== "*" && !hour.startsWith("*/")) {
    timeStr = formatTime(hour, minute);
  }

  // Daily at specific time
  if (timeStr && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${timeStr}`;
  }

  // Weekdays (Mon-Fri) - check before generic day of week
  if ((dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekdays at ${timeStr}` : "Weekdays";
  }

  // Weekends - check before generic day of week
  if ((dayOfWeek === "0,6" || dayOfWeek === "6,0") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekends at ${timeStr}` : "Weekends";
  }

  // Specific day of week
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map((d) => {
      const num = parseInt(d, 10);
      return dayNames[num] || d;
    });
    const dayStr = days.length === 1 ? days[0] : days.join(", ");
    return timeStr ? `${dayStr} at ${timeStr}` : `Every ${dayStr}`;
  }

  // Specific day of month
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    const day = parseInt(dayOfMonth, 10);
    const suffix =
      day === 1 || day === 21 || day === 31
        ? "st"
        : day === 2 || day === 22
          ? "nd"
          : day === 3 || day === 23
            ? "rd"
            : "th";
    return timeStr ? `${day}${suffix} of month at ${timeStr}` : `${day}${suffix} of every month`;
  }

  // Fallback: just show the time if we have it
  if (timeStr) {
    return `At ${timeStr}`;
  }

  return expr; // Return original as fallback
}

// Read live state from jobs-state.json (source of truth for run status)
function readCronState(getOpenClawDir) {
  try {
    const statePath = path.join(getOpenClawDir(), "cron", "jobs-state.json");
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
      return data.jobs || {};
    }
  } catch (e) {
    console.error("Failed to read cron state:", e.message);
  }
  return {};
}

// Get cron jobs - reads from jobs.json and merges live state from jobs-state.json
function getCronJobs(getOpenClawDir) {
  try {
    const cronPath = path.join(getOpenClawDir(), "cron", "jobs.json");
    if (fs.existsSync(cronPath)) {
      const data = JSON.parse(fs.readFileSync(cronPath, "utf8"));
      const liveState = readCronState(getOpenClawDir);

      return (data.jobs || []).map((j) => {
        // Merge live state from jobs-state.json
        const state = liveState[j.id]?.state || j.state || {};

        // Parse schedule
        let scheduleStr = "—";
        let scheduleHuman = null;
        if (j.schedule) {
          if (j.schedule.kind === "cron" && j.schedule.expr) {
            scheduleStr = j.schedule.expr;
            scheduleHuman = cronToHuman(j.schedule.expr);
          } else if (j.schedule.kind === "once") {
            scheduleStr = "once";
            scheduleHuman = "One-time";
          } else if (j.schedule.kind === "every" && j.schedule.everyMs) {
            const mins = Math.round(j.schedule.everyMs / 60000);
            scheduleHuman = `Every ${mins} minutes`;
            scheduleStr = `*/${mins} * * * *`;
          }
        }

        // Format next run
        let nextRunStr = "—";
        const nextRunMs = state.nextRunAtMs;
        if (nextRunMs) {
          const next = new Date(nextRunMs);
          const now = new Date();
          const diffMs = next - now;
          const diffMins = Math.round(diffMs / 60000);
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

        // Format last run time
        let lastRunStr = null;
        if (state.lastRunAtMs) {
          const last = new Date(state.lastRunAtMs);
          const now = new Date();
          const diffMs = now - last;
          const diffMins = Math.round(diffMs / 60000);
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
          scheduleHuman: scheduleHuman,
          nextRun: nextRunStr,
          nextRunAtMs: state.nextRunAtMs || null,
          enabled: j.enabled !== false,
          lastStatus: state.lastStatus || state.lastRunStatus || null,
          lastError: state.lastError || null,
          lastRunAtMs: state.lastRunAtMs || null,
          lastRunStr: lastRunStr,
          lastDurationMs: state.lastDurationMs || null,
          consecutiveErrors: state.consecutiveErrors || 0,
          lastDelivered: state.lastDelivered !== false,
        };
      });
    }
  } catch (e) {
    console.error("Failed to get cron:", e.message);
  }
  return [];
}

module.exports = {
  cronToHuman,
  getCronJobs,
  readCronState,
};
