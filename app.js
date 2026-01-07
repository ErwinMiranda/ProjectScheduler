// app.js — Polished v3 (offline-first + dependencies + template engine)

import {
  fetchUniqueWOList,
  fetchTasksByWOOnce,
  batchSaveTasks,
  saveTemplateToFirestore,
  loadAllTemplates,
} from "./firebase.js";

import {
  baselineTasks,
  toggleCriticalPath,
  showCriticalPath,
} from "./state.js";
import { render } from "./renderer.js";
import {
  addDays,
  daysBetween,
  showLoading,
  hideLoading,
  organizeTasksByWaterfall,
} from "./utils.js";
import {
  updateTaskList,
  tasks,
  selectedBars,
  pushHistory,
  undoHistory,
  setBaselineTasks,
  commitBaselineFromFirestore,
} from "./state.js";
import { deleteTaskFromFirestore } from "./firebase.js";
/* UI refs */
const woFilter = document.getElementById("woFilter");
const taskLeftList = document.getElementById("taskLeftList");
const rowsRight = document.getElementById("rowsRight");
const timelineHeader = document.getElementById("timelineHeader");
const depOverlay = document.getElementById("depOverlay");
const newDepends = document.getElementById("newDepends");
const headerControls = document.querySelector(".header-controls");
const last = localStorage.getItem("selectedWO");
let currentWO = null;
let unsavedChanges = false;

/* ============================================================
   SAVE / DISCARD CONTROLS
============================================================ */
function ensureSaveControls() {
  if (document.getElementById("saveChangesBtn")) return;

  const headerControls = document.querySelector(".header-controls"); // Ensure this is selected

  const saveBtn = document.createElement("button");
  saveBtn.id = "saveChangesBtn";
  saveBtn.className = "btn";
  saveBtn.textContent = "Save changes";
  saveBtn.disabled = true;
  saveBtn.style.marginLeft = "8px";

  const discardBtn = document.createElement("button");
  discardBtn.id = "discardChangesBtn";
  discardBtn.className = "btn";
  discardBtn.textContent = "Discard";
  discardBtn.disabled = true;
  discardBtn.style.marginLeft = "6px";

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    await saveChanges();
    saveBtn.disabled = false;
    discardBtn.disabled = false;
  };

  discardBtn.onclick = async () => {
    if (!confirm("Discard local changes?")) return;
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    await discardChanges();
    saveBtn.disabled = false;
    discardBtn.disabled = false;
  };

  // Append ONLY Save/Discard buttons here
  headerControls.appendChild(saveBtn);
  headerControls.appendChild(discardBtn);
}

/* ============================================================
   CRITICAL PATH BUTTON (Standalone)
============================================================ */
// Make sure these are imported at the top of your file:
// import { toggleCriticalPath, showCriticalPath } from "./state.js";

function ensureCPButton() {
  if (document.getElementById("cpToggleBtn")) return;

  const headerControls = document.querySelector(".header-controls");

  const cpBtn = document.createElement("button");
  cpBtn.id = "cpToggleBtn";
  cpBtn.className = "btn";
  cpBtn.textContent = "CP";
  cpBtn.style.marginLeft = "8px";

  // 1. Define Visual Logic
  const updateButtonStyle = (isActive) => {
    if (isActive) {
      cpBtn.style.backgroundColor = "#dc2626";
      cpBtn.style.color = "#ffffff";
      cpBtn.style.borderColor = "#b91c1c";
    } else {
      cpBtn.style.backgroundColor = "";
      cpBtn.style.color = "";
      cpBtn.style.borderColor = "";
    }
  };

  // 2. Initial State
  updateButtonStyle(showCriticalPath);

  // 3. Click Handler
  cpBtn.onclick = () => {
    const newState = toggleCriticalPath();
    updateButtonStyle(newState);
    refresh();
  };

  // 4. Append CP Button here
  headerControls.appendChild(cpBtn);
}

/* ============================================================
   UNSAVED FLAG HANDLER
============================================================ */
function setUnsaved(flag) {
  unsavedChanges = !!flag;
  ensureSaveControls();

  const saveBtn = document.getElementById("saveChangesBtn");
  const discardBtn = document.getElementById("discardChangesBtn");

  if (saveBtn) saveBtn.disabled = !unsavedChanges;
  if (discardBtn) discardBtn.disabled = !unsavedChanges;

  const mark = document.getElementById("unsavedMark");
  if (mark) {
    mark.hidden = !unsavedChanges;
  }
}

/* ============================================================
   LOAD WORK ORDERS
============================================================ */
export async function loadWOList() {
  try {
    const prev = localStorage.getItem("selectedWO");
    const unique = await fetchUniqueWOList();

    woFilter.innerHTML = `<option value="">Select Work Order</option>`;

    unique.forEach(({ wo, acreg }) => {
      woFilter.innerHTML += `<option value="${wo}" data-acreg="${acreg}">
        ${wo} — ${acreg}
      </option>`;
    });

    if (prev) woFilter.value = prev;
  } catch (err) {
    console.error("Failed to load WO list:", err);
  }
}

function updateAcRegFromWO(wo) {
  const opt = [...woFilter.options].find((o) => o.value === wo);
  document.getElementById("acRegLabel").textContent =
    opt?.dataset.acreg || "AC REG";
}

/* ============================================================
   DEPENDENCY ENGINE (FS + SS + lag + lead)
============================================================ */
export function applyDependencies() {
  const map = Object.fromEntries(tasks.map((t) => [t.id, t]));

  let changed = true;
  let safety = 0;

  while (changed && safety++ < 50) {
    changed = false;

    tasks.forEach((child) => {
      if (!child.depends) return;

      const parent = map[child.depends];
      if (!parent) return;

      const lag = child.lagDays || 0;
      const lead = child.leadDays || 0;

      let minStart;

      if (child.depType === "SS") {
        minStart = addDays(parent.start, lag - lead);
      } else {
        minStart = addDays(parent.end, 1 + lag - lead);
      }

      if (child.start < minStart) {
        const dur = daysBetween(child.start, child.end) + 1;
        child.start = minStart;
        child.end = addDays(child.start, dur - 1);
        changed = true;
      }
    });
  }
}

/* ============================================================
   CASCADING SHIFT
============================================================ */
export function shiftChildren(parentId, deltaDays, opts = {}) {
  const force = opts.force === true;

  const rec = (pid) => {
    tasks.forEach((child) => {
      if (child.depends !== pid) return;

      let moved = false;

      if (force || child.depType !== "SS") {
        child.start = addDays(child.start, deltaDays);
        child.end = addDays(child.end, deltaDays);
        moved = true;
      }

      if (moved) rec(child.id);
    });
  };

  rec(parentId);
}

/* ============================================================
   DROPDOWN REFRESH
============================================================ */
export function refreshDependencyDropdown() {
  newDepends.innerHTML = `<option value="">No dependency</option>`;
  tasks.forEach((t) => {
    newDepends.innerHTML += `<option value="${t.id}">${t.title}</option>`;
  });
}

/* ============================================================
   RENDER WRAPPER
============================================================ */
function computeMinDate() {
  if (!tasks.length) return addDays(new Date(), -3);
  let min = tasks[0].start;
  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
  });
  return addDays(min, -3);
}

export function refresh() {
  render(taskLeftList, rowsRight, timelineHeader, depOverlay, computeMinDate());

  updateTAT();
}

/* ============================================================
   WO CHANGE
============================================================ */
woFilter.onchange = async (e) => {
  currentWO = e.target.value;
  updateAcRegFromWO(currentWO);
  localStorage.setItem("selectedWO", currentWO);

  if (!currentWO) return;

  const list = await fetchTasksByWOOnce(currentWO);
  updateTaskList(list);
  commitBaselineFromFirestore(list);

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);
};

/* ============================================================
   UNDO
============================================================ */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (undoHistory()) {
      refresh();
      refreshDependencyDropdown();
      setUnsaved(true);
    }
  }
});

/* ============================================================
   ESC — Clear selection
============================================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectedBars.clear();
    render();
  }
});

/* ============================================================
   ADD TASK (LOCAL)
============================================================ */
document.getElementById("addTaskBtn").onclick = () => {
  const wo = woFilter.value;
  if (!wo) return alert("Select WO first");

  const acreg = woFilter.selectedOptions[0].dataset.acreg;
  const title = document.getElementById("newTitle").value.trim();
  const s = document.getElementById("newStart").value;
  const e = document.getElementById("newEnd").value;
  const dep = newDepends.value || "";
  if (!title || !s || !e) return;

  const start = new Date(s);
  const end = new Date(e);
  const duration = daysBetween(start, end) + 1;

  const t = {
    id: "local-" + Date.now(),
    wo,
    acreg,
    title,
    start,
    end,
    duration,
    depends: dep,
    depType: "FS",
    lagDays: 0,
    leadDays: 0,
    row: tasks.length,
    taskno: Date.now(),
  };

  pushHistory();
  tasks.push(t);

  setUnsaved(true);
  applyDependencies();
  refresh();
  refreshDependencyDropdown();

  document.getElementById("newTitle").value = "";
};

/* ============================================================
   MULTI-DEPENDENCY
============================================================ */
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "d") {
    e.preventDefault();

    const ids = [...selectedBars];
    if (ids.length < 2) return alert("Select 2+ bars");

    const parent = ids[0];
    pushHistory();

    ids.slice(1).forEach((id) => {
      const child = tasks.find((t) => t.id === id);
      if (child) {
        child.depends = parent;
        child.depType = "FS";
      }
    });

    selectedBars.clear();
    applyDependencies();
    refresh();
    setUnsaved(true);
  }
});

/* ============================================================
   SAVE CHANGES
============================================================ */
async function saveChanges() {
  if (!currentWO) return alert("No WO selected.");

  const saveBtn = document.getElementById("saveChangesBtn");
  const discardBtn = document.getElementById("discardChangesBtn");

  discardBtn.disabled = true;
  showLoading("Saving & Organizing...");
  try {
    // 1. RE-SORT LOCAL TASKS BEFORE SAVING
    // This ensures that if you added tasks locally, they get snapped into the waterfall structure
    const sortedTasks = organizeTasksByWaterfall(tasks);

    // Update the local state with the sorted version
    updateTaskList(sortedTasks);

    // 2. Save the SORTED list
    const res = await batchSaveTasks(sortedTasks);

    if (res.createdMap) {
      Object.entries(res.createdMap).forEach(([idx, newId]) => {
        // Because we sorted 'tasks' and passed 'sortedTasks' to save,
        // the indices match perfectly.
        if (tasks[idx]) tasks[idx].id = newId;
      });
    }

    // 3. Reload to verify
    // (Optional: You can just continue with current data, but fetching ensures sync)
    // let list = await fetchTasksByWOOnce(currentWO);
    // list = organizeTasksByWaterfall(list);
    // updateTaskList(list);

    applyDependencies();
    refresh();
    refreshDependencyDropdown();
    setUnsaved(false);
    hideLoading();

    //alert("Saved & Re-organized!");
  } catch (err) {
    console.error("Save failed", err);
    hideLoading();
    alert("Save error — see console");
  }
}

/* ============================================================
   DISCARD CHANGES
============================================================ */
async function discardChanges() {
  if (!currentWO) return;

  const list = await fetchTasksByWOOnce(currentWO);
  updateTaskList(list);
  commitBaselineFromFirestore(list);

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);
}

/* ============================================================
   INITIAL SETUP
============================================================ */
document.getElementById("newStart").value = new Date()
  .toISOString()
  .slice(0, 10);
document.getElementById("newEnd").value = addDays(new Date(), 2)
  .toISOString()
  .slice(0, 10);

ensureSaveControls();
await loadWOList();

if (last) {
  woFilter.value = last;
  currentWO = last;
  updateAcRegFromWO(last);

  const list = await fetchTasksByWOOnce(last);
  updateTaskList(list);
  commitBaselineFromFirestore(list);
  applyDependencies();
  refresh();
} else {
  refresh();
}
/* ============================================================
   SAVE TEMPLATE MODAL OPEN/CLOSE
============================================================ */
document.getElementById("saveTemplateBtn").onclick = () => {
  document.getElementById("templateName").value = "";
  document.getElementById("templateDesc").value = "";
  document.getElementById("saveTemplateModal").hidden = false;
};

document.getElementById("cancelTemplateBtn").onclick = () => {
  document.getElementById("saveTemplateModal").hidden = true;
};

/* ============================================================
   SAVE TEMPLATE (With Start Offset Fix)
============================================================ */
document.getElementById("confirmSaveTemplate").onclick = async () => {
  const name = document.getElementById("templateName").value.trim();
  const desc = document.getElementById("templateDesc").value.trim();

  if (!name) return alert("Template name required.");

  // 1. Sort to ensure correct visual order
  const sortedTasks = [...tasks].sort((a, b) => (a.row || 0) - (b.row || 0));

  if (!sortedTasks.length) return alert("No tasks to save!");

  // 2. Find the "Anchor Date" (The earliest start date in the entire plan)
  let anchorDate = sortedTasks[0].start;
  sortedTasks.forEach((t) => {
    if (t.start < anchorDate) anchorDate = t.start;
  });

  // 3. Map tasks and calculate 'startOffset'
  const templateTasks = sortedTasks.map((t, index) => {
    const duration = daysBetween(t.start, t.end) + 1;

    // Calculate how many days this task starts after the anchor date
    const startOffset = daysBetween(anchorDate, t.start);

    // Find dependency index relative to sorted list
    const depIdx = sortedTasks.findIndex((x) => x.id === t.depends);

    return {
      index,
      title: t.title,
      duration,
      dependsIndex: depIdx,
      depType: t.depType || "FS",
      lagDays: t.lagDays || 0,
      leadDays: t.leadDays || 0,
      color: t.color || "",
      startOffset: startOffset, // <--- THIS SAVES THE RELATIVE POSITION
    };
  });

  try {
    // showLoading("Saving...");
    await saveTemplateToFirestore(name, desc, templateTasks);
    document.getElementById("saveTemplateModal").hidden = true;
    alert("Template saved successfully!");
  } catch (err) {
    console.error(err);
    alert("Failed to save template.");
  }
};

/* ============================================================
   NEW PROJECT — OPEN CREATE PROJECT MODAL
============================================================ */
document.getElementById("newProjectBtn").onclick = async () => {
  const modal = document.getElementById("projectModal");
  const container = document.getElementById("taskRows");

  container.innerHTML = "";
  addTaskRow();

  // Load templates
  const select = document.getElementById("loadTemplateSelect");
  select.innerHTML = `<option value="">None</option>`;

  const templates = await loadAllTemplates();
  templates.forEach((t) => {
    select.innerHTML += `<option value="${t.id}">${t.name}</option>`;
  });

  modal.hidden = false;
};

document.getElementById("cancelProjectBtn").onclick = () => {
  // 1. Forget the previously selected Work Order
  localStorage.removeItem("selectedWO");

  // 2. Hide the modal (visual feedback)
  document.getElementById("projectModal").hidden = true;

  // 3. Reload the page
  // Since 'selectedWO' is gone, the dropdown will start empty.
  window.location.reload();
};

/* Utility to add a blank row */
function addTaskRow() {
  const container = document.getElementById("taskRows");

  const row = document.createElement("div");
  row.className = "task-row";

  row.innerHTML = `
    <input type="text" placeholder="Task name">
    <input type="date">
    <input type="date">
    <button class="delete-row">✕</button>
  `;

  row.querySelector(".delete-row").onclick = () => row.remove();
  container.appendChild(row);
}

document.getElementById("addTaskRowBtn").onclick = addTaskRow;

/* ============================================================
   TEMPLATE SELECTED → SHOW DATE PICKER
============================================================ */
document.getElementById("loadTemplateSelect").onchange = async () => {
  const id = loadTemplateSelect.value;

  if (!id) {
    taskRows.innerHTML = "";
    addTaskRow();
    return;
  }

  document.getElementById("templateStartDateModal").hidden = false;

  // Load template for use after choosing start date
  const templates = await loadAllTemplates();
  window.activeTemplate = templates.find((t) => t.id === id);
};

/* ============================================================
   TEMPLATE START DATE CONFIRM
   → Build TaskRows using dependency rules
============================================================ */
document.getElementById("confirmStartDateBtn").onclick = () => {
  const modal = document.getElementById("templateStartDateModal");
  const container = document.getElementById("taskRows");

  const startInput = document.getElementById("templateStartDate").value;
  if (!startInput) return alert("Select a start date.");

  const projectStart = new Date(startInput);
  modal.hidden = true;
  container.innerHTML = "";

  const tpl = window.activeTemplate;
  const builtTasks = []; // store { start, end } for dependency resolution

  // Helper to add days (ensure this function is available in scope or import it)
  // function addDays(d, n) { ... }

  tpl.tasks.forEach((task, idx) => {
    // ---------------------------------------------------------
    // 1. BASE START: Apply Offset if available, otherwise Project Start
    // ---------------------------------------------------------
    let start;
    if (typeof task.startOffset === "number") {
      start = addDays(projectStart, task.startOffset);
    } else {
      start = new Date(projectStart);
    }

    // ---------------------------------------------------------
    // 2. DEPENDENCY OVERRIDE: If linked, parent dictates start
    // ---------------------------------------------------------
    if (task.dependsIndex != null && task.dependsIndex >= 0) {
      const parent = builtTasks[task.dependsIndex];

      if (parent) {
        if (task.depType === "SS") {
          start = addDays(parent.start, task.lagDays - task.leadDays);
        } else {
          // Default FS (Finish-to-Start)
          start = addDays(parent.end, 1 + task.lagDays - task.leadDays);
        }
      }
    }

    // Calculate End based on duration
    const end = addDays(start, task.duration - 1);

    // Save for future children to reference
    builtTasks.push({ start, end });

    // ---------------------------------------------------------
    // 3. RENDER ROW
    // ---------------------------------------------------------
    const row = document.createElement("div");
    row.className = "task-row";
    row.dataset.start = start.toISOString();
    row.dataset.end = end.toISOString();

    row.innerHTML = `
      <input type="text" value="${task.title}">
      <input type="date" value="${start.toISOString().slice(0, 10)}">
      <input type="date" value="${end.toISOString().slice(0, 10)}">
      <button class="delete-row">✕</button>
    `;

    row.querySelector(".delete-row").onclick = () => row.remove();
    container.appendChild(row);
  });
};

/* Cancel date modal */
document.getElementById("cancelStartDateBtn").onclick = () => {
  document.getElementById("templateStartDateModal").hidden = true;
};

/* ============================================================
   CREATE PROJECT FROM TEMPLATE
============================================================ */
document.getElementById("createProjectBtn").onclick = async () => {
  const newWO = document.getElementById("newWO");
  const newACREG = document.getElementById("newACREG");

  const WO = newWO.value.trim();
  const ACREG = newACREG.value.trim();
  if (!WO || !ACREG) return alert("Please fill WO & AC REG.");

  const rows = document.querySelectorAll("#taskRows .task-row");
  if (rows.length === 0)
    return alert("No tasks to save! Load a template first.");

  showLoading("Structuring Waterfall Schedule...");

  try {
    const tasksLocal = [];

    /* -----------------------------------------------------------
       1. READ DATA FROM PREVIEW ROWS
    ----------------------------------------------------------- */
    rows.forEach((row, index) => {
      const inputs = row.querySelectorAll("input");
      const title = inputs[0].value;
      const startVal = inputs[1].value;
      const endVal = inputs[2].value;

      const start = new Date(startVal);
      const end = new Date(endVal);
      const duration = daysBetween(start, end) + 1;

      const template = window.activeTemplate;
      const tpl = template ? template.tasks[index] : {};
      const tempId = "local-" + Date.now() + "-" + index;

      tasksLocal.push({
        id: tempId,
        tempId: tempId,
        wo: WO,
        acreg: ACREG,
        title,
        start,
        end,
        duration,
        dependsIndex: tpl?.dependsIndex ?? -1,
        depType: tpl?.depType || "FS",
        lagDays: tpl?.lagDays || 0,
        leadDays: tpl?.leadDays || 0,
        row: 0,
        color: tpl?.color || "",
        // We use this to map local dependencies before we have full graph
        localDepId:
          tpl?.dependsIndex >= 0 && tasksLocal[tpl.dependsIndex]
            ? tasksLocal[tpl.dependsIndex].tempId
            : "",
      });
    });

    // Fix local dependency strings immediately for the sort graph
    tasksLocal.forEach((t) => {
      t.depends = t.localDepId; // Assign tempId to depends
    });

    /* -----------------------------------------------------------
       2. WATERFALL CHAIN SORT (DFS Topological)
       This Groups: Parent -> Child -> Grandchild
    ----------------------------------------------------------- */
    const existingTasks = await import("./firebase.js").then((m) =>
      m.fetchTasksByWOOnce(WO)
    );

    // Combine ALL tasks (Existing + New)
    const allTasks = [...existingTasks, ...tasksLocal];

    // A. Build Helper Maps
    const taskMap = new Map();
    const childrenMap = new Map();
    const roots = [];

    allTasks.forEach((t) => {
      taskMap.set(t.id, t);
      if (!childrenMap.has(t.id)) childrenMap.set(t.id, []);
    });

    // B. Identify Roots and Children
    allTasks.forEach((t) => {
      // Check if task has a dependency that actually exists in this list
      if (t.depends && taskMap.has(t.depends)) {
        // It is a child
        childrenMap.get(t.depends).push(t);
      } else {
        // It is a root (No parent, or parent is not in this project list)
        roots.push(t);
      }
    });

    // C. Sort Roots by Date (The main timeline backbone)
    roots.sort((a, b) => a.start - b.start);

    // D. Recursive Traversal (DFS) to build final order
    const finalSortedTasks = [];
    const visitedIds = new Set();

    function traverse(task) {
      if (visitedIds.has(task.id)) return;
      visitedIds.add(task.id);
      finalSortedTasks.push(task);

      // Find children
      const kids = childrenMap.get(task.id) || [];

      // Sort children by Date (Waterfall effect within the chain)
      kids.sort((a, b) => a.start - b.start);

      // Visit children immediately (Keep them grouped with parent)
      kids.forEach((kid) => traverse(kid));
    }

    // Execute Traversal starting from Roots
    roots.forEach((root) => traverse(root));

    // E. Apply the new Row Order
    const existingTasksToUpdate = [];

    finalSortedTasks.forEach((t, index) => {
      const oldRow = t.row;
      t.row = index; // Apply 0, 1, 2... based on Chain Sort

      // If existing task moved, mark for update
      if (!String(t.id).startsWith("local-") && oldRow !== index) {
        existingTasksToUpdate.push(t);
      }
    });

    /* -----------------------------------------------------------
       3. SAVE EXECUTION
    ----------------------------------------------------------- */
    // A. Save NEW Tasks
    const result = await import("./firebase.js").then((m) =>
      m.batchSaveTasks(tasksLocal)
    );

    Object.entries(result.createdMap).forEach(([indexStr, newId]) => {
      tasksLocal[indexStr].finalId = newId;
    });

    // B. Update EXISTING tasks (Row re-ordering)
    if (existingTasksToUpdate.length > 0) {
      await import("./firebase.js").then((m) =>
        m.batchSaveTasks(existingTasksToUpdate)
      );
    }

    /* -----------------------------------------------------------
       4. FIX DEPENDENCIES (TempID -> RealID)
    ----------------------------------------------------------- */
    const updates = [];
    tasksLocal.forEach((t) => {
      t.id = t.finalId;
      if (t.depends && t.depends.startsWith("local-")) {
        const parent = tasksLocal.find((p) => p.tempId === t.depends);
        if (parent && parent.finalId) {
          t.depends = parent.finalId;
        } else {
          t.depends = "";
        }
        updates.push(t);
      }
    });

    if (updates.length > 0) {
      await import("./firebase.js").then((m) => m.batchSaveTasks(updates));
    }

    /* -----------------------------------------------------------
       5. RELOAD UI
    ----------------------------------------------------------- */
    await import("./app.js").then((m) => m.loadWOList());
    const woFilter = document.getElementById("woFilter");
    woFilter.value = WO;
    woFilter.dispatchEvent(new Event("change"));

    hideLoading();
    alert("Project structured with Waterfall Dependencies!");
    document.getElementById("projectModal").hidden = true;
  } catch (err) {
    console.error(err);
    hideLoading();
    alert("Error: " + err.message);
  }
};
/* ============================================================
   TAT (Turn-Around Time) Computation
============================================================ */
function computeTAT(list) {
  if (!list.length) return null;

  let min = list[0].start;
  let max = list[0].end;

  list.forEach((t) => {
    if (t.start < min) min = t.start;
    if (t.end > max) max = t.end;
  });

  return daysBetween(min, max) + 1;
}

function updateTAT() {
  const el = document.getElementById("tatDisplay");
  if (!el) return;

  const current = computeTAT(tasks);
  const baseline = computeTAT(baselineTasks);

  if (!current) {
    el.textContent = "TAT: —";
    return;
  }

  if (!baseline || baseline === current) {
    el.textContent = `TAT: ${current} Days`;
    return;
  }

  const delta = current - baseline;
  const sign = delta > 0 ? "+" : "";
  el.textContent = `Baseline: ${baseline} → Current: ${current} (${sign}${delta})`;
}

/* ============================================================
   LOCAL CHANGE LISTENER (drag/edit triggers this)
============================================================ */
window.addEventListener("localchange", () => {
  setUnsaved(true);
  updateTAT();
});

/* ============================================================
   Firestore Loader + Baseline Commit
============================================================ */
async function loadWOData(wo) {
  if (!wo) {
    updateTaskList([]);
    refresh();
    setUnsaved(false);
    return;
  }

  const list = await fetchTasksByWOOnce(wo);
  updateTaskList(list);

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);

  return list;
}

async function loadFromFirestoreAndCommitBaseline(wo) {
  const list = await fetchTasksByWOOnce(wo);

  updateTaskList(list);
  commitBaselineFromFirestore(list);

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);
}

/* ============================================================
   WO CHANGE (OFFLINE LOAD)
============================================================ */
woFilter.addEventListener("change", async (e) => {
  currentWO = e.target.value;

  const sel = e.target.selectedOptions[0];
  document.getElementById("acRegLabel").textContent = sel
    ? sel.dataset.acreg
    : "AC REG";

  localStorage.setItem("selectedWO", currentWO);

  if (!currentWO) {
    updateTaskList([]);
    refresh();
    setUnsaved(false);
    return;
  }

  // Optional: Show loading here if you like
  showLoading("Loading Project...");

  try {
    // 1. Fetch raw list
    let list = await fetchTasksByWOOnce(currentWO);

    // 2. FORCE WATERFALL SORT
    list = organizeTasksByWaterfall(list);

    // 3. Update State & Render
    updateTaskList(list);
    applyDependencies();
    refresh();
    refreshDependencyDropdown();
    setUnsaved(false);
  } catch (err) {
    console.error(err);
    alert("Error loading project");
  } finally {
    hideLoading();
  }
});

/* ============================================================
   Undo Handler
============================================================ */
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "z") {
    e.preventDefault();

    if (!undoHistory()) return;

    refresh();
    refreshDependencyDropdown();
    setUnsaved(true);
  }
});

/* ============================================================
   ESC clears selection
============================================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectedBars.clear();
    render();
  }
});

/* ============================================================
   Setup initial start/end for Add-Task panel
============================================================ */
document.getElementById("newStart").value = new Date()
  .toISOString()
  .slice(0, 10);

document.getElementById("newEnd").value = addDays(new Date(), 2)
  .toISOString()
  .slice(0, 10);

/* ============================================================
   INITIAL STARTUP
============================================================ */
ensureSaveControls();
await loadWOList();

if (last) {
  woFilter.value = last;
  currentWO = last;

  updateAcRegFromWO(last);
  await loadFromFirestoreAndCommitBaseline(last);
} else {
  refresh();
}

/* ============================================================
   DELETE TASK IN LEFT PANEL
============================================================ */

export async function deleteTask(taskId) {
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;

  // 🔥 DELETE FROM FIRESTORE FIRST
  await deleteTaskFromFirestore(taskId);

  // Remove locally
  tasks.splice(idx, 1);

  // Clear dependencies
  tasks.forEach((t) => {
    if (t.depends === taskId) {
      t.depends = "";
      t.lagDays = 0;
      t.leadDays = 0;
    }
  });

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);
}

export function insertTaskBelow(baseTask) {
  pushHistory(); // Save undo state

  const idx = tasks.findIndex((t) => t.id === baseTask.id);
  if (idx === -1) return;

  const next = tasks[idx + 1];
  const rowAbove = baseTask.row || 0;
  const rowBelow = next ? next.row : rowAbove + 1000;
  const newRow = (rowAbove + rowBelow) / 2;

  const start = new Date(baseTask.end);
  const end = new Date(start);

  const newTask = {
    id: "local-" + crypto.randomUUID(), // local temporary ID
    wo: baseTask.wo,
    acreg: baseTask.acreg,
    title: "New Task",
    start,
    end,
    duration: 1,
    depends: "",
    depType: "FS",
    lagDays: 0,
    leadDays: 0,
    row: newRow,
    taskno: Date.now(),
  };

  // Insert locally
  tasks.splice(idx + 1, 0, newTask);

  // Re-render immediately
  render();

  // Save to Firestore
  batchSaveTasks([newTask]).then((result) => {
    if (result.createdMap[0]) {
      // Replace local ID with Firestore-generated ID
      newTask.id = result.createdMap[0];
      render(); // optional: re-render so tooltips, dependencies use correct ID
    }
  });
}
/* ============================================================
   INITIAL SETUP
============================================================ */
// ... (your date setup code) ...

ensureSaveControls(); // 1. Creates Save & Discard
ensureCPButton(); // 2. Creates CP Button

await loadWOList();
// ...
