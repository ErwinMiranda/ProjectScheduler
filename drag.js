// drag.js — Bar movement + resizing logic

import { daysBetween, addDays } from "./utils.js";
import { tasks, scale } from "./state.js";
import { saveTask } from "./firebase.js";
import { applyDependencies, refresh } from "./app.js";

export function makeDraggable(el) {
  let dragging = false,
      mode = null,
      startX = 0,
      origLeft = 0,
      origWidth = 0;

  const id = el.dataset.id;
  const leftHandle = el.querySelector(".handle.left");
  const rightHandle = el.querySelector(".handle.right");

  // Attach handlers
  leftHandle.addEventListener("mousedown", e => start("left", e));
  rightHandle.addEventListener("mousedown", e => start("right", e));
  el.addEventListener("mousedown", e => start("move", e));

  function start(m, e) {
    e.preventDefault();
    dragging = true;
    mode = m;
    startX = e.clientX;
    origLeft = parseFloat(el.style.left) || 0;
    origWidth = parseFloat(el.style.width) || scale;

    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  }

  function move(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;

    if (mode === "move") {
      el.style.left = Math.max(0, origLeft + dx) + "px";

    } else if (mode === "left") {
      const newLeft = origLeft + dx;
      const newWidth = origWidth - dx;
      el.style.left = Math.max(0, newLeft) + "px";
      el.style.width = Math.max(scale, newWidth) + "px";

    } else if (mode === "right") {
      el.style.width = Math.max(scale, origWidth + dx) + "px";
    }
  }

  async function end() {
    dragging = false;
    document.body.style.userSelect = "auto";
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", end);

    // Update task dates based on new bar position
    const leftPx = parseFloat(el.style.left);
    const widthPx = parseFloat(el.style.width);

    const leftDays = Math.round(leftPx / scale);
    const spanDays = Math.max(1, Math.round(widthPx / scale));

    const t = tasks.find(x => x.id === id);
    if (!t) return;

    const minDate = refresh.computeMinDate
      ? refresh.computeMinDate()
      : new Date(); // Fail-safe fallback

    t.start = addDays(minDate, leftDays);
    t.end = addDays(t.start, spanDays - 1);

    applyDependencies();
    refresh();

    try {
      await saveTask(t);
    } catch (err) {
      console.error("Save failed:", err);
    }
  }
}
