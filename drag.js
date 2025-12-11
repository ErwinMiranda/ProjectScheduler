// drag.js — TRUE FREE DRAG & DROP with threshold + highlight + handle fixes
import { pushHistory } from "./state.js";
import { tasks, selectedBars } from "./state.js";
import { addDays } from "./utils.js";
import { render } from "./renderer.js";
import { saveTask } from "./firebase.js";

/**
 * Enable FREE drag and drop on a bar element
 */
export function makeDraggable(el) {
  let dragging = false;
  let moved = false;

  let startX = 0;
  let startY = 0;

  let origLeft = 0;
  let origTop = 0;

  let origRowIndex = null;
  let targetRowIndex = null;

  const scale = 36;
  const id = el.dataset.id;

  const leftHandle = el.querySelector(".handle.left");
  const rightHandle = el.querySelector(".handle.right");

  // ============================================================
  // RESIZE HANDLES — FIXED (no drag, but allow ctrl+click select)
  // ============================================================
  leftHandle.addEventListener("mousedown", (e) => {
    if (e.ctrlKey) {
      toggleSelect(el);
      return;
    }
    e.stopPropagation(); // ⛔ prevent bar drag
    startResize("left", e);
  });

  rightHandle.addEventListener("mousedown", (e) => {
    if (e.ctrlKey) {
      toggleSelect(el);
      return;
    }
    e.stopPropagation(); // ⛔ prevent bar drag
    startResize("right", e);
  });

  // ============================================================
  // START FREE DRAG — but DO NOT float yet (threshold first)
  // ============================================================
  el.addEventListener("mousedown", (e) => {
    // allow ctrl+click to select even on bar body
    if (e.ctrlKey) {
      toggleSelect(el);
      return;
    }

    e.preventDefault();

    dragging = true;
    moved = false;

    startX = e.clientX;
    startY = e.clientY;

    const rect = el.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;

    const rows = [...document.querySelectorAll("#rowsRight .unified-row")];
    origRowIndex = rows.findIndex((r) => r.contains(el));

    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("mouseup", endDrag);
  });

  // ============================================================
  // MOVE DRAG — applies threshold before starting drag
  // ============================================================
  function moveDrag(e) {
    if (!dragging) return;

    const dxTotal = Math.abs(e.clientX - startX);
    const dyTotal = Math.abs(e.clientY - startY);

    // DRAG THRESHOLD (5px)
    if (!moved) {
      if (dxTotal < 5 && dyTotal < 5) return;

      moved = true;

      // ⭐ now float bar — drag begins
      const rect = el.getBoundingClientRect();
      el.style.position = "fixed";
      el.style.left = rect.left + "px";
      el.style.top = rect.top + "px";
      el.style.zIndex = 9999;
    }

    // free drag movement
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    el.style.left = origLeft + dx + "px";
    el.style.top = origTop + dy + "px";

    // determine target row based on center Y
    const barRect = el.getBoundingClientRect();
    const centerY = barRect.top + barRect.height / 2;

    const rows = [...document.querySelectorAll("#rowsRight .unified-row")];
    const rects = rows.map((r) => r.getBoundingClientRect());

    targetRowIndex = origRowIndex;
    for (let i = 0; i < rects.length; i++) {
      if (centerY >= rects[i].top && centerY < rects[i].bottom) {
        targetRowIndex = i;
        break;
      }
    }

    highlightIndex(targetRowIndex);

    // DAY HIGHLIGHT
    const rowsRight = document.querySelector("#rowsRight");
    const gridLeft = rowsRight.getBoundingClientRect().left;
    const leftPx = barRect.left - gridLeft;
    const dayIndex = Math.max(0, Math.floor(leftPx / scale));

    highlightDay(dayIndex);
  }

  // ============================================================
  // END DRAG — apply row and date changes
  // ============================================================
  async function endDrag() {
    document.body.style.userSelect = "auto";
    window.removeEventListener("mousemove", moveDrag);
    window.removeEventListener("mouseup", endDrag);

    if (!dragging) return;
    dragging = false;

    if (!moved) {
      // pure click — no drag at all
      clearHeaderHighlights();
      el.style.position = "absolute";
      return;
    }

    const task = tasks.find((t) => t.id === id);
    if (!task) {
      clearHeaderHighlights();
      render();
      return;
    }

    pushHistory();

    // find target row
    const rightRows = [...document.querySelectorAll("#rowsRight .unified-row")];
    const useIndex =
      targetRowIndex != null ? targetRowIndex : origRowIndex ?? 0;

    const targetRow =
      rightRows[Math.max(0, Math.min(useIndex, rightRows.length - 1))];

    const rowGrid = targetRow.querySelector(".row-grid");

    const gridRect = rowGrid.getBoundingClientRect();
    const barRect = el.getBoundingClientRect();

    let leftRelative = barRect.left - gridRect.left;
    if (rowGrid.scrollLeft) leftRelative += rowGrid.scrollLeft;

    leftRelative = Math.max(
      0,
      Math.min(leftRelative, rowGrid.offsetWidth - el.offsetWidth)
    );

    // move task to new row
    if (useIndex !== origRowIndex) {
      tasks.splice(origRowIndex, 1);
      tasks.splice(useIndex, 0, task);
      tasks.forEach((t, i) => (t.row = i));
    }

    // date calculation
    const leftDays = Math.round(leftRelative / scale);
    const span = Math.max(1, Math.round(el.offsetWidth / scale));

    task.start = addDays(findMinDate(), leftDays);
    task.end = addDays(task.start, span - 1);

    // reset element to absolute
    el.style.position = "absolute";
    el.style.left = leftRelative + "px";
    el.style.top =
      Math.round((targetRow.offsetHeight - el.offsetHeight) / 2) + "px";
    el.style.zIndex = 5;

    for (const t of tasks) await saveTask(t);

    clearHeaderHighlights();
    render();
  }

  // ============================================================
  // RESIZE LOGIC — unchanged except for ctrl+click select
  // ============================================================
  function startResize(side, e) {
    dragging = true;
    moved = false;

    startX = e.clientX;

    const origLeftR = parseFloat(el.style.left) || 0;
    const origWidthR = parseFloat(el.style.width) || el.offsetWidth;

    document.body.style.userSelect = "none";

    function moveResize(ev) {
      moved = true;

      const dx = ev.clientX - startX;

      if (side === "left") {
        el.style.left = Math.max(0, origLeftR + dx) + "px";
        el.style.width = Math.max(scale, origWidthR - dx) + "px";
      } else {
        el.style.width = Math.max(scale, origWidthR + dx) + "px";
      }
    }

    async function endResize() {
      window.removeEventListener("mousemove", moveResize);
      window.removeEventListener("mouseup", endResize);
      document.body.style.userSelect = "auto";

      if (!moved) return;

      const task = tasks.find((t) => t.id === id);

      const rightRows = [
        ...document.querySelectorAll("#rowsRight .unified-row"),
      ];
      const rowIdx = rightRows.findIndex((r) => r.contains(el));
      const row = rightRows[rowIdx];
      const rowGrid = row.querySelector(".row-grid");

      let leftRelative = parseFloat(el.style.left) || 0;

      if (rowGrid) {
        const gridRect = rowGrid.getBoundingClientRect();
        const barRect = el.getBoundingClientRect();
        leftRelative = barRect.left - gridRect.left;
        if (rowGrid.scrollLeft) leftRelative += rowGrid.scrollLeft;
      }

      const leftDays = Math.round(leftRelative / scale);
      const span = Math.max(1, Math.round(el.offsetWidth / scale));

      task.start = addDays(findMinDate(), leftDays);
      task.end = addDays(task.start, span - 1);

      await saveTask(task);
      render();
    }

    window.addEventListener("mousemove", moveResize);
    window.addEventListener("mouseup", endResize);
  }
}

/* ============================================================
   LEFT PANEL DRAG (unchanged but includes index highlight)
==============================================================*/
export function makeLeftRowDraggable(leftRow, id) {
  let dragging = false;
  let moved = false;

  let origRowIndex = null;
  let targetRowIndex = null;

  leftRow.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "INPUT") return;

    e.preventDefault();
    dragging = true;
    moved = false;

    const rows = [...document.querySelectorAll("#taskLeftList .unified-row")];
    origRowIndex = rows.indexOf(leftRow);

    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  });

  function move(e) {
    moved = true;

    const rows = [...document.querySelectorAll("#taskLeftList .unified-row")];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const mouseY = e.clientY;

    for (let i = 0; i < rects.length; i++) {
      if (mouseY >= rects[i].top && mouseY < rects[i].bottom) {
        targetRowIndex = i;
        break;
      }
    }

    highlightIndex(targetRowIndex);
  }

  async function end() {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", end);
    document.body.style.userSelect = "auto";

    if (!dragging) return;
    dragging = false;

    if (!moved) {
      clearHeaderHighlights();
      return;
    }

    const movedTask = tasks.find((t) => t.id === id);

    tasks.splice(origRowIndex, 1);
    tasks.splice(targetRowIndex, 0, movedTask);

    tasks.forEach((t, i) => (t.row = i));

    for (const t of tasks) await saveTask(t);

    clearHeaderHighlights();
    render();
  }
}

/* ============================================================
   Helpers
==============================================================*/
function toggleSelect(el) {
  const id = el.dataset.id;

  if (selectedBars.has(id)) {
    selectedBars.delete(id);
    el.classList.remove("selected");
  } else {
    selectedBars.add(id);
    el.classList.add("selected");
  }
}

function findMinDate() {
  if (!tasks.length) return addDays(new Date(), -3);

  let min = tasks[0].start;
  tasks.forEach((t) => {
    if (t.start < min) min = t.start;
  });

  return addDays(min, -3);
}

function highlightDay(dayIndex) {
  const days = document.querySelectorAll("#timelineHeader .day-cell");
  days.forEach((d, i) =>
    i === dayIndex
      ? d.classList.add("day-highlight")
      : d.classList.remove("day-highlight")
  );
}

function highlightIndex(index) {
  const idxEls = document.querySelectorAll("#taskLeftList .index");
  idxEls.forEach((el, i) =>
    i === index
      ? el.classList.add("index-highlight")
      : el.classList.remove("index-highlight")
  );
}

function clearHeaderHighlights() {
  document
    .querySelectorAll(".day-highlight")
    .forEach((el) => el.classList.remove("day-highlight"));
  document
    .querySelectorAll(".index-highlight")
    .forEach((el) => el.classList.remove("index-highlight"));
}
