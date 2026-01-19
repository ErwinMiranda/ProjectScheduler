// state.js — offline-first global state + undo history + multi-select

/* ============================================================
   GLOBAL TASK LIST (LOCAL ONLY — not tied to Firestore directly)
============================================================ */
export let tasks = [];
export let baselineTasks = [];

/**
 * Replace the entire task list (used on WO load or discard)
 */
export function updateTaskList(list) {
  tasks = list.map((t) => ({
    ...t,
    start: new Date(t.start),
    end: new Date(t.end),
    row: typeof t.row === "number" ? t.row : 0,
    lagDays: Number.isFinite(t.lagDays) ? t.lagDays : 0,
    leadDays: Number.isFinite(t.leadDays) ? t.leadDays : 0,
    color: t.color || "",
  }));
}

/* ============================================================
   MULTI-SELECTION (CTRL + Click)
============================================================ */
export const selectedBars = new Set();

export function clearSelection() {
  selectedBars.clear();
}

/* ============================================================
   FILTER STATE (NEW - For Option A)
============================================================ */
export const filterState = {
  skills: [], // Empty means "Show All"
  dayFrom: null,
  dayTo: null,
};

/* ============================================================
   UNDO HISTORY (LOCAL ONLY)
============================================================ */
let history = [];
let historyIndex = -1;

/**
 * Push snapshot BEFORE making changes
 */
export function pushHistory() {
  // Cut off any redo branch
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }

  // Deep clone tasks
  const snapshot = JSON.stringify(tasks);
  history.push(snapshot);
  historyIndex++;

  // Limit memory
  if (history.length > 50) {
    history.shift();
    historyIndex--;
  }
}

/**
 * Undo one step
 */
export function undoHistory() {
  if (historyIndex <= 0) return false;

  historyIndex--;
  const snapshot = history[historyIndex];
  const restored = JSON.parse(snapshot);

  tasks = restored.map((t) => ({
    ...t,
    start: new Date(t.start),
    end: new Date(t.end),
  }));

  return true;
}

/**
 * Redo — currently unused but ready if needed
 */
export function redoHistory() {
  if (historyIndex >= history.length - 1) return false;

  historyIndex++;
  const snapshot = history[historyIndex];
  const restored = JSON.parse(snapshot);

  tasks = restored.map((t) => ({
    ...t,
    start: new Date(t.start),
    end: new Date(t.end),
  }));

  return true;
}

/* ============================================================
   UTIL: Get a task by ID
============================================================ */
export function getTask(id) {
  return tasks.find((t) => t.id === id);
}

export function setBaselineTasks(list) {
  console.error(
    "❌ BASELINE RESET",
    {
      sourceLength: list.length,
      firstId: list[0]?.id,
    },
    new Error().stack,
  );

  baselineTasks = list.map((t) => ({
    ...t,
    start: new Date(t.start),
    end: new Date(t.end),
  }));
}
export function commitBaselineFromFirestore(list) {
  baselineTasks = list.map((t) => ({
    ...t,
    start: new Date(t.start),
    end: new Date(t.end),
  }));
}

/* ============================================================
   CRITICAL PATH STATE
============================================================ */
export let showCriticalPath = false;

export function toggleCriticalPath() {
  showCriticalPath = !showCriticalPath;
  return showCriticalPath; // Return the new status (true/false)
}
