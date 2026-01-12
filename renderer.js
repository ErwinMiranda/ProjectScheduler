// renderer.js — builds UI, rows, bars, labels and dependency lines
// Patched for offline-first: local updates only + bottom-right tooltip + clean redraws

import { applyDependencies } from "./app.js";
import { tasks, selectedBars } from "./state.js";
import { daysBetween, formatDate, addDays } from "./utils.js";
import { drawDeps } from "./deps.js";
import { makeDraggable, makeLeftRowDraggable } from "./drag.js";
import {
  attachDurationEditing,
  attachTitleEditing,
  attachDateEditing,
} from "./edit.js";
import { pushHistory } from "./state.js";
import { showCriticalPath } from "./state.js";
import { computeCriticalPath, toDateInput } from "./utils.js";
import { deleteTask, insertTaskBelow } from "./app.js";
let scale = 36;

/* --------------------------------------------------------------------------
   Persistent bottom-right tooltip (single element)
----------------------------------------------------------------------------*/
function ensureTooltip() {
  let tip = document.querySelector(".bar-tooltip--fixed");
  if (tip) return tip;

  tip = document.createElement("div");
  tip.className = "bar-tooltip--fixed";
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
      Lag <input type="number" min="0" value="${task.lagDays || 0}">
    </label>
    <label>
      Lead <input type="number" min="0" value="${task.leadDays || 0}">
    </label>
    <label>
      Type
      <select class="dep-type">
        <option value="FS">Finish → Start</option>
        <option value="SS">Start → Start</option>
      </select>
    </label>
    <label>
      Bar color <input type="color" class="bar-color" />
    </label>
    <div class="net">Net: 0 days</div>
    <div class="actions">
      <button class="cancel">Cancel</button>
      <button class="apply">Apply</button>
    </div>
  `;

  document.body.appendChild(editor);
  positionContextMenu(editor, clientX, clientY);

  const lagInput = editor.querySelectorAll("input")[0];
  const leadInput = editor.querySelectorAll("input")[1];
  const typeSelect = editor.querySelector(".dep-type");
  const colorInput = editor.querySelector(".bar-color");
  const netEl = editor.querySelector(".net");

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
    setLastUsedColor(task.color);

    window.dispatchEvent(new CustomEvent("localchange"));
    applyDependencies();
    render();
    import("./app.js").then((m) => m.refreshDependencyDropdown());
    editor.remove();
  };

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
   DRAW TODAY LINE
----------------------------------------------------------------------------*/
function drawTodayLine(minDate, scale, container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const chartStart = new Date(minDate);
  chartStart.setHours(0, 0, 0, 0);

  if (today < chartStart) return;

  const diffTime = today - chartStart;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  const leftPos = diffDays * scale;

  const line = document.createElement("div");
  line.className = "today-line";
  line.style.left = leftPos + "px";

  container.appendChild(line);
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

  drawTodayLine(minD, scale, depOverlay);

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
  if (!tasks.length) return [addDays(new Date(), -3), addDays(new Date(), 10)];
  let min = tasks[0].start;
  let max = tasks[0].end;
  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
    if (t.end > max) max = t.end;
  });
  return [minOverride, addDays(max, 3)];
}

/* --------------------------------------------------------------------------
   Build timeline header
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
    dayCell.classList.add("day-cell");
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

/* ============================================================
   STATUS COLORS CONFIGURATION
============================================================ */
const STATUS_COLORS = {
  Open: "#092149ff",
  InProgress: "#f59e0b",
  Hold: "#8f8e8ef8",
  Closed: "#10b981",
};

function getStatusBg(status) {
  return STATUS_COLORS[status] || STATUS_COLORS["Open"];
}

/* --------------------------------------------------------------------------
   Helper: Find the absolute first start date (Project Day 1)
----------------------------------------------------------------------------*/
function getProjectStartDate() {
  if (!tasks.length) return new Date();
  let min = tasks[0].start;
  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
  });
  return min;
}

/* --------------------------------------------------------------------------
   Build LEFT + RIGHT rows (Editable Relative Days)
----------------------------------------------------------------------------*/
function buildRows(taskLeftList, rowsRight, minDate, width, criticalSet) {
  const barH =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--bar-height"
      )
    ) || 20;
  const tooltip = ensureTooltip();

  // 1. Determine Project Start (Anchor for Day 1)
  const projectStart = getProjectStartDate();

  tasks.forEach((task, idx) => {
    if (!task.status) task.status = "Open";

    // --- CALCULATE RELATIVE DAYS ---
    const startDay = daysBetween(projectStart, task.start) + 1;
    const endDay = daysBetween(projectStart, task.end) + 1;

    const startDateStr = task.start.toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    const endDateStr = task.end.toLocaleDateString(undefined, {
      dateStyle: "medium",
    });

    // --- LEFT ROW ---text-overflow: ellipsis; white-space: nowrap;
    const leftRow = document.createElement("div");
    leftRow.className = "unified-row";

    leftRow.innerHTML = `
    <div class="row-left">
      <button class="task-insert" title="Insert task below">+</button>
      <button class="task-delete" title="Delete task">x</button>
      
      <div class="index">${task.wbs || idx + 1}</div>

      <div class="task-title" title="${escapeHtml(task.title)}" 
           style="width: 500px; overflow: hidden; ">
           ${escapeHtml(task.title)}
      </div>

      <select class="task-status" data-id="${task.id}" 
              style="   
                      
                      background:${getStatusBg(task.status)}; 
                       ">
        <option value="Open" ${
          task.status === "Open" ? "selected" : ""
        }>Open</option>
        <option value="InProgress" ${
          task.status === "InProgress" ? "selected" : ""
        }>In Prog</option>
        <option value="Hold" ${
          task.status === "Hold" ? "selected" : ""
        }>Hold</option>
        <option value="Closed" ${
          task.status === "Closed" ? "selected" : ""
        }>Closed</option>
      </select>

      <div class="task-dur" data-id="${
        task.id
      }" style="width: 50px; display: flex; justify-content: center;">
        <span>${daysBetween(task.start, task.end) + 1}d</span>
      </div>

      <div class="task-dates" data-id="${task.id}" 
           style="width: 350px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; font-size: 13px; color: #334155;">
        
        <input type="text" class="day-edit-start" value="Day ${startDay}" title="${startDateStr}"
             style="background: #f1f5f9; padding: 4px 0; border-radius: 4px; border: 1px solid #cbd5e1; width: 50px; text-align: center; cursor: text; font-size: 13px; color: #334155;">
        
        <span style="color: #94a3b8;">→</span>
        
        <input type="text" class="day-edit-end" value="Day ${endDay}" title="${endDateStr}"
             style="background: #f1f5f9; padding: 4px 0; border-radius: 4px; border: 1px solid #cbd5e1; width: 50px; text-align: center; cursor: text; font-size: 13px; color: #334155;">

      </div>
    </div>
    `;

    taskLeftList.appendChild(leftRow);
    makeLeftRowDraggable(leftRow, task.id);

    // --- BUTTON & STATUS LOGIC ---
    const delBtn = leftRow.querySelector(".task-delete");
    const insBtn = leftRow.querySelector(".task-insert");
    const statusSelect = leftRow.querySelector(".task-status");

    statusSelect.addEventListener("change", (e) => {
      pushHistory();
      const newStatus = e.target.value;
      task.status = newStatus;
      statusSelect.style.background = getStatusBg(newStatus);
      window.dispatchEvent(new CustomEvent("localchange"));
      render(); // Re-render to update bar color immediately
    });

    [delBtn, insBtn, statusSelect].forEach((el) => {
      el.addEventListener("mousedown", (e) => e.stopPropagation());
    });
    insBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      insertTaskBelow(task);
    });
    delBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteTask(task.id);
    });

    // --- NEW: DATE EDITING LOGIC ---
    const startInput = leftRow.querySelector(".day-edit-start");
    const endInput = leftRow.querySelector(".day-edit-end");

    // Helper: Parse "Day 5" -> 5
    const parseDay = (val) => {
      const num = parseInt(val.replace(/[^\d]/g, ""), 10);
      return isNaN(num) ? 0 : num;
    };

    // 1. Handle Start Day Edit (Moves Task, Keeps Duration)
    const handleStartEdit = () => {
      const val = parseDay(startInput.value);
      if (!val || val < 1) return render(); // Reset on invalid

      pushHistory();
      const oldStart = task.start;
      const duration = daysBetween(task.start, task.end); // Keep duration

      // Calculate New Start: ProjectStart + (Day - 1)
      const newStart = addDays(projectStart, val - 1);

      task.start = newStart;
      task.end = addDays(newStart, duration); // Move end to match

      window.dispatchEvent(new CustomEvent("localchange"));
      applyDependencies(); // Recalculate dependencies in case of conflict
      render();
      import("./app.js").then((m) => m.refreshDependencyDropdown());
    };

    // 2. Handle End Day Edit (Changes Duration)
    const handleEndEdit = () => {
      const val = parseDay(endInput.value);
      if (!val || val < 1) return render();

      pushHistory();

      // Calculate New End
      const newEnd = addDays(projectStart, val - 1);

      // Validation: End cannot be before Start
      if (newEnd < task.start) {
        alert("End day cannot be before Start day");
        return render();
      }

      task.end = newEnd;

      window.dispatchEvent(new CustomEvent("localchange"));
      applyDependencies();
      render();
      import("./app.js").then((m) => m.refreshDependencyDropdown());
    };

    // Input UX: Select all on focus, Save on Blur/Enter
    [startInput, endInput].forEach((input) => {
      input.onfocus = () => {
        // Remove "Day " text for easier typing
        input.value = parseDay(input.value);
        input.select();
      };

      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") render(); // Cancel
      };
    });

    startInput.onblur = handleStartEdit;
    endInput.onblur = handleEndEdit;

    // --- RIGHT ROW ---
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

    const bar = document.createElement("div");
    bar.className = "bar";
    const statusColor = STATUS_COLORS[task.status] || STATUS_COLORS["Open"];
    bar.style.backgroundColor = statusColor;
    bar.style.borderColor = statusColor;
    if (task.status === "Hold") {
      bar.style.backgroundImage =
        "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.2) 5px, rgba(255,255,255,0.2) 10px)";
    }
    bar.dataset.id = task.id;

    const leftDays = daysBetween(minDate, task.start);
    const span = daysBetween(task.start, task.end) + 1;
    bar.style.left = leftDays * scale + "px";
    bar.style.width = span * scale + "px";
    bar.style.height = barH + "px";
    bar.innerHTML = `<div class="handle left"></div><div class="handle right"></div>`;

    if (selectedBars.has(task.id)) bar.classList.add("selected");
    if (showCriticalPath && criticalSet && criticalSet.has(task.id)) {
      bar.style.border = "3px solid #dc2626";
    } else {
      bar.style.border = "1px solid rgba(0,0,0,0.1)";
    }

    const label = document.createElement("div");
    label.className = "bar-label-after";
    label.textContent = task.title;

    rowGrid.appendChild(gridBack);
    rowGrid.appendChild(bar);
    rowGrid.appendChild(label);
    rightCell.appendChild(rowGrid);
    rightRow.appendChild(rightCell);
    rowsRight.appendChild(rightRow);

    makeDraggable(bar);

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
      tooltip.innerHTML = `
        <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(
          t.title
        )}</div>
        <div style="font-size:12px; color:#334155; line-height:1.4">
          <div><span style="color:#64748b">Status:</span> <strong>${
            t.status
          }</strong></div>
          <div><span style="color:#64748b">Dates:</span> <strong>Day ${
            daysBetween(projectStart, t.start) + 1
          } - Day ${daysBetween(projectStart, t.end) + 1}</strong></div>
        </div>`;
      tooltip.style.opacity = "1";
    });
    bar.addEventListener("mouseleave", () => {
      tooltip.style.opacity = "0";
    });
    bar.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = tasks.find((x) => x.id === bar.dataset.id);
      if (!task) return;
      openDependencyEditor(task, bar, e.clientX, e.clientY);
    });
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

// ... syncRowHeights, repositionBarLabels, helpers ...
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

function getTaskIndexById(id) {
  return tasks.findIndex((t) => t.id === id);
}
function pushHistoryLocalUntracked(task) {
  try {
    if (typeof pushHistory === "function") pushHistory();
  } catch (err) {}
}
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function positionContextMenu(menuEl, x, y) {
  menuEl.style.visibility = "hidden";
  menuEl.style.display = "block";
  const menuRect = menuEl.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let left = x;
  let top = y;
  if (left + menuRect.width > viewportW) left = viewportW - menuRect.width - 8;
  if (top + menuRect.height > viewportH) top = viewportH - menuRect.height - 8;
  left = Math.max(8, left);
  top = Math.max(8, top);
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
  menuEl.style.visibility = "visible";
}
