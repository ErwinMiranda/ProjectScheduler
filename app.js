// app.js — offline-first mode + lag/lead + cascading shift + safe updates

import {
  fetchUniqueWOList,
  fetchTasksByWOOnce,
  batchSaveTasks,
} from "./firebase.js";

import { render } from "./renderer.js";
import { addDays } from "./utils.js";
import { updateTaskList, tasks, selectedBars } from "./state.js";
import { pushHistory } from "./state.js";
import { undoHistory } from "./state.js";

/* UI refs */
const woFilter = document.getElementById("woFilter");
const taskLeftList = document.getElementById("taskLeftList");
const rowsRight = document.getElementById("rowsRight");
const timelineHeader = document.getElementById("timelineHeader");
const depOverlay = document.getElementById("depOverlay");
const newDepends = document.getElementById("newDepends");
const headerControls = document.querySelector(".header-controls");

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
  saveBtn.style.marginLeft = "8px";

  const discardBtn = document.createElement("button");
  discardBtn.id = "discardChangesBtn";
  discardBtn.className = "btn";
  discardBtn.textContent = "Discard";
  discardBtn.disabled = true;
  discardBtn.style.marginLeft = "6px";

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    await saveChanges();
    saveBtn.disabled = false;
    discardBtn.disabled = false;
  });

  discardBtn.addEventListener("click", async () => {
    if (!confirm("Discard local changes and reload from server?")) return;
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    await discardChanges();
    saveBtn.disabled = false;
    discardBtn.disabled = false;
  });

  headerControls.appendChild(saveBtn);
  headerControls.appendChild(discardBtn);
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

  const titleEl = document.querySelector(".title");
  const ac = document.getElementById("acRegLabel")?.textContent || "";

  if (titleEl) {
    titleEl.textContent = unsavedChanges
      ? `Project Schedule for ${ac} *`
      : `Project Schedule for ${ac}`;
  }
}

/* ============================================================
   LOAD WO LIST
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
    console.error("WO list failed", err);
  }
}

/* ============================================================
   DEPENDENCY ENGINE (FS + lag + lead)
============================================================ */
export function applyDependencies() {
  const map = Object.fromEntries(tasks.map((t) => [t.id, t]));

  let changed = true,
    safety = 0;

  while (changed && safety++ < 50) {
    changed = false;

    tasks.forEach((child) => {
      if (!child.depends) return;
      const parent = map[child.depends];
      if (!parent) return;

      const lag = Number.isFinite(child.lagDays) ? child.lagDays : 0;
      const lead = Number.isFinite(child.leadDays) ? child.leadDays : 0;

      const minStart = addDays(parent.end, 1 + lag - lead);

      if (child.start < minStart) {
        const dur = (child.end - child.start) / 86400000;
        child.start = minStart;
        child.end = addDays(child.start, dur);
        changed = true;
      }
    });
  }
}

/* ============================================================
   CASCADING SHIFT
============================================================ */
export function shiftChildren(parentId, deltaDays) {
  function rec(pid) {
    tasks.forEach((child) => {
      if (child.depends === pid) {
        child.start = addDays(child.start, deltaDays);
        child.end = addDays(child.end, deltaDays);

        const parent = tasks.find((t) => t.id === pid);
        if (parent) {
          const lag = Number.isFinite(child.lagDays) ? child.lagDays : 0;
          const lead = Number.isFinite(child.leadDays) ? child.leadDays : 0;

          const minStart = addDays(parent.end, 1 + lag - lead);
          if (child.start < minStart) {
            const dur = (child.end - child.start) / 86400000;
            child.start = minStart;
            child.end = addDays(child.start, dur);
          }
        }

        rec(child.id);
      }
    });
  }

  rec(parentId);
}

/* ============================================================
   DROPDOWN REFRESH
============================================================ */
export function refreshDependencyDropdown() {
  const sel = document.getElementById("newDepends");
  sel.innerHTML = `<option value="">No dependency</option>`;
  tasks.forEach((t) => {
    sel.innerHTML += `<option value="${t.id}">${t.title}</option>`;
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

  const list = await fetchTasksByWOOnce(currentWO);
  updateTaskList(list);

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);
});

/* ============================================================
   UNDO
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
   ESC → clear selection
============================================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectedBars.clear();
    render();
  }
});

/* ============================================================
   ADD TASK (LOCAL ONLY)
============================================================ */
document.getElementById("addTaskBtn").onclick = async () => {
  const wo = woFilter.value;
  if (!wo) return alert("Select WO first");

  const acreg = woFilter.selectedOptions[0].dataset.acreg;
  const title = document.getElementById("newTitle").value.trim();
  const s = document.getElementById("newStart").value;
  const e = document.getElementById("newEnd").value;
  const dep = newDepends.value || "";
  if (!title || !s || !e) return;

  const localId =
    "local-" + Date.now() + "-" + Math.floor(Math.random() * 9999);

  const t = {
    id: localId,
    wo,
    acreg,
    title,
    start: new Date(s),
    end: new Date(e),
    depends: dep,
    row: tasks.length,
    lagDays: 0,
    leadDays: 0,
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
    await applyMultiDeps();
  }
});

async function applyMultiDeps() {
  const ids = Array.from(selectedBars);
  if (ids.length < 2) return alert("Select at least 2 bars.");

  const parentId = ids[0];

  for (let i = 1; i < ids.length; i++) {
    const child = tasks.find((t) => t.id === ids[i]);
    if (!child) continue;

    pushHistory();
    child.depends = parentId;
  }

  selectedBars.clear();
  applyDependencies();
  refresh();
  setUnsaved(true);
}

/* ============================================================
   SAVE CHANGES
============================================================ */
async function saveChanges() {
  if (!currentWO) return alert("No WO selected.");

  const saveBtn = document.getElementById("saveChangesBtn");
  const discardBtn = document.getElementById("discardChangesBtn");

  saveBtn.textContent = "Saving...";
  discardBtn.disabled = true;

  try {
    const res = await batchSaveTasks(tasks);

    if (res.createdMap) {
      Object.entries(res.createdMap).forEach(([idx, newId]) => {
        if (tasks[idx]) tasks[idx].id = newId;
      });
    }

    const list = await fetchTasksByWOOnce(currentWO);
    updateTaskList(list);
    applyDependencies();
    refresh();
    refreshDependencyDropdown();
    setUnsaved(false);

    alert("Saved!");
  } catch (err) {
    console.error("Save failed", err);
    alert("Save error — see console");
  }

  saveBtn.textContent = "Save changes";
  discardBtn.disabled = false;
}

/* ============================================================
   DISCARD CHANGES
============================================================ */
async function discardChanges() {
  if (!currentWO) return;

  const list = await fetchTasksByWOOnce(currentWO);
  updateTaskList(list);

  applyDependencies();
  refresh();
  refreshDependencyDropdown();
  setUnsaved(false);
}

/* ============================================================
   ⭐ CRITICAL PATCH — LISTEN FOR LOCAL CHANGES
   (drag.js, edit.js, renderer.js all emit this)
============================================================ */
window.addEventListener("localchange", () => {
  setUnsaved(true);
});

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

const last = localStorage.getItem("selectedWO");
if (last) {
  woFilter.value = last;
  woFilter.dispatchEvent(new Event("change"));
} else {
  refresh();
}
