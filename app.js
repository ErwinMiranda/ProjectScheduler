// app.js — Polished v3 (offline-first + dependencies + template engine)

import {
  fetchUniqueWOList,
  fetchTasksByWOOnce,
  batchSaveTasks,
  saveTemplateToFirestore,
  loadAllTemplates,
} from "./firebase.js";

import { baselineTasks } from "./state.js";
import { render } from "./renderer.js";
import { addDays, daysBetween } from "./utils.js";
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

  const saveBtn = document.createElement("button");
  saveBtn.id = "saveChangesBtn";
  saveBtn.className = "btn";
  saveBtn.textContent = "Save changes";
  saveBtn.disabled = true;

  const discardBtn = document.createElement("button");
  discardBtn.id = "discardChangesBtn";
  discardBtn.className = "btn";
  discardBtn.textContent = "Discard";
  discardBtn.disabled = true;

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

  const cpBtn = document.createElement("button");
  cpBtn.id = "cpToggleBtn";
  cpBtn.className = "btn";
  cpBtn.textContent = "CP";
  cpBtn.onclick = () => {
    import("./state.js").then((m) => {
      m.toggleCriticalPath();
      refresh();
    });
  };

  headerControls.appendChild(cpBtn);
  headerControls.appendChild(saveBtn);
  headerControls.appendChild(discardBtn);
}

/* ============================================================
   UNSAVED FLAG
============================================================ */
function setUnsaved(flag) {
  unsavedChanges = !!flag;
  ensureSaveControls();

  const saveBtn = document.getElementById("saveChangesBtn");
  const discardBtn = document.getElementById("discardChangesBtn");

  if (saveBtn) saveBtn.disabled = !unsavedChanges;
  if (discardBtn) discardBtn.disabled = !unsavedChanges;
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

  try {
    // Always recompute duration
    tasks.forEach((t) => {
      t.duration = daysBetween(t.start, t.end) + 1;
    });

    const res = await batchSaveTasks(tasks);

    if (res.createdMap) {
      Object.entries(res.createdMap).forEach(([idx, newId]) => {
        if (tasks[idx]) tasks[idx].id = newId;
      });
    }

    const list = await fetchTasksByWOOnce(currentWO);
    updateTaskList(list);
    commitBaselineFromFirestore(list);

    applyDependencies();
    refresh();
    refreshDependencyDropdown();
    setUnsaved(false);

    alert("Saved!");
  } catch (err) {
    console.error(err);
    alert("Save failed!");
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
   SAVE TEMPLATE
============================================================ */
document.getElementById("confirmSaveTemplate").onclick = async () => {
  const name = document.getElementById("templateName").value.trim();
  const desc = document.getElementById("templateDesc").value.trim();

  if (!name) return alert("Template name required.");

  // Always compute duration fresh
  const templateTasks = tasks.map((t, index) => {
    const duration = daysBetween(t.start, t.end) + 1;

    return {
      index, // order
      title: t.title,
      duration, // fixed duration
      dependsIndex: tasks.findIndex((x) => x.id === t.depends),
      depType: t.depType || "FS",
      lagDays: t.lagDays || 0,
      leadDays: t.leadDays || 0,
      color: t.color || "",
    };
  });

  try {
    await saveTemplateToFirestore(name, desc, templateTasks);
    alert("Template saved!");
    document.getElementById("saveTemplateModal").hidden = true;
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
  document.getElementById("projectModal").hidden = true;
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

  tpl.tasks.forEach((task, idx) => {
    let start = new Date(projectStart);

    if (task.dependsIndex != null && task.dependsIndex >= 0) {
      const parent = builtTasks[task.dependsIndex];

      if (parent) {
        if (task.depType === "SS") {
          start = addDays(parent.start, task.lagDays - task.leadDays);
        } else {
          start = addDays(parent.end, 1 + task.lagDays - task.leadDays);
        }
      }
    }

    const end = addDays(start, task.duration - 1);
    builtTasks.push({ start, end });

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
  const WO = newWO.value.trim();
  const ACREG = newACREG.value.trim();
  if (!WO || !ACREG) return alert("Please fill WO & AC REG.");

  const template = window.activeTemplate;
  const rows = document.querySelectorAll("#taskRows .task-row");
  const tasksLocal = [];

  /* STEP 1 — Build temporary tasks with local IDs */
  rows.forEach((row, index) => {
    const inputs = row.querySelectorAll("input");

    const title = inputs[0].value;
    const start = new Date(inputs[1].value);
    const end = new Date(inputs[2].value);

    const duration = daysBetween(start, end) + 1;

    const tpl = template?.tasks[index];

    tasksLocal.push({
      id: "local-" + Date.now() + "-" + Math.random(),
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
      row: index,
      color: tpl?.color || "",
    });
  });

  /* STEP 2 — Replace dependsIndex → depends(localID) */
  tasksLocal.forEach((t) => {
    if (t.dependsIndex >= 0) {
      t.depends = tasksLocal[t.dependsIndex].id;
    } else {
      t.depends = "";
    }
    delete t.dependsIndex;
  });

  /* STEP 3 — Save tasks, get Firestore IDs */
  const result = await batchSaveTasks(tasksLocal);

  Object.entries(result.createdMap).forEach(([localIndex, newId]) => {
    tasksLocal[localIndex].fireId = newId;
  });

  /* STEP 4 — Fix dependencies using final Firestore IDs */
  tasksLocal.forEach((t) => {
    t.finalId = t.fireId || t.id;

    if (t.depends) {
      const parentIndex = tasksLocal.findIndex((x) => x.id === t.depends);
      t.depends = tasksLocal[parentIndex].finalId;
    }
  });

  /* STEP 5 — Re-save dependencies */
  await batchSaveTasks(
    tasksLocal.map((t) => ({
      id: t.finalId,
      wo: t.wo,
      acreg: t.acreg,
      title: t.title,
      start: t.start,
      end: t.end,
      duration: t.duration,
      depends: t.depends,
      depType: t.depType,
      lagDays: t.lagDays,
      leadDays: t.leadDays,
      row: t.row,
      color: t.color,
    }))
  );

  /* STEP 6 — Reload UI */
  await loadWOList();
  woFilter.value = WO;
  updateAcRegFromWO(WO);

  await loadFromFirestoreAndCommitBaseline(WO);
  updateTAT();
  document.getElementById("projectModal").hidden = true;
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
   WO SELECT CHANGE — Load Project
============================================================ */
woFilter.addEventListener("change", async (e) => {
  currentWO = e.target.value;

  const sel = e.target.selectedOptions[0];
  document.getElementById("acRegLabel").textContent = sel
    ? sel.dataset.acreg
    : "AC REG";

  localStorage.setItem("selectedWO", currentWO);

  // 🩹 FIX: If no WO selected → CLEAR SCREEN
  if (!currentWO) {
    updateTaskList([]); // no tasks

    // clear gantt
    render(taskLeftList, rowsRight, timelineHeader, depOverlay, new Date());

    // reset dropdown + TAT
    refreshDependencyDropdown();
    document.getElementById("tatDisplay").textContent = "TAT: —";

    setUnsaved(false);
    return;
  }

  // Normal loading
  const list = await fetchTasksByWOOnce(currentWO);
  loadFromFirestoreAndCommitBaseline(currentWO);
  updateTaskList(list);

  applyDependencies();
  refresh();
  updateTAT(); // ensure TAT updates

  refreshDependencyDropdown();
  setUnsaved(false);
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
