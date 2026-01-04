// renderer.js — builds UI, rows, bars, labels and dependency lines
// Patched for offline-first: local updates only + bottom-right tooltip + clean redraws

import { applyDependencies } from "./app.js";
import { tasks, selectedBars } from "./state.js";
import { daysBetween, formatDate, addDays } from "./utils.js";
import { drawDeps } from "./deps.js";
import { makeDraggable, makeLeftRowDraggable } from "./drag.js";
import { attachDurationEditing, attachTitleEditing } from "./edit.js";
import { pushHistory } from "./state.js";
import { showCriticalPath } from "./state.js";
import { computeCriticalPath } from "./utils.js";
import { deleteTask, insertTaskBelow } from "./app.js";
let scale = 36;

/* --------------------------------------------------------------------------
   Persistent bottom-right tooltip (single element)
   Always shown at lower-right of the viewport to avoid overlapping popups.
----------------------------------------------------------------------------*/
function ensureTooltip() {
  let tip = document.querySelector(".bar-tooltip--fixed");
  if (tip) return tip;

  tip = document.createElement("div");
  tip.className = "bar-tooltip--fixed";
  // inline styles so no CSS changes required
  Object.assign(tip.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    background: "rgba(255,255,255,0.98)",
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
    padding: "8px 10px",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#0c2868",
    zIndex: 2000,
    maxWidth: "320px",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 160ms ease",
    whiteSpace: "normal",
    lineHeight: "1.3",
  });

  document.body.appendChild(tip);
  return tip;
}

const LAST_COLOR_KEY = "lastBarColor";
const DEFAULT_BAR_COLOR = "#2563eb";

function getLastUsedColor() {
  return localStorage.getItem(LAST_COLOR_KEY) || DEFAULT_BAR_COLOR;
}

function setLastUsedColor(color) {
  localStorage.setItem(LAST_COLOR_KEY, color);
}

function openDependencyEditor(task, anchorEl, clientX, clientY) {
  document.querySelector(".dep-editor")?.remove();

  const editor = document.createElement("div");
  editor.className = "dep-editor";
  editor.style.position = "fixed";
  editor.style.zIndex = 3000;

  editor.innerHTML = `
    <h4>Dependency Offset</h4>

    <label>
      Lag
      <input type="number" min="0" value="${task.lagDays || 0}">
    </label>

    <label>
      Lead
      <input type="number" min="0" value="${task.leadDays || 0}">
    </label>

    <label>
      Type
      <select class="dep-type">
        <option value="FS">Finish → Start</option>
        <option value="SS">Start → Start</option>
      </select>
    </label>

    <label>
      Bar color
      <input type="color" class="bar-color" />
    </label>

    <div class="net">Net: 0 days</div>

    <div class="actions">
      <button class="cancel">Cancel</button>
      <button class="apply">Apply</button>
    </div>
  `;

  document.body.appendChild(editor);

  // Position safely
  positionContextMenu(editor, clientX, clientY);

  const lagInput = editor.querySelectorAll("input")[0];
  const leadInput = editor.querySelectorAll("input")[1];
  const typeSelect = editor.querySelector(".dep-type");
  const colorInput = editor.querySelector(".bar-color");
  const netEl = editor.querySelector(".net");

  // Load last used color
  colorInput.value = getLastUsedColor();

  typeSelect.value = task.depType || "FS";

  const updateNet = () => {
    const lag = Number(lagInput.value) || 0;
    const lead = Number(leadInput.value) || 0;
    const net = lag - lead;
    netEl.textContent = `Net: ${net >= 0 ? "+" : ""}${net} day(s)`;
  };

  updateNet();
  lagInput.oninput = updateNet;
  leadInput.oninput = updateNet;

  editor.querySelector(".cancel").onclick = () => editor.remove();

  editor.querySelector(".apply").onclick = () => {
    pushHistory();

    task.lagDays = Math.max(0, Number(lagInput.value) || 0);
    task.leadDays = Math.max(0, Number(leadInput.value) || 0);
    task.depType = typeSelect.value;
    task.color = colorInput.value;

    // Persist chosen color globally
    setLastUsedColor(task.color);

    window.dispatchEvent(new CustomEvent("localchange"));

    applyDependencies();
    render();
    import("./app.js").then((m) => m.refreshDependencyDropdown());

    editor.remove();
  };

  // Close on ESC or outside click
  const close = (e) => {
    if (
      e.key === "Escape" ||
      (e.type === "mousedown" && !editor.contains(e.target))
    ) {
      editor.remove();
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
    }
  };

  document.addEventListener("keydown", close);
  setTimeout(() => document.addEventListener("mousedown", close));
}

/* --------------------------------------------------------------------------
   Compute the earliest visible date
----------------------------------------------------------------------------*/
function computeMinDate() {
  if (!tasks.length) return addDays(new Date(), -3);

  let min = tasks[0].start;
  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
  });

  return addDays(min, -3);
}

/* --------------------------------------------------------------------------
   Main render
----------------------------------------------------------------------------*/
export function render() {
  const taskLeftList = document.getElementById("taskLeftList");
  const rowsRight = document.getElementById("rowsRight");
  const timelineHeader = document.getElementById("timelineHeader");
  const depOverlay = document.getElementById("depOverlay");

  const minDate = computeMinDate();

  const [minD, maxD] = getBounds(minDate);
  const totalDays = daysBetween(minD, maxD) + 1;
  const width = totalDays * scale;

  taskLeftList.innerHTML = "";
  rowsRight.innerHTML = "";
  timelineHeader.innerHTML = "";
  depOverlay.innerHTML = "";
  const criticalSet = showCriticalPath ? computeCriticalPath(tasks) : null;
  buildTimelineHeader(timelineHeader, minD, totalDays);
  buildRows(taskLeftList, rowsRight, minD, width, criticalSet);

  requestAnimationFrame(() => {
    syncRowHeights(taskLeftList, rowsRight);
    repositionBarLabels(rowsRight);
    drawDeps(minD, scale, width, rowsRight);
  });
}

/* --------------------------------------------------------------------------
   Calculate timeline bounds
----------------------------------------------------------------------------*/
function getBounds(minOverride) {
  if (!tasks.length) {
    return [addDays(new Date(), -3), addDays(new Date(), 10)];
  }

  let min = tasks[0].start;
  let max = tasks[0].end;

  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
    if (t.end > max) max = t.end;
  });

  return [minOverride, addDays(max, 3)];
}

/* --------------------------------------------------------------------------
   Build timeline header (months + days)
----------------------------------------------------------------------------*/
function buildTimelineHeader(timelineHeader, minDate, totalDays) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";

  const monthRow = document.createElement("div");
  monthRow.style.display = "flex";
  monthRow.style.height = "20px";

  const dayRow = document.createElement("div");
  dayRow.style.display = "flex";
  dayRow.style.height = "30px";

  let currentMonth = minDate.getMonth();
  let currentYear = minDate.getFullYear();
  let monthStartIndex = 0;

  for (let i = 0; i < totalDays; i++) {
    const d = addDays(minDate, i);

    const dayCell = document.createElement("div");
    dayCell.classList.add("day-cell"); // used for highlight
    dayCell.style.width = scale + "px";
    dayCell.style.display = "flex";
    dayCell.style.alignItems = "center";
    dayCell.style.justifyContent = "center";
    dayCell.textContent = d.getDate();
    dayRow.appendChild(dayCell);

    const month = d.getMonth();
    const year = d.getFullYear();

    const isBoundary =
      month !== currentMonth || year !== currentYear || i === totalDays - 1;

    if (isBoundary) {
      const blockEndIndex = i === totalDays - 1 ? i + 1 : i;
      const blockLength = blockEndIndex - monthStartIndex;

      const monthCell = document.createElement("div");
      monthCell.style.width = blockLength * scale + "px";
      monthCell.style.display = "flex";
      monthCell.style.alignItems = "center";
      monthCell.style.justifyContent = "center";
      monthCell.style.fontWeight = "bold";
      monthCell.style.fontSize = "12px";

      const blockDate = addDays(minDate, monthStartIndex);
      monthCell.textContent = blockDate.toLocaleString("default", {
        month: "short",
        year: "numeric",
      });

      monthRow.appendChild(monthCell);

      currentMonth = month;
      currentYear = year;
      monthStartIndex = i;
    }
  }

  wrapper.appendChild(monthRow);
  wrapper.appendChild(dayRow);
  timelineHeader.appendChild(wrapper);
}

/* --------------------------------------------------------------------------
   Build LEFT + RIGHT rows including bars and floating labels
----------------------------------------------------------------------------*/
function buildRows(taskLeftList, rowsRight, minDate, width, criticalSet) {
  const barH =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--bar-height"
      )
    ) || 20;

  const tooltip = ensureTooltip();

  tasks.forEach((task, idx) => {
    /* ---------------- LEFT ROW ----------------- */
    const leftRow = document.createElement("div");
    leftRow.className = "unified-row";

    leftRow.innerHTML = `
    
  <div class="row-left">
  <button class="task-insert" title="Insert task below">+</button>
  <button class="task-delete" title="Delete task">x</button>
    <div class="index">${idx + 1}</div>

    <div class="task-title">${escapeHtml(task.title)}</div>

    <div class="task-dur" data-id="${task.id}">
      <span>${daysBetween(task.start, task.end) + 1}d</span>
    </div>

    <div class="task-dates">
      ${formatDate(task.start)} → ${formatDate(task.end)}
    </div>
  </div>
`;

    taskLeftList.appendChild(leftRow);
    makeLeftRowDraggable(leftRow, task.id);
    const delBtn = leftRow.querySelector(".task-delete");
    const insBtn = leftRow.querySelector(".task-insert");

    [delBtn, insBtn].forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    insBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      insertTaskBelow(task);
    });

    // ✅ ACTUAL DELETE
    delBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      deleteTask(task.id);
    });

    /* ---------------- RIGHT ROW ---------------- */
    const rightRow = document.createElement("div");
    rightRow.className = "unified-row";

    const rightCell = document.createElement("div");
    rightCell.className = "row-right";

    const rowGrid = document.createElement("div");
    rowGrid.className = "row-grid";
    rowGrid.style.minWidth = width + "px";

    const gridBack = document.createElement("div");
    gridBack.className = "grid-back";
    gridBack.style.minWidth = width + "px";

    /* ---------------- BAR ---------------- */
    const bar = document.createElement("div");
    bar.className = "bar";
    if (task.color) {
      bar.style.borderColor = task.color;
      bar.style.backgroundColor = task.color;
    }

    bar.dataset.id = task.id;

    const leftDays = daysBetween(minDate, task.start);
    const span = daysBetween(task.start, task.end) + 1;

    bar.style.left = leftDays * scale + "px";
    bar.style.width = span * scale + "px";
    bar.style.height = barH + "px";

    bar.innerHTML = `
      <div class="handle left"></div>
      <div class="handle right"></div>
    `;

    if (selectedBars.has(task.id)) {
      bar.classList.add("selected");
    }
    if (showCriticalPath && criticalSet && criticalSet.has(task.id)) {
      bar.style.border = "3px solid #dc2626";
    } else {
      bar.style.border = "none";
    }

    /* ---------------- LABEL AFTER BAR ---------------- */
    const label = document.createElement("div");
    label.className = "bar-label-after";
    label.textContent = task.title;

    /* Append to structure */
    rowGrid.appendChild(gridBack);
    rowGrid.appendChild(bar);
    rowGrid.appendChild(label);
    rightCell.appendChild(rowGrid);
    rightRow.appendChild(rightCell);
    rowsRight.appendChild(rightRow);

    makeDraggable(bar);

    // Hover tooltip: show in lower-right corner (fixed)
    bar.addEventListener("mousemove", () => {
      const t = tasks.find((x) => x.id === bar.dataset.id);
      if (!t) {
        tooltip.style.opacity = 0;
        return;
      }

      const parent = tasks.find((x) => x.id === t.depends);

      const lag = Number.isFinite(t.lagDays) ? t.lagDays : 0;
      const lead = Number.isFinite(t.leadDays) ? t.leadDays : 0;
      const net = lag - lead;

      const depType = t.depType || "FS";
      const depLabel = depType === "SS" ? "Start → Start" : "Finish → Start";

      tooltip.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">
      ${escapeHtml(t.title)}
    </div>

    <div style="font-size:12px; color:#334155; line-height:1.4">
      <div>
        <span style="color:#64748b">Depends on:</span>
        <strong>${parent ? escapeHtml(parent.title) : "—"}</strong>
      </div>

      <div>
        <span style="color:#64748b">Dependency:</span>
        <strong>${depType}</strong>
        <span style="color:#64748b">(${depLabel})</span>
      </div>

      <div>
        <span style="color:#64748b">Lag:</span> ${lag} day(s)
        &nbsp;•&nbsp;
        <span style="color:#64748b">Lead:</span> ${lead} day(s)
      </div>

      <div>
        <span style="color:#64748b">Net offset:</span>
        <strong>${net >= 0 ? "+" : ""}${net}</strong> day(s)
      </div>
    </div>
  `;

      tooltip.style.opacity = "1";
    });

    bar.addEventListener("mouseleave", () => {
      tooltip.style.opacity = "0";
    });

    // RIGHT-CLICK: set lagDays (offline-first)
    bar.addEventListener("contextmenu", (e) => {
      e.preventDefault();

      const task = tasks.find((x) => x.id === bar.dataset.id);
      if (!task) return;

      openDependencyEditor(task, bar, e.clientX, e.clientY);
    });

    // DOUBLE-CLICK: unlink dependency (offline-first)
    bar.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const t = tasks.find((x) => x.id === task.id);
      if (!t || !t.depends) return;

      pushHistoryLocalUntracked(t);
      t.depends = "";

      window.dispatchEvent(new CustomEvent("localchange"));
      applyDependencies();
      render();

      import("./app.js").then((m) => m.refreshDependencyDropdown());
    });
  });

  attachDurationEditing();
  attachTitleEditing();
}

/* --------------------------------------------------------------------------
   Sync row heights
----------------------------------------------------------------------------*/
function syncRowHeights(leftContainer, rightContainer) {
  const leftRows = leftContainer.querySelectorAll(".unified-row");
  const rightRows = rightContainer.querySelectorAll(".unified-row");

  rightRows.forEach((rightRow, i) => {
    const leftH = leftRows[i]?.offsetHeight || 44;
    rightRow.style.height = leftH + "px";

    const grid = rightRow.querySelector(".row-grid");
    if (grid) grid.style.height = leftH + "px";

    const bar = rightRow.querySelector(".bar");
    if (bar) bar.style.top = Math.round((leftH - bar.offsetHeight) / 2) + "px";
  });
}

/* --------------------------------------------------------------------------
   EXACT SAME LABEL POSITION AS BEFORE
----------------------------------------------------------------------------*/
function repositionBarLabels(rowsRight) {
  rowsRight.querySelectorAll(".unified-row").forEach((row) => {
    const bar = row.querySelector(".bar");
    const label = row.querySelector(".bar-label-after");

    if (!bar || !label) return;

    label.style.left = bar.offsetLeft + bar.offsetWidth + 6 + "px";
    label.style.top = "50%";
    label.style.transform = "translateY(-50%)";
  });
}

/* --------------------------------------------------------------------------
   Small helpers
----------------------------------------------------------------------------*/
function getTaskIndexById(id) {
  return tasks.findIndex((t) => t.id === id);
}

function pushHistoryLocalUntracked(task) {
  try {
    // best-effort: call pushHistory from state if available
    if (typeof pushHistory === "function") {
      pushHistory();
    }
  } catch (err) {
    // noop
  }
}

/* Simple escape to avoid accidental html injection in titles */
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function positionContextMenu(menuEl, x, y) {
  // Make it visible first so we can measure it
  menuEl.style.visibility = "hidden";
  menuEl.style.display = "block";

  const menuRect = menuEl.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = x;
  let top = y;

  // Clamp horizontally
  if (left + menuRect.width > viewportW) {
    left = viewportW - menuRect.width - 8;
  }

  // Clamp vertically
  if (top + menuRect.height > viewportH) {
    top = viewportH - menuRect.height - 8;
  }

  // Safety for very small screens
  left = Math.max(8, left);
  top = Math.max(8, top);

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
  menuEl.style.visibility = "visible";
}
