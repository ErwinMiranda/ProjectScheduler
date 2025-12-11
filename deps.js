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

    const px = (daysBetween(minDate, parent.end) + 1) * scale;
    const tx = daysBetween(minDate, t.start) * scale;

    const py = pRow.offsetTop + pRow.offsetHeight / 2;
    const ty = cRow.offsetTop + cRow.offsetHeight / 2;

    const path = document.createElementNS(svgNS, "path");

    path.setAttribute(
      "d",
      `M ${px} ${py} C ${px + 40} ${py} ${tx - 40} ${ty} ${tx} ${ty}`
    );

    path.setAttribute("stroke", "#94a3b8");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", "1.5");

    svg.appendChild(path);
  });

  rowsRight.appendChild(svg);
}
