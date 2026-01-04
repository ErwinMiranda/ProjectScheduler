// deps.js — draws curved dependency lines between bars

import { tasks } from "./state.js";
import { daysBetween, addDays } from "./utils.js";

/**
 * Draw dependency arrows inside rowsRight container
 */
export function drawDeps(minDate, scale, width, rowsRight) {
  // Clear old SVG if exists
  const prev = rowsRight.querySelector("svg.__deps_svg");
  if (prev) prev.remove();

  if (!tasks.length) return;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");

  svg.classList.add("__deps_svg");
  svg.setAttribute("width", width + "px");
  svg.setAttribute("height", rowsRight.scrollHeight + "px");
  svg.style.position = "absolute";
  svg.style.left = "0px";
  svg.style.top = "0px";
  svg.style.pointerEvents = "none";
  svg.style.overflow = "visible";
  svg.style.zIndex = 2;

  tasks.forEach((t, i) => {
    if (!t.depends) return;

    const parent = tasks.find((x) => x.id === t.depends);
    if (!parent) return;

    const pIndex = tasks.indexOf(parent);
    const cIndex = i;

    const pRow = rowsRight.children[pIndex];
    const cRow = rowsRight.children[cIndex];

    if (!pRow || !cRow) return;

    const parentStartX = daysBetween(minDate, parent.start) * scale;
    const parentEndX = (daysBetween(minDate, parent.end) + 1) * scale;

    const childStartX = daysBetween(minDate, t.start) * scale;

    const px = t.depType === "SS" ? parentStartX : parentEndX;

    const tx = childStartX;

    const py = pRow.offsetTop + pRow.offsetHeight / 2;
    const ty = cRow.offsetTop + cRow.offsetHeight / 2;

    const path = document.createElementNS(svgNS, "path");

    const dx = tx - px;
    const dy = ty - py;

    let d;

    // 🔑 CASE 1: Almost vertical (SS aligned, or very close)
    if (Math.abs(dx) < 20) {
      const midY = py + dy / 2;

      d = `
    M ${px} ${py}
    C ${px} ${midY},
      ${tx} ${midY},
      ${tx} ${ty}
  `;
    }
    // 🔑 CASE 2: Normal curved dependency
    else {
      const dirX = Math.sign(dx);
      const dirY = Math.sign(dy);

      const bendX = Math.min(60, Math.abs(dx) / 2);
      const bendY = Math.min(40, Math.abs(dy) / 2);

      const c1x = px + bendX * dirX;
      const c2x = tx - bendX * dirX;

      const c1y = py + bendY * dirY;
      const c2y = ty - bendY * dirY;

      d = `
    M ${px} ${py}
    C ${c1x} ${c1y},
      ${c2x} ${c2y},
      ${tx} ${ty}
  `;
    }

    path.setAttribute("d", d);

    path.setAttribute("stroke", "#94a3b8");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", "1.5");

    svg.appendChild(path);
  });

  rowsRight.appendChild(svg);
}
