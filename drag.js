// drag.js — Free drag + resizing + row move + cascading FS dependencies
// OFFLINE-FIRST PATCH: Every modification now fires localchange event.

import { pushHistory } from "./state.js";
import { tasks, selectedBars } from "./state.js";
import { addDays } from "./utils.js";
import { render } from "./renderer.js";

/* ============================================================
   MAKE A BAR DRAGGABLE
============================================================ */
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

  /* ------------------------------------------------------------
     HANDLE RESIZE — disable drag, allow ctrl-select
  ------------------------------------------------------------ */
  if (leftHandle) {
    leftHandle.addEventListener("mousedown", (e) => {
      if (e.ctrlKey) {
        toggleSelect(el);
        return;
      }
      e.stopPropagation();
      startResize("left", e);
    });
  }

  if (rightHandle) {
    rightHandle.addEventListener("mousedown", (e) => {
      if (e.ctrlKey) {
        toggleSelect(el);
        return;
      }
      e.stopPropagation();
      startResize("right", e);
    });
  }

  /* ------------------------------------------------------------
     START DRAG
  ------------------------------------------------------------ */
  el.addEventListener("mousedown", (e) => {
    if (e.ctrlKey) {
      toggleSelect(el);
      return;
    }
    if (e.target.classList.contains("handle")) return;

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

  /* ------------------------------------------------------------
     MOVE DRAG (5px threshold)
  ------------------------------------------------------------ */
  function moveDrag(e) {
    if (!dragging) return;

    const dxTotal = Math.abs(e.clientX - startX);
    const dyTotal = Math.abs(e.clientY - startY);

    if (!moved) {
      if (dxTotal < 5 && dyTotal < 5) return;

      moved = true;

      const rect = el.getBoundingClientRect();
      el.style.position = "fixed";
      el.style.left = rect.left + "px";
      el.style.top = rect.top + "px";
      el.style.zIndex = 9999;
    }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    el.style.left = origLeft + dx + "px";
    el.style.top = origTop + dy + "px";

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

    const rowsRight = document.querySelector("#rowsRight");
    const gridLeft = rowsRight.getBoundingClientRect().left;
    const leftPx = barRect.left - gridLeft;
    const dayIndex = Math.max(0, Math.floor(leftPx / scale));

    highlightDay(dayIndex);
  }

  /* ------------------------------------------------------------
     END DRAG — update date, update row, cascade children
  ------------------------------------------------------------ */
  async function endDrag() {
    window.removeEventListener("mousemove", moveDrag);
    window.removeEventListener("mouseup", endDrag);
    document.body.style.userSelect = "auto";

    if (!dragging) return;
    dragging = false;

    if (!moved) {
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
    clearHeaderHighlights();

    const oldStart = new Date(task.start);

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

    /* --- Change row order (local only) --- */
    if (useIndex !== origRowIndex) {
      pushHistory();

      tasks.splice(origRowIndex, 1);
      tasks.splice(useIndex, 0, task);
      tasks.forEach((t, i) => (t.row = i));

      window.dispatchEvent(new CustomEvent("localchange"));
    }

    const leftDays = Math.round(leftRelative / scale);
    const span = Math.max(1, Math.round(el.offsetWidth / scale));

    task.start = addDays(findMinDate(), leftDays);
    task.end = addDays(task.start, span - 1);

    /* --- Mark this as a local edit --- */
    window.dispatchEvent(new CustomEvent("localchange"));

    /* ---------------------------------------------------------
       CASCADING SHIFT (FS + lead/lag)
    --------------------------------------------------------- */
    const deltaDays = Math.round((task.start - oldStart) / 86400000);

    if (deltaDays !== 0) {
      await import("./app.js").then((m) =>
        m.shiftChildren(task.id, deltaDays, { force: true })
      );

      window.dispatchEvent(new CustomEvent("localchange"));
    }

    el.style.position = "absolute";
    el.style.left = leftRelative + "px";
    el.style.top =
      Math.round((targetRow.offsetHeight - el.offsetHeight) / 2) + "px";
    el.style.zIndex = 5;

    render();

    import("./app.js").then((m) => m.refreshDependencyDropdown());
  }

  /* ============================================================
     RESIZING
  ============================================================ */
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

      const gridRect = rowGrid.getBoundingClientRect();
      const barRect = el.getBoundingClientRect();

      let leftRelative = barRect.left - gridRect.left;
      if (rowGrid.scrollLeft) leftRelative += rowGrid.scrollLeft;

      const leftDays = Math.round(leftRelative / scale);
      const span = Math.max(1, Math.round(el.offsetWidth / scale));

      pushHistory();

      task.start = addDays(findMinDate(), leftDays);
      task.end = addDays(task.start, span - 1);

      /* --- mark as unsaved/local --- */
      window.dispatchEvent(new CustomEvent("localchange"));

      render();
      import("./app.js").then((m) => m.refreshDependencyDropdown());
    }

    window.addEventListener("mousemove", moveResize);
    window.addEventListener("mouseup", endResize);
  }
}

/* ============================================================
   LEFT PANEL DRAG (row reorder)
============================================================ */
export function makeLeftRowDraggable(leftRow, id) {
  let dragging = false;
  let moved = false;

  let origRowIndex = null;
  let targetRowIndex = null;

  leftRow.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "INPUT") return;

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

    targetRowIndex = origRowIndex;
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

    pushHistory();

    tasks.splice(origRowIndex, 1);
    tasks.splice(targetRowIndex, 0, movedTask);
    tasks.forEach((t, i) => (t.row = i));

    window.dispatchEvent(new CustomEvent("localchange"));

    clearHeaderHighlights();
    render();
    import("./app.js").then((m) => m.refreshDependencyDropdown());
  }
}

/* ============================================================
   HELPERS
============================================================ */
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

function highlightDay(index) {
  const days = document.querySelectorAll("#timelineHeader .day-cell");
  days.forEach((d, i) => {
    if (i === index) d.classList.add("day-highlight");
    else d.classList.remove("day-highlight");
  });
}

function highlightIndex(index) {
  const idxEls = document.querySelectorAll("#taskLeftList .index");
  idxEls.forEach((el, i) => {
    if (i === index) el.classList.add("index-highlight");
    else el.classList.remove("index-highlight");
  });
}

function clearHeaderHighlights() {
  document
    .querySelectorAll(".day-highlight")
    .forEach((el) => el.classList.remove("day-highlight"));
  document
    .querySelectorAll(".index-highlight")
    .forEach((el) => el.classList.remove("index-highlight"));
}
