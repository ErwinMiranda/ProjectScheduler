import {
  addTask,
  tasksCol,
  listenTasksByWO,
  saveTask,
  fetchUniqueWOList,
} from "./firebase.js";

import { render } from "./renderer.js";
import { addDays } from "./utils.js";
import { updateTaskList, tasks, selectedBars } from "./state.js";
import { pushHistory } from "./state.js";
import { undoHistory } from "./state.js";

// UI refs
const woFilter = document.getElementById("woFilter");
const taskLeftList = document.getElementById("taskLeftList");
const rowsRight = document.getElementById("rowsRight");
const timelineHeader = document.getElementById("timelineHeader");
const depOverlay = document.getElementById("depOverlay");
const newDepends = document.getElementById("newDepends");

let unsubscribe = null;

/* -----------------------------
   Load Work Order (WO) list
--------------------------------*/
export async function loadWOList() {
  try {
    const prev = localStorage.getItem("selectedWO"); // ⭐ keep previous WO
    const unique = await fetchUniqueWOList();

    woFilter.innerHTML = `<option value="">Select Work Order</option>`;

    unique.forEach(({ wo, acreg }) => {
      woFilter.innerHTML += `<option value="${wo}" data-acreg="${acreg}">
        ${wo} — ${acreg}
      </option>`;
    });

    // ⭐ Restore previous selection if exists
    if (prev) {
      woFilter.value = prev;
    }
  } catch (err) {
    console.error("WO list failed", err);
  }
}

/* -----------------------------
   Apply constraints / cascading dates
--------------------------------*/
export function applyDependencies() {
  const map = Object.fromEntries(tasks.map((t) => [t.id, t]));
  let changed = true,
    safety = 0;

  while (changed && safety++ < 50) {
    changed = false;
    tasks.forEach((t) => {
      if (!t.depends) return;
      const p = map[t.depends];
      if (!p) return;

      const minStart = addDays(p.end, 1);

      if (t.start < minStart) {
        const dur = (t.end - t.start) / 86400000;
        t.start = minStart;
        t.end = addDays(t.start, dur);
        changed = true;
      }
    });
  }
}

/* -----------------------------
   Calculate min timeline date
--------------------------------*/
function computeMinDate() {
  if (!tasks.length) return addDays(new Date(), -3);

  let min = tasks[0].start;
  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
  });

  return addDays(min, -3);
}

/* -----------------------------
   Refresh UI render
--------------------------------*/
export function refresh() {
  const minDate = computeMinDate();
  render(taskLeftList, rowsRight, timelineHeader, depOverlay, minDate);
}

/* -----------------------------
   Listen WO change and load tasks
--------------------------------*/
woFilter.addEventListener("change", (e) => {
  if (unsubscribe) unsubscribe();

  const wo = e.target.value;
  const sel = e.target.selectedOptions[0];
  document.getElementById("acRegLabel").textContent = sel
    ? sel.dataset.acreg
    : "AC REG";

  // ⭐ Save selected WO
  localStorage.setItem("selectedWO", wo);

  if (!wo) {
    updateTaskList([]);
    refresh();
    return;
  }

  unsubscribe = listenTasksByWO(wo, (newList) => {
    updateTaskList(newList);
    applyDependencies();
    refresh();
  });
});

/* -----------------------------
   UNDO SHORTCUT
--------------------------------*/
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "z") {
    e.preventDefault();

    if (!undoHistory()) return;

    render();
  }
});

/* -----------------------------
   ESC — Unselect all bars
--------------------------------*/
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (selectedBars.size > 0) {
      selectedBars.clear();
      render();
    }
  }
});

/* -----------------------------
   Task creation handler
--------------------------------*/
document.getElementById("addTaskBtn").onclick = async () => {
  const wo = woFilter.value;
  if (!wo) return alert("Select WO first");

  const acreg = woFilter.selectedOptions[0].dataset.acreg;
  const title = document.getElementById("newTitle").value.trim();
  const s = document.getElementById("newStart").value;
  const e = document.getElementById("newEnd").value;
  const dep = document.getElementById("newDepends").value || "";

  if (!title || !s || !e) return;

  await addTask(wo, acreg, title, s, e, dep);
};

/* -----------------------------
   Ctrl+D — Multi dependency linking
--------------------------------*/
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    await applyMultiDependencies();
  }
});

async function applyMultiDependencies() {
  const ids = Array.from(selectedBars);
  if (ids.length < 2) return alert("Select at least 2 bars.");

  const parentId = ids[0];

  for (let i = 1; i < ids.length; i++) {
    const child = tasks.find((t) => t.id === ids[i]);
    if (!child) continue;
    pushHistory();
    child.depends = parentId;
    await saveTask(child).catch((err) => console.error(err));
  }

  selectedBars.clear();
  refresh();
}

/* -----------------------------
   Initial setup
--------------------------------*/
document.getElementById("newStart").value = new Date()
  .toISOString()
  .slice(0, 10);

document.getElementById("newEnd").value = addDays(new Date(), 2)
  .toISOString()
  .slice(0, 10);

// Load WO list first
await loadWOList();

// ⭐ AUTO-RESTORE LAST SELECTED WO ON REFRESH
const last = localStorage.getItem("selectedWO");
if (last) {
  woFilter.value = last;
  woFilter.dispatchEvent(new Event("change"));
} else {
  refresh();
}
