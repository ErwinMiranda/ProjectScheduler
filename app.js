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
  ensurePrintButton,
  refreshModalDropdowns,
  attachSkillPicker,
  sortTasksByDate,
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
  let changed = true;
  let loops = 0;

  // Propagate changes (limit loops to prevent infinite cycles)
  while (changed && loops < 100) {
    changed = false;
    loops++;

    tasks.forEach((t) => {
      // Skip if no dependency
      if (!t.depends) return;

      const parent = tasks.find((p) => p.id === t.depends);
      if (!parent) return;

      // 1. Get Dependency Configuration
      const lag = Number(t.lagDays) || 0;
      const lead = Number(t.leadDays) || 0;
      const net = lag - lead;
      const type = t.depType || "FS"; // Default to Finish-to-Start

      // 2. Calculate the STRICT Target Date
      let targetStart;

      if (type === "SS") {
        // Start-to-Start: Parent Start + Net Offset
        targetStart = addDays(parent.start, net);
      } else {
        // Finish-to-Start (FS): Parent End + 1 Day + Net Offset
        targetStart = addDays(parent.end, 1 + net);
      }

      // 3. Apply Constraints
      const currentStartMs = t.start.getTime();
      const targetStartMs = targetStart.getTime();
      const duration = daysBetween(t.start, t.end);

      if (type === "FS") {
        /* ------------------------------------------------------
           [STRICT MODE] FOR FS
           User Request: "Cannot set it before and after"
           Behavior: The task is LOCKED to the target date.
           Moving it requires changing the Lag/Lead value.
        ------------------------------------------------------ */
        if (currentStartMs !== targetStartMs) {
          t.start = targetStart;
          t.end = addDays(targetStart, duration);
          changed = true;
        }
      } else {
        /* ------------------------------------------------------
           [HYBRID MODE] FOR SS (Start-to-Start)
           If Lag/Lead exists: Strict (Locked).
           If 0 Lag: Flexible (Can be later, but not earlier).
        ------------------------------------------------------ */
        if (lag !== 0 || lead !== 0) {
          // Strict if offset exists
          if (currentStartMs !== targetStartMs) {
            t.start = targetStart;
            t.end = addDays(targetStart, duration);
            changed = true;
          }
        } else {
          // Flexible "Floor" if no offset (Standard behavior)
          if (currentStartMs < targetStartMs) {
            t.start = targetStart;
            t.end = addDays(targetStart, duration);
            changed = true;
          }
        }
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
  sortTasksByDate();
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

  setUnsaved(false);
}

/* ============================================================
   INITIAL SETUP
============================================================ */

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

/* In app.js */
function addTaskRow() {
  const container = document.getElementById("taskRows");
  const row = document.createElement("div");
  row.className = "task-row";

  // ✅ FIXED: Specific widths to prevent expansion
  row.style.gridTemplateColumns = "1fr 60px 50px 100px 80px 30px";

  row.innerHTML = `
    <input type="text" placeholder="Task name" class="t-title">
    <input type="number" min="1" value="1" class="t-start-day" placeholder="Day">
    <input type="number" min="1" value="1" class="t-dur" placeholder="Dur">
    
    <select class="t-dep"></select>
    
    <div style="position: relative;">
        <input type="text" class="t-skill" placeholder="Skill" style="width: 100%;">
    </div>
           
    <button class="delete-row">✕</button>
  `;

  // ... (Keep existing listeners) ...
  const titleInput = row.querySelector(".t-title");
  titleInput.addEventListener("input", refreshModalDropdowns);
  const skillInput = row.querySelector(".t-skill");
  attachSkillPicker(skillInput);

  row.querySelector(".delete-row").onclick = () => {
    row.remove();
    refreshModalDropdowns();
  };

  container.appendChild(row);
  refreshModalDropdowns();
}

document.getElementById("addTaskRowBtn").onclick = addTaskRow;

/* ============================================================
   TEMPLATE LOADER (Fixed: Grid Layout + Skill Picker)
============================================================ */

document.getElementById("loadTemplateSelect").onchange = async () => {
  const select = document.getElementById("loadTemplateSelect");
  const id = select.value;
  const container = document.getElementById("taskRows");

  container.innerHTML = ""; // Clear existing rows

  if (!id) {
    // If "None" selected, add one blank row
    // Ensure addTaskRow is available (it is defined in app.js scope)
    if (typeof addTaskRow === "function") addTaskRow();
    return;
  }

  showLoading("Loading Template...");

  try {
    const { loadAllTemplates } = await import("./firebase.js");
    const templates = await loadAllTemplates();
    const tpl = templates.find((t) => t.id === id);

    if (!tpl || !tpl.tasks) {
      hideLoading();
      return;
    }

    // A. Create All DOM Elements
    tpl.tasks.forEach((task) => {
      const row = document.createElement("div");
      row.className = "task-row";

      // 1. MATCH THE HEADER GRID (Fixed Widths)
      row.style.gridTemplateColumns = "1fr 60px 50px 100px 80px 30px";

      const startDay =
        (typeof task.startOffset === "number" ? task.startOffset : 0) + 1;
      const duration = task.duration || 1;
      const skill = task.skill || "";

      // 2. HTML STRUCTURE
      row.innerHTML = `
        <input type="text" class="t-title" value="${task.title}">
        <input type="number" class="t-start-day" min="1" value="${startDay}">
        <input type="number" class="t-dur" min="1" value="${duration}">
        
        <select class="t-dep"></select>
        
        <div style="position: relative;">
            <input type="text" class="t-skill" value="${skill}" placeholder="Select..." style="width: 100%;">
        </div>
        
        <button class="delete-row">✕</button>
      `;

      // 3. STORE HIDDEN METADATA
      // We store the target dependency INDEX (0, 1, 2) temporarily
      if (task.dependsIndex !== undefined && task.dependsIndex >= 0) {
        row.dataset.targetIndex = task.dependsIndex;
      }

      row.dataset.depType = task.depType || "FS";
      row.dataset.lag = task.lagDays || 0;
      row.dataset.lead = task.leadDays || 0;
      row.dataset.color = task.color || "";

      // 4. ATTACH LISTENERS
      // A. Live update for dependency dropdowns when title changes
      row
        .querySelector(".t-title")
        .addEventListener("input", refreshModalDropdowns);

      // B. Delete row logic
      row.querySelector(".delete-row").onclick = () => {
        row.remove();
        refreshModalDropdowns();
      };

      // C. IMPORTANT: Attach the Skill Picker to this specific row
      const skillInput = row.querySelector(".t-skill");
      attachSkillPicker(skillInput);

      container.appendChild(row);
    });

    // B. Refresh All Dropdowns (Populate <options> based on titles)
    refreshModalDropdowns();

    // C. Set Selected Dependencies (Now that options exist)
    const rows = document.querySelectorAll("#taskRows .task-row");
    rows.forEach((row) => {
      if (row.dataset.targetIndex) {
        const select = row.querySelector(".t-dep");
        select.value = row.dataset.targetIndex;
      }
    });
  } catch (err) {
    console.error(err);
    alert("Error loading template");
  } finally {
    hideLoading();
  }
};
/* ============================================================
   TEMPLATE START DATE CONFIRM
   → Build TaskRows using dependency rules
============================================================ */
document.getElementById("confirmStartDateBtn").onclick = () => {
  const modal = document.getElementById("templateStartDateModal");
  const container = document.getElementById("taskRows");
  const projectStartInput = document.getElementById("newProjectStart"); // The new anchor field
  const popupDateVal = document.getElementById("templateStartDate").value;

  if (!popupDateVal) return alert("Select a start date.");

  // 1. Set the main Project Start Date anchor
  projectStartInput.value = popupDateVal;

  modal.hidden = true;
  container.innerHTML = "";

  const tpl = window.activeTemplate;
  if (!tpl || !tpl.tasks) return;

  // 2. Load Tasks with Relative Numbers
  tpl.tasks.forEach((task) => {
    const row = document.createElement("div");
    row.className = "task-row";
    row.style.gridTemplateColumns = "2fr 0.8fr 0.8fr 32px";

    // Logic:
    // If template has 'startOffset' (e.g., 0 for Day 1), we display Offset + 1.
    // If no offset, default to Day 1.
    const startDay =
      (typeof task.startOffset === "number" ? task.startOffset : 0) + 1;
    const duration = task.duration || 1;

    row.innerHTML = `
      <input type="text" class="t-title" value="${task.title}">
      <input type="number" class="t-start-day" min="1" value="${startDay}">
      <input type="number" class="t-dur" min="1" value="${duration}">
      <button class="delete-row">✕</button>
    `;

    // Store hidden dependency data on the row element itself
    row.dataset.depIndex = task.dependsIndex ?? -1;
    row.dataset.depType = task.depType || "FS";
    row.dataset.lag = task.lagDays || 0;
    row.dataset.lead = task.leadDays || 0;
    row.dataset.color = task.color || "";

    row.querySelector(".delete-row").onclick = () => row.remove();
    container.appendChild(row);
  });
};

/* Cancel date modal */
document.getElementById("cancelStartDateBtn").onclick = () => {
  document.getElementById("templateStartDateModal").hidden = true;
};
/* ============================================================
   CREATE PROJECT (Final Fix: Variable Name & Dropdown Logic)
============================================================ */

document.getElementById("createProjectBtn").onclick = async () => {
  const newWO = document.getElementById("newWO");
  const newACREG = document.getElementById("newACREG");
  const projectStartInput = document.getElementById("newProjectStart");

  const WO = newWO.value.trim();
  const ACREG = newACREG.value.trim();
  const anchorDateVal = projectStartInput.value;

  if (!WO || !ACREG) return alert("Please fill WO & AC REG.");
  if (!anchorDateVal) return alert("Please select a Project Start Date.");

  const rows = document.querySelectorAll("#taskRows .task-row");
  if (rows.length === 0) return alert("No tasks to save!");

  const anchorDate = new Date(anchorDateVal + "T00:00:00");

  showLoading("Structuring Schedule...");

  try {
    const tasksLocal = [];

    /* -----------------------------------------------------------
       1. READ INPUTS
    ----------------------------------------------------------- */
    rows.forEach((row, index) => {
      const title = row.querySelector(".t-title").value.trim() || "Untitled";
      const startDay = parseInt(row.querySelector(".t-start-day").value) || 1;
      const duration = parseInt(row.querySelector(".t-dur").value) || 1;

      // READ DROPDOWN: Value is the Target Index (0, 1, 2...)
      const select = row.querySelector(".t-dep");
      let depIndex = -1;
      if (select.value !== "") {
        depIndex = parseInt(select.value);
      }

      // Calculation
      const start = addDays(anchorDate, startDay - 1);
      const end = addDays(start, duration - 1);
      const tempId = "local-" + Date.now() + "-" + index;
      const skill = row.querySelector(".t-skill").value.trim();
      tasksLocal.push({
        id: tempId,
        tempId: tempId,
        wo: WO,
        acreg: ACREG,
        title,
        start,
        end,
        duration,
        status: "Open",
        skill: skill,
        dependsIndex: depIndex,
        depType: row.dataset.depType || "FS",
        lagDays: parseInt(row.dataset.lag || 0),
        leadDays: parseInt(row.dataset.lead || 0),
        color: row.dataset.color || "",

        // Map Index -> TempID immediately
        localDepId:
          depIndex >= 0 && tasksLocal[depIndex]
            ? tasksLocal[depIndex].tempId
            : "",
      });
    });

    // Link Local Dependencies
    tasksLocal.forEach((t) => {
      t.depends = t.localDepId;
    });

    /* -----------------------------------------------------------
       2. WATERFALL SORT
    ----------------------------------------------------------- */
    const existing = await fetchTasksByWOOnce(WO);
    const allTasks = [...existing, ...tasksLocal];
    const sorted = organizeTasksByWaterfall(allTasks);

    // Filter which tasks need saving
    const toSave = [];
    sorted.forEach((t, i) => {
      const oldRow = t.row;
      t.row = i;
      if (String(t.id).startsWith("local-") || oldRow !== i) {
        toSave.push(t);
      }
    });

    /* -----------------------------------------------------------
       3. SAVE & ID SWAP (FIXED)
    ----------------------------------------------------------- */
    const result = await batchSaveTasks(toSave);

    Object.entries(result.createdMap).forEach(([idx, newId]) => {
      // ✅ FIX: Use 'toSave' here, not 'tasksToSave'
      if (toSave[idx]) {
        toSave[idx].finalId = newId;

        // Find original object to update its finalId too
        const original = tasksLocal.find(
          (t) => t.tempId === toSave[idx].tempId,
        );
        if (original) original.finalId = newId;
      }
    });

    /* -----------------------------------------------------------
       4. FIX REAL DEPENDENCIES
    ----------------------------------------------------------- */
    const updates = [];
    tasksLocal.forEach((t) => {
      t.id = t.finalId;
      // If depends on a local ID, swap for final ID
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

    if (updates.length > 0) await batchSaveTasks(updates);

    /* -----------------------------------------------------------
       5. RELOAD
    ----------------------------------------------------------- */
    await loadWOList();
    const woFilter = document.getElementById("woFilter");
    woFilter.value = WO;
    woFilter.dispatchEvent(new Event("change"));

    hideLoading();
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

  setUnsaved(false);

  return list;
}

async function loadFromFirestoreAndCommitBaseline(wo) {
  const list = await fetchTasksByWOOnce(wo);

  updateTaskList(list);
  commitBaselineFromFirestore(list);

  applyDependencies();
  refresh();

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
    status: "Open", // <--- ADD THIS LINE (Default Status)
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
ensurePrintButton(); // <--- Add this line

await loadWOList();
// ...
/* ============================================================
   SORTING LOGIC
============================================================ */

// 1. SORT BY DATE (Strict Date + Dependency Priority)
const btnDate = document.getElementById("btnSortDate");
if (btnDate) {
  btnDate.onclick = () => {
    pushHistory();
    sortTasksByDate();
    render();
  };
}

// 2. SORT WATERFALL (Strict Hierarchy / Parent First)
const btnWaterfall = document.getElementById("btnSortWaterfall");
if (btnWaterfall) {
  btnWaterfall.onclick = () => {
    // Use the recursive helper to ensure Parent is always on top
    const sorted = organizeTasksByWaterfall(tasks);

    // Update main array
    tasks.splice(0, tasks.length, ...sorted);

    pushHistory();
    render();
  };
}

/* ============================================================
   HELPER: Waterfall Sort 
   (Parent > Child. Siblings: Start Date > Shortest Duration)
============================================================ */
export function organizeTasksByWaterfall(taskList) {
  const taskMap = new Map();
  const childrenMap = new Map();
  const roots = [];

  // 1. Map Data
  taskList.forEach((t) => {
    taskMap.set(t.id, t);
    childrenMap.set(t.id, []);
  });

  // 2. Build Children Map & Roots
  taskList.forEach((t) => {
    if (t.depends && taskMap.has(t.depends)) {
      childrenMap.get(t.depends).push(t);
    } else {
      roots.push(t);
    }
  });

  /* ============================================================
     Detect tasks that belong to a dependency chain
     (parents + children + middle nodes)
  ============================================================ */
  const inDependencyChain = new Set();

  function markChain(task) {
    if (inDependencyChain.has(task.id)) return;
    inDependencyChain.add(task.id);
    (childrenMap.get(task.id) || []).forEach(markChain);
  }

  taskList.forEach((t) => {
    if (t.depends || childrenMap.get(t.id)?.length > 0) {
      markChain(t);
    }
  });

  /* ============================================================
     SORTING FUNCTION (UPDATED RULE)
  ============================================================ */
  const smartSort = (a, b) => {
    // 1. Start Date
    if (a.start.getTime() !== b.start.getTime()) {
      return a.start - b.start;
    }

    const aInChain = inDependencyChain.has(a.id);
    const bInChain = inDependencyChain.has(b.id);

    // 2. Dependency Chain Priority
    if (aInChain && !bInChain) return -1;
    if (!aInChain && bInChain) return 1;

    const durA = a.end.getTime() - a.start.getTime();
    const durB = b.end.getTime() - b.start.getTime();

    // 3. SAME RULE AS btnSortDate:
    //    SHORTER duration FIRST (for BOTH chain & floating)
    if (durA !== durB) {
      return durA - durB;
    }

    // 4. Stable fallback (NOT alphabetical if possible)
    return (a.row ?? 0) - (b.row ?? 0);
  };

  // 3. Sort Roots
  roots.sort(smartSort);

  const sortedList = [];
  const visitedIds = new Set();

  // 4. Recursive Traversal (structure preserved)
  function traverse(task) {
    if (visitedIds.has(task.id)) return;
    visitedIds.add(task.id);
    sortedList.push(task);

    const kids = childrenMap.get(task.id) || [];
    kids.sort(smartSort);
    kids.forEach(traverse);
  }

  roots.forEach(traverse);

  return sortedList;
}

/* In app.js */
import { filterState } from "./state.js"; // Import the state

/* ============================================================
   FILTER LOGIC
============================================================ */
const skillSelect = document.getElementById("filterSkill");
if (skillSelect) {
  skillSelect.onchange = (e) => {
    // 1. Update State
    filterState.skill = e.target.value;

    // 2. Re-render (The renderer will now see the new filter)
    render();
  };
}
/* ============================================================
   MULTI-SELECT FILTER POPUP
============================================================ */

const btnFilter = document.getElementById("btnFilterSkill");
const countBadge = document.getElementById("filterCount");

if (btnFilter) {
  btnFilter.onclick = (e) => {
    e.stopPropagation();

    // 1. Close any existing popups
    document.querySelectorAll(".skill-filter-popup").forEach((p) => p.remove());

    // 2. Create Popup
    const popup = document.createElement("div");
    popup.className = "skill-filter-popup";
    Object.assign(popup.style, {
      position: "absolute",
      zIndex: "5000",
      background: "#1e293b",
      border: "1px solid #334155",
      borderRadius: "6px",
      padding: "8px",
      boxShadow: "0 10px 15px rgba(0,0,0,0.5)",
      minWidth: "160px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px",
      marginTop: "4px",
    });

    // Position directly under button
    const rect = btnFilter.getBoundingClientRect();
    popup.style.top = window.scrollY + rect.bottom + 5 + "px";
    popup.style.left = window.scrollX + rect.left + "px";

    // 3. Define Skills
    const SKILLS = ["AVI", "CRG", "CAB", "ENG", "FLC", "LDG", "STR", "SHOP"];

    // 4. Create Checkboxes
    SKILLS.forEach((skill) => {
      const label = document.createElement("label");
      Object.assign(label.style, {
        display: "flex",
        alignItems: "center",
        color: "#f8fafc",
        fontSize: "12px",
        cursor: "pointer",
      });

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = skill;
      cb.style.marginRight = "6px";

      // Check if already active
      if (filterState.skills.includes(skill)) {
        cb.checked = true;
      }

      // Handle Change
      cb.onchange = () => {
        const idx = filterState.skills.indexOf(skill);
        if (cb.checked) {
          if (idx === -1) filterState.skills.push(skill);
        } else {
          if (idx > -1) filterState.skills.splice(idx, 1);
        }
        updateFilterUI(); // Update button text/badge
        render(); // Redraw chart
      };

      label.appendChild(cb);
      label.appendChild(document.createTextNode(skill));
      popup.appendChild(label);
    });

    // 5. Add "Clear All" button
    const clearBtn = document.createElement("div");
    clearBtn.textContent = "Clear Filter";
    Object.assign(clearBtn.style, {
      gridColumn: "1 / -1",
      textAlign: "center",
      fontSize: "11px",
      color: "#94a3b8",
      cursor: "pointer",
      borderTop: "1px solid #334155",
      paddingTop: "4px",
      marginTop: "4px",
    });
    clearBtn.onclick = () => {
      filterState.skills = [];
      updateFilterUI();
      render();
      popup.remove();
    };
    popup.appendChild(clearBtn);

    document.body.appendChild(popup);

    // 6. Close on outside click
    const close = (evt) => {
      if (!popup.contains(evt.target) && evt.target !== btnFilter) {
        popup.remove();
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  };
}

// Helper to update the button appearance
function updateFilterUI() {
  if (!btnFilter) return;
  const count = filterState.skills.length;

  if (count > 0) {
    btnFilter.style.background = "#211ed4"; // Blue when active
    countBadge.style.display = "inline-block";
    countBadge.textContent = count;
    btnFilter.firstElementChild.textContent = "Skills";
  } else {
    btnFilter.style.background = "#334155"; // Default Slate
    countBadge.style.display = "none";
    btnFilter.firstElementChild.textContent = "Filter Skills";
  }
}
/* ============================================================
   DAY FILTER POPUP (D1, D2, D3...)
============================================================ */

const btnFilterDay = document.getElementById("btnFilterDay");
const dayBadge = document.getElementById("filterDayBadge");

if (btnFilterDay) {
  btnFilterDay.onclick = (e) => {
    e.stopPropagation();

    // Close existing popups
    document.querySelectorAll(".day-filter-popup").forEach((p) => p.remove());

    const popup = document.createElement("div");
    popup.className = "day-filter-popup";

    Object.assign(popup.style, {
      position: "absolute",
      zIndex: "5000",
      background: "#1e293b",
      border: "1px solid #334155",
      borderRadius: "6px",
      padding: "10px",
      boxShadow: "0 10px 15px rgba(0,0,0,0.5)",
      minWidth: "180px",
      color: "#f8fafc",
      fontSize: "12px",
    });

    const rect = btnFilterDay.getBoundingClientRect();
    popup.style.top = window.scrollY + rect.bottom + 5 + "px";
    popup.style.left = window.scrollX + rect.left + "px";

    popup.innerHTML = `
      <div style="font-weight:600; margin-bottom:6px;">Filter by Day</div>

      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <input id="dayFrom" type="number" min="1" placeholder="From"
          value="${filterState.dayFrom ?? ""}"
          style="width:70px; padding:4px; background:#0f172a; border:1px solid #334155; color:white; border-radius:4px;">
        <input id="dayTo" type="number" min="1" placeholder="To"
          value="${filterState.dayTo ?? ""}"
          style="width:70px; padding:4px; background:#0f172a; border:1px solid #334155; color:white; border-radius:4px;">
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button id="clearDay"
          style="background:none; border:none; color:#94a3b8; cursor:pointer;">
          Clear
        </button>
        <button id="applyDay"
          style="background:#2563eb; border:none; color:white; padding:4px 10px; border-radius:4px;">
          Apply
        </button>
      </div>
    `;

    popup.querySelector("#applyDay").onclick = () => {
      const from = popup.querySelector("#dayFrom").value;
      const to = popup.querySelector("#dayTo").value;

      filterState.dayFrom = from ? parseInt(from) : null;
      filterState.dayTo = to ? parseInt(to) : null;

      updateDayFilterUI();
      render();
      popup.remove();
    };

    popup.querySelector("#clearDay").onclick = () => {
      filterState.dayFrom = null;
      filterState.dayTo = null;

      updateDayFilterUI();
      render();
      popup.remove();
    };

    document.body.appendChild(popup);

    const close = (evt) => {
      if (!popup.contains(evt.target) && evt.target !== btnFilterDay) {
        popup.remove();
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  };
}

function updateDayFilterUI() {
  const active = filterState.dayFrom !== null || filterState.dayTo !== null;

  if (active) {
    btnFilterDay.style.background = "#2563eb";
    dayBadge.style.display = "inline-block";
  } else {
    btnFilterDay.style.background = "#334155";
    dayBadge.style.display = "none";
  }
}
