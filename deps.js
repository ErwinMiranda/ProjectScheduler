// deps.js — draws curved dependency lines between bars

import { tasks } from "./state.js";
import { daysBetween, addDays } from "./utils.js";

/**
 * Draw dependency arrows inside rowsRight container
 */
/* ============================================================
   DRAW DEPENDENCIES (SVG Overlay)
   - Fixed: Finds DOM elements by ID instead of Array Index
   - Prevents scattering when filtering
============================================================ */

export function drawDeps(minDate, scale, width, rowsRight) {
  // 1. Clear Old SVG
  const prev = rowsRight.querySelector("svg.__deps_svg");
  if (prev) prev.remove();

  // If no tasks, nothing to draw
  if (!tasks || !tasks.length) return;

  // 2. Setup SVG Container
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");

  svg.classList.add("__deps_svg");
  svg.setAttribute("width", width + "px");
  svg.setAttribute("height", rowsRight.scrollHeight + "px");

  Object.assign(svg.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    pointerEvents: "none",
    overflow: "visible",
    zIndex: "2",
  });

  // 3. Get Container Coordinates for calculation
  const containerRect = rowsRight.getBoundingClientRect();

  tasks.forEach((t) => {
    // Only proceed if task has a dependency
    if (!t.depends) return;

    const parent = tasks.find((x) => x.id === t.depends);
    if (!parent) return;

    // --- CRITICAL FIX START ---
    // Instead of using array index, find the exact DOM elements by ID
    const elParentBar = rowsRight.querySelector(`.bar[data-id="${parent.id}"]`);
    const elChildBar = rowsRight.querySelector(`.bar[data-id="${t.id}"]`);

    // If either bar is hidden (filtered out), SKIP drawing this line
    if (!elParentBar || !elChildBar) return;
    // --- CRITICAL FIX END ---

    // 4. Calculate X Coordinates (Based on Date Logic)
    // We use the data logic for X to ensure it matches the grid exactly
    const parentStartX = daysBetween(minDate, parent.start) * scale;
    const parentEndX = (daysBetween(minDate, parent.end) + 1) * scale;
    const childStartX = daysBetween(minDate, t.start) * scale;

    const px = t.depType === "SS" ? parentStartX : parentEndX;
    const tx = childStartX;

    // 5. Calculate Y Coordinates (Based on DOM Position)
    // We use getBoundingClientRect to handle scrolling and relative positions accurately
    const pRect = elParentBar.getBoundingClientRect();
    const cRect = elChildBar.getBoundingClientRect();

    // Calculate Y relative to the SVG/Container top (accounting for scroll)
    const py =
      pRect.top - containerRect.top + rowsRight.scrollTop + pRect.height / 2;
    const ty =
      cRect.top - containerRect.top + rowsRight.scrollTop + cRect.height / 2;

    // 6. Draw the Path (Curved Logic)
    const path = document.createElementNS(svgNS, "path");
    const dx = tx - px;
    const dy = ty - py;
    let d;

    // Case 1: Vertical-ish align (S-Curve)
    if (Math.abs(dx) < 20) {
      const midY = py + dy / 2;
      d = `M ${px} ${py} C ${px} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
    }
    // Case 2: Standard Curve
    else {
      const dirX = Math.sign(dx);
      const dirY = Math.sign(dy);
      const bendX = Math.min(60, Math.abs(dx) / 2);
      const bendY = Math.min(40, Math.abs(dy) / 2);

      const c1x = px + bendX * dirX;
      const c2x = tx - bendX * dirX; // Control point pulls back

      // Simplify curve logic for standard Gantt look
      d = `M ${px} ${py} C ${px + 20} ${py}, ${tx - 20} ${ty}, ${tx} ${ty}`;
    }

    path.setAttribute("d", d);
    path.setAttribute("stroke", "#94a3b8");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", "1.5");

    svg.appendChild(path);
  });

  rowsRight.appendChild(svg);
}
