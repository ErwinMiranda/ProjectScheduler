// renderer.js — builds UI, rows, bars, labels and dependency lines
import { saveTask } from "./firebase.js";
import { applyDependencies } from "./app.js";
import { tasks, selectedBars } from "./state.js";
import { daysBetween, formatDate, addDays } from "./utils.js";
import { drawDeps } from "./deps.js";
import { makeDraggable, makeLeftRowDraggable } from "./drag.js";
import { attachDurationEditing, attachTitleEditing } from "./edit.js";

let scale = 36;

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

  buildTimelineHeader(timelineHeader, minD, totalDays);
  buildRows(taskLeftList, rowsRight, minD, width);

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
    dayCell.classList.add("day-cell"); // <-- added for highlighting
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
function buildRows(taskLeftList, rowsRight, minDate, width) {
  const barH =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--bar-height"
      )
    ) || 20;

  tasks.forEach((task, idx) => {
    /* ---------------- LEFT ROW ----------------- */
    const leftRow = document.createElement("div");
    leftRow.className = "unified-row";

    leftRow.innerHTML = `
      <div class="row-left">
        <div class="index">${idx + 1}</div>
        <div class="task-title">${task.title}</div>
        <div class="task-dur" data-id="${task.id}">
          <span>${daysBetween(task.start, task.end) + 1}d</span>
        </div>
        <div class="task-dates">${formatDate(task.start)} → ${formatDate(
      task.end
    )}</div>
      </div>
    `;

    taskLeftList.appendChild(leftRow);
    makeLeftRowDraggable(leftRow, task.id);

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

    /* ---------------- LABEL AFTER BAR (OPTION A) ---------------- */
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

    /* Double-click unlink */
    bar.addEventListener("dblclick", async (e) => {
      e.stopPropagation();
      const t = tasks.find((x) => x.id === task.id);
      if (!t || !t.depends) return;

      t.depends = "";
      await saveTask(t);
      applyDependencies();
      render();
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
    const leftH = leftRows[i].offsetHeight;
    rightRow.style.height = leftH + "px";

    const grid = rightRow.querySelector(".row-grid");
    if (grid) grid.style.height = leftH + "px";

    const bar = rightRow.querySelector(".bar");
    if (bar) bar.style.top = Math.round((leftH - bar.offsetHeight) / 2) + "px";
  });
}

/* --------------------------------------------------------------------------
   EXACT SAME LABEL POSITION AS BEFORE (OPTION A)
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
