// utils.js — date helpers used across modules

const DAY_MS = 86400000;

/**
 * Convert date → UTC normalized midnight
 */
export function toUTC(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Add N days to date
 */
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return toUTC(x);
}

/**
 * Number of days between two dates
 */
export function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

/**
 * Format date → yyyy-mm-dd
 */
export function formatDate(d) {
  if (!d || isNaN(d.getTime())) return "Invalid";
  return d.toISOString().slice(0, 10);
}
export function computeCriticalPath(tasks) {
  if (!tasks.length) return new Set();

  // Normalize tasks to use day numbers
  const DAY = 86400000;

  // Duration in whole days
  const dur = {};
  tasks.forEach((t) => {
    dur[t.id] = Math.max(1, Math.round((t.end - t.start) / DAY) + 1);
  });

  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Build parent→child graph
  const children = {};
  const parents = {};
  tasks.forEach((t) => {
    children[t.id] = [];
    parents[t.id] = t.depends ? [t.depends] : [];
  });

  tasks.forEach((t) => {
    if (t.depends) {
      children[t.depends].push(t.id);
    }
  });

  // -----------------------------
  // FORWARD PASS (ES / EF)
  // -----------------------------
  const ES = {}; // earliest start (in days)
  const EF = {}; // earliest finish

  // Tasks with no dependencies start at ES = 0
  tasks.forEach((t) => {
    ES[t.id] = 0;
    EF[t.id] = dur[t.id];
  });

  // Topological-like relaxation
  let changed = true;
  while (changed) {
    changed = false;

    for (const t of tasks) {
      if (!t.depends) continue;

      const p = byId.get(t.depends);
      if (!p) continue;

      const lag = t.lagDays || 0;
      const lead = t.leadDays || 0;
      const type = t.depType || "FS";

      let constraintES = 0;

      if (type === "SS") {
        constraintES = ES[p.id] + (lag - lead);
      } else {
        constraintES = EF[p.id] + (lag - lead);
      }

      if (constraintES > ES[t.id]) {
        ES[t.id] = constraintES;
        EF[t.id] = ES[t.id] + dur[t.id];
        changed = true;
      }
    }
  }

  // -----------------------------
  // BACKWARD PASS (LS / LF)
  // -----------------------------
  const maxEF = Math.max(...Object.values(EF));
  const LF = {};
  const LS = {};

  tasks.forEach((t) => {
    LF[t.id] = maxEF;
    LS[t.id] = LF[t.id] - dur[t.id];
  });

  changed = true;
  while (changed) {
    changed = false;

    for (const t of tasks) {
      for (const cId of children[t.id]) {
        const c = byId.get(cId);
        const type = c.depType || "FS";
        const lag = c.lagDays || 0;
        const lead = c.leadDays || 0;

        let allowedLF = LF[cId];

        // Child's start constraint
        if (type === "SS") {
          allowedLF = LS[cId] + (lag - lead);
        } else {
          allowedLF = LS[cId] - (lag - lead);
        }

        if (allowedLF < LF[t.id]) {
          LF[t.id] = allowedLF;
          LS[t.id] = LF[t.id] - dur[t.id];
          changed = true;
        }
      }
    }
  }

  // -----------------------------
  // CRITICAL PATH = tasks with 0 slack
  // -----------------------------
  const cp = new Set();
  tasks.forEach((t) => {
    const slack = LS[t.id] - ES[t.id];
    if (Math.abs(slack) < 0.0001) {
      cp.add(t.id);
    }
  });

  return cp;
}
export function showLoading(msg = "Loading...") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  const text = document.getElementById("loadingText");
  if (text) text.textContent = msg;
  overlay.style.display = "flex";
}

export function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
}
export function toDateInput(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
/* ============================================================
   HELPER: WATERFALL SORT (DFS Topological)
   Groups: Parent -> Child -> Grandchild, then sorts by Date
============================================================ */
export function organizeTasksByWaterfall(taskList) {
  // 1. Create Maps for fast lookup
  const taskMap = new Map();
  const childrenMap = new Map();
  const roots = [];

  taskList.forEach((t) => {
    taskMap.set(t.id, t);
    childrenMap.set(t.id, []);
  });

  // 2. Identify Roots (No parent, or parent not in this list) vs Children
  taskList.forEach((t) => {
    if (t.depends && taskMap.has(t.depends)) {
      childrenMap.get(t.depends).push(t);
    } else {
      roots.push(t);
    }
  });

  // 3. Sort Roots by Start Date (The main timeline backbone)
  roots.sort((a, b) => new Date(a.start) - new Date(b.start));

  // 4. Recursive Traversal (DFS) to build final order
  const sortedList = [];
  const visitedIds = new Set();

  function traverse(task) {
    if (visitedIds.has(task.id)) return;
    visitedIds.add(task.id);
    sortedList.push(task);

    // Find children
    const kids = childrenMap.get(task.id) || [];

    // Sort children by Date so siblings appear chronologically
    kids.sort((a, b) => new Date(a.start) - new Date(b.start));

    // Visit children immediately to keep them under parent
    kids.forEach((kid) => traverse(kid));
  }

  // Execute Traversal
  roots.forEach((root) => traverse(root));

  // 5. Re-assign Row Numbers based on new order
  // (This ensures the visual row matches the array index)
  sortedList.forEach((t, index) => {
    t.row = index;
  });

  return sortedList;
}
