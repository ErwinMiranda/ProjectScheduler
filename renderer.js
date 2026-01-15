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
  attachSkillEditing, // <--- 1. ADD IMPORT HERE
} from "./edit.js";
import { pushHistory } from "./state.js";
import { showCriticalPath } from "./state.js";
import { computeCriticalPath, toDateInput } from "./utils.js";
import { deleteTask, insertTaskBelow } from "./app.js";
let scale = 36;

/* --------------------------------------------------------------------------
   Persistent bottom-right tooltip (Dark Mode)
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
    // DARK MODE STYLES
    background: "#1e293b", // Dark Slate (Background)
    border: "1px solid #334155", // Subtle dark border
    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)", // Strong shadow
    color: "#f1f5f9", // White-ish text
    padding: "10px 12px",
    borderRadius: "8px",
    fontSize: "12px",
    zIndex: 2000,
    maxWidth: "320px",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 160ms ease",
    whiteSpace: "normal",
    lineHeight: "1.4",
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

/* ============================================================
   DEPENDENCY & REMARKS EDITOR (Context Menu)
   - Removed: Bar Color Picker
   - Added: Remarks Textarea
============================================================ */
function openDependencyEditor(task, anchorEl, clientX, clientY) {
  document.querySelector(".dep-editor")?.remove();

  const editor = document.createElement("div");
  editor.className = "dep-editor";

  // Inline styles for the editor popup
  Object.assign(editor.style, {
    position: "fixed",
    zIndex: 3000,
    background: "#1e293b", // Dark Slate
    border: "1px solid #a4a7aa",
    borderRadius: "8px",
    padding: "12px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
    width: "240px",
    color: "#f8fafc",
    fontFamily: "inherit",
  });

  editor.innerHTML = `
    <h4 style="margin:0 0 10px 0; font-size:13px; color:#cbd5e1; border-bottom:1px solid #334155; padding-bottom:6px;">
      Edit Task Details
    </h4>
    
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:10px;">
      <label style="font-size:11px; color:#94a3b8;">
        Lag (Days) <input type="number" class="dep-lag" min="0" value="${
          task.lagDays || 0
        }" style="width:100%; background:#0f172a; border:1px solid #334155; color:white; padding:4px; border-radius:4px; margin-top:4px;">
      </label>
      <label style="font-size:11px; color:#94a3b8;">
        Lead (Days) <input type="number" class="dep-lead" min="0" value="${
          task.leadDays || 0
        }" style="width:100%; background:#0f172a; border:1px solid #334155; color:white; padding:4px; border-radius:4px; margin-top:4px;">
      </label>
    </div>

    <label style="font-size:11px; color:#94a3b8; display:block; margin-bottom:10px;">
      Dependency Type
      <select class="dep-type" style="width:100%; background:#0f172a; border:1px solid #334155; color:white; padding:4px; border-radius:4px; margin-top:4px;">
        <option value="FS">Finish → Start</option>
        <option value="SS">Start → Start</option>
      </select>
    </label>
    
    <label style="font-size:11px; color:#94a3b8; display:block; margin-bottom:10px;">
      Remarks / Notes
      <textarea class="dep-remarks" rows="3" 
        style="width:100%; background:#0f172a; border:1px solid #334155; color:white;  border-radius:4px; margin-top:4px; resize:vertical; font-size:12px;">${
          task.remarks || ""
        }</textarea>
    </label>

    <div class="net" style="font-size:11px; color:#60a5fa; margin-bottom:12px; font-weight:600;">Net Offset: 0 days</div>
    
    <div class="actions" style="display:flex; gap:8px; justify-content:flex-end;">
      <button class="cancel" style="background:transparent; border:1px solid #475569; color:#cbd5e1; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px;">Cancel</button>
      <button class="apply" style="background:#2563eb; border:none; color:white; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:11px;">Apply</button>
    </div>
  `;

  document.body.appendChild(editor);
  positionContextMenu(editor, clientX, clientY);

  // SELECTORS
  const lagInput = editor.querySelector(".dep-lag");
  const leadInput = editor.querySelector(".dep-lead");
  const typeSelect = editor.querySelector(".dep-type");
  const remarksInput = editor.querySelector(".dep-remarks"); // New
  const netEl = editor.querySelector(".net");

  typeSelect.value = task.depType || "FS";

  // UPDATE NET OFFSET DISPLAY
  const updateNet = () => {
    const lag = Number(lagInput.value) || 0;
    const lead = Number(leadInput.value) || 0;
    const net = lag - lead;
    netEl.textContent = `Net Offset: ${net >= 0 ? "+" : ""}${net} day(s)`;
  };

  updateNet();
  lagInput.oninput = updateNet;
  leadInput.oninput = updateNet;

  // BUTTON HANDLERS
  editor.querySelector(".cancel").onclick = () => editor.remove();

  editor.querySelector(".apply").onclick = () => {
    pushHistory();

    // Save Values
    task.lagDays = Math.max(0, Number(lagInput.value) || 0);
    task.leadDays = Math.max(0, Number(leadInput.value) || 0);
    task.depType = typeSelect.value;
    task.remarks = remarksInput.value.trim(); // <--- SAVE REMARKS

    // Trigger Update
    window.dispatchEvent(new CustomEvent("localchange"));
    applyDependencies();
    render();
    import("./app.js").then((m) => m.refreshDependencyDropdown());
    editor.remove();
  };

  // CLOSE LOGIC (Click Outside / Escape)
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
   DRAW TODAY LINE (Only if inside project range)
----------------------------------------------------------------------------*/
function drawTodayLine(minDate, maxDate, scale, container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const chartStart = new Date(minDate);
  chartStart.setHours(0, 0, 0, 0);

  const chartEnd = new Date(maxDate);
  chartEnd.setHours(0, 0, 0, 0);

  // FIX: Stop if today is before start OR after end
  if (today < chartStart || today > chartEnd) return;

  const diffTime = today - chartStart;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  const leftPos = diffDays * scale;

  const line = document.createElement("div");
  line.className = "today-line";
  line.style.left = leftPos + "px";
  // Optional: Add a label on top of the line
  line.title = `Today: ${today.toLocaleDateString()}`;

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
  const [minD, maxD] = getBounds(minDate); // We get maxD here
  const totalDays = daysBetween(minD, maxD) + 1;
  const width = totalDays * scale;

  taskLeftList.innerHTML = "";
  rowsRight.innerHTML = "";
  timelineHeader.innerHTML = "";
  depOverlay.innerHTML = "";

  const criticalSet = showCriticalPath ? computeCriticalPath(tasks) : null;

  buildTimelineHeader(timelineHeader, minD, totalDays);
  buildRows(taskLeftList, rowsRight, minD, width, criticalSet);

  // FIX: Pass 'maxD' here so it knows when to stop drawing
  drawTodayLine(minD, maxD, scale, depOverlay);

  requestAnimationFrame(() => {
    syncRowHeights(taskLeftList, rowsRight);
    repositionBarLabels(rowsRight);
    drawDeps(minD, scale, width, rowsRight);
  });
}

/* --------------------------------------------------------------------------
   Calculate timeline bounds (Strict Data Range)
----------------------------------------------------------------------------*/
function getBounds(minOverride) {
  // If no tasks, show a default small window around today
  if (!tasks.length) return [addDays(new Date(), -3), addDays(new Date(), 10)];

  let min = tasks[0].start;
  let max = tasks[0].end;

  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
    if (t.end > max) max = t.end;
  });

  // Returns exactly the project limits + small buffer
  return [minOverride, addDays(max, 3)];
}

/* --------------------------------------------------------------------------
   Build timeline header (Month, Date, AND D-Day)
----------------------------------------------------------------------------*/
function buildTimelineHeader(timelineHeader, minDate, totalDays) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";

  // 1. Month Row
  const monthRow = document.createElement("div");
  monthRow.style.display = "flex";
  monthRow.style.height = "20px";
  monthRow.style.backgroundColor = "#f8fafc";
  monthRow.style.borderBottom = "1px solid #e2e8f0";

  // 2. Day Row (Actual Date)
  const dayRow = document.createElement("div");
  dayRow.style.display = "flex";
  dayRow.style.height = "24px"; // Slightly reduced height
  dayRow.style.backgroundColor = "#ffffff";
  dayRow.style.borderBottom = "1px solid #f1f5f9";

  // 3. NEW: Relative "D-Day" Row
  const relRow = document.createElement("div");
  relRow.style.display = "flex";
  relRow.style.height = "20px";
  relRow.style.backgroundColor = "#f8fafc";
  relRow.style.borderBottom = "1px solid #cbd5e1"; // Stronger border for grid separation

  // Get Project Start Date to calculate D1, D2...
  const projectStart = getProjectStartDate();

  let currentMonth = minDate.getMonth();
  let currentYear = minDate.getFullYear();
  let monthStartIndex = 0;

  for (let i = 0; i < totalDays; i++) {
    const d = addDays(minDate, i);

    // --- DAY CELL (1, 2, 3...) ---
    const dayCell = document.createElement("div");
    dayCell.classList.add("day-cell");
    dayCell.style.width = scale + "px";
    dayCell.style.display = "flex";
    dayCell.style.alignItems = "center";
    dayCell.style.justifyContent = "center";
    dayCell.style.fontSize = "12px";
    dayCell.style.fontWeight = "600";
    dayCell.style.color = "#334155";
    dayCell.textContent = d.getDate();
    // Highlight weekends slightly
    if (d.getDay() === 0 || d.getDay() === 6) {
      dayCell.style.backgroundColor = "#e3e5e9ff";
      dayCell.style.color = "#94a3b8";
    }
    dayRow.appendChild(dayCell);

    // --- RELATIVE CELL (D1, D2...) ---
    const relCell = document.createElement("div");
    relCell.style.width = scale + "px";
    relCell.style.display = "flex";
    relCell.style.alignItems = "center";
    relCell.style.justifyContent = "center";
    relCell.style.fontSize = "10px";
    relCell.style.color = "#64748b";

    // Calculate Day Number
    const dayNum = daysBetween(projectStart, d) + 1;

    // Only show "D#" if it's Day 1 or later

    relCell.textContent = `D${dayNum}`;
    relCell.style.fontWeight = "500";

    // Highlight weekends in this row too
    if (d.getDay() === 0 || d.getDay() === 6) {
      relCell.style.backgroundColor = "#e3e5e9ff";
    }

    relRow.appendChild(relCell);

    // --- MONTH CELL LOGIC ---
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
      monthCell.style.justifyContent = "center"; // Center label
      monthCell.style.fontWeight = "bold";
      monthCell.style.fontSize = "11px";
      monthCell.style.color = "#475569";
      monthCell.style.borderRight = "1px solid #e2e8f0";
      monthCell.style.boxSizing = "border-box";

      const blockDate = addDays(minDate, monthStartIndex);
      monthCell.textContent = blockDate.toLocaleString("default", {
        month: "long",
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
  wrapper.appendChild(relRow); // Add the new row
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

    // --- LEFT ROW ---
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
      <div class="task-skill" 
      title="${task.skill || "No Skills"}" 
      style="
        width: 60px; 
        font-size: 10px; 
        font-weight: 600; 
        color: #475569; 
        text-align: center; 
        border: 1px solid #e2e8f0; 
        border-radius: 4px; 
        padding: 2px 0; 
        background: #f8fafc; 
        margin-right: 6px;
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        cursor: pointer;
      ">
  ${task.skill || "-"}
</div>
      <select class="task-status" data-id="${task.id}" 
              style="background:${getStatusBg(task.status)};">
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
    // 1. SELECT THE SKILL CELL
    const skillCell = leftRow.querySelector(".task-skill");

    statusSelect.addEventListener("change", (e) => {
      pushHistory();
      const newStatus = e.target.value;
      task.status = newStatus;
      statusSelect.style.background = getStatusBg(newStatus);
      window.dispatchEvent(new CustomEvent("localchange"));
      render();
    });

    // 2. ADD 'skillCell' TO THIS LIST
    // This stops the "Drag Row" logic from firing when you click these elements
    [delBtn, insBtn, statusSelect, skillCell].forEach((el) => {
      if (el) {
        el.addEventListener("mousedown", (e) => e.stopPropagation());
      }
    });
    statusSelect.addEventListener("change", (e) => {
      pushHistory();
      const newStatus = e.target.value;
      task.status = newStatus;
      statusSelect.style.background = getStatusBg(newStatus);
      window.dispatchEvent(new CustomEvent("localchange"));
      render();
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

    // --- DATE EDITING LOGIC ---
    const startInput = leftRow.querySelector(".day-edit-start");
    const endInput = leftRow.querySelector(".day-edit-end");
    const parseDay = (val) => {
      const num = parseInt(val.replace(/[^\d]/g, ""), 10);
      return isNaN(num) ? 0 : num;
    };
    const handleStartEdit = () => {
      const val = parseDay(startInput.value);
      if (!val || val < 1) return render();
      pushHistory();
      const duration = daysBetween(task.start, task.end);
      const newStart = addDays(projectStart, val - 1);
      task.start = newStart;
      task.end = addDays(newStart, duration);
      window.dispatchEvent(new CustomEvent("localchange"));
      applyDependencies();
      render();
      import("./app.js").then((m) => m.refreshDependencyDropdown());
    };
    const handleEndEdit = () => {
      const val = parseDay(endInput.value);
      if (!val || val < 1) return render();
      pushHistory();
      const newEnd = addDays(projectStart, val - 1);
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
    [startInput, endInput].forEach((input) => {
      input.onfocus = () => {
        input.value = parseDay(input.value);
        input.select();
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") render();
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

    /* ----------------------------------------------------------------------
       UPDATED TOOLTIP LOGIC (Skill + Dependency + Remarks)
    ---------------------------------------------------------------------- */
    bar.addEventListener("mousemove", () => {
      const t = tasks.find((x) => x.id === bar.dataset.id);
      if (!t) {
        tooltip.style.opacity = 0;
        return;
      }

      // --- 1. PREPARE DEPENDENCY DATA ---
      const parent = tasks.find((x) => x.id === t.depends);
      const lag = Number.isFinite(t.lagDays) ? t.lagDays : 0;
      const lead = Number.isFinite(t.leadDays) ? t.leadDays : 0;
      const depType = t.depType || "FS";
      const netOffset = lag - lead;

      let depHtml = "";
      if (t.depends && parent) {
        depHtml = `
        <div style="margin-top:6px; padding-top:6px; border-top:1px solid #334155;">
           <div style="margin-bottom:2px;">
             <span style="color:#94a3b8">Depends On:</span> 
             <span style="color:#f59e0b; font-weight:600;">${escapeHtml(
               parent.title
             )}</span>
           </div>
           <div>
             <span style="color:#94a3b8">Type:</span> <strong>${depType}</strong> 
             &nbsp;|&nbsp; 
             <span style="color:#94a3b8">Offset:</span> <strong>${
               netOffset > 0 ? "+" : ""
             }${netOffset}d</strong>
           </div>
        </div>`;
      }

      // --- 2. PREPARE REMARKS HTML (NEW) ---
      // Only show if remarks actually exist
      const remarksHtml = t.remarks
        ? `<div style="margin-top:6px; padding-top:4px; border-top:1px dashed #334155; color:#e2e8f0; font-style:italic; font-size:11px;">
             📝 ${escapeHtml(t.remarks)}
           </div>`
        : "";

      // --- 3. BUILD TOOLTIP HTML ---
      tooltip.innerHTML = `
        <div style="font-weight:600; margin-bottom:6px; font-size:13px; color:#ffffff; border-bottom: 1px solid #334155; padding-bottom: 4px;">
          ${escapeHtml(t.title)}
        </div>

        <div style="font-size:12px; color:#cbd5e1; line-height:1.5">
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
             <span><span style="color:#94a3b8">Status:</span> <strong>${
               t.status
             }</strong></span>
             <span><span style="color:#94a3b8">Skill:</span> <strong style="color: #60a5fa;">${
               t.skill || "-"
             }</strong></span>
          </div>

          <div>
            <span style="color:#94a3b8">Timeline:</span> 
            <strong>Day ${daysBetween(projectStart, t.start) + 1} - Day ${
        daysBetween(projectStart, t.end) + 1
      }</strong>
            <span style="color:#64748b; font-size: 11px;"> (${
              daysBetween(t.start, t.end) + 1
            }d)</span>
          </div>

          ${depHtml}
          
          ${remarksHtml} </div>`;

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
  attachSkillEditing();
}

// ... syncRowHeights, repositionBarLabels, helpers ...
function syncRowHeights(leftContainer, rightContainer) {
  const leftRows = leftContainer.querySelectorAll(".unified-row");
  const rightRows = rightContainer.querySelectorAll(".unified-row");
  rightRows.forEach((rightRow, i) => {
    const leftH = leftRows[i]?.offsetHeight || 35;
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
