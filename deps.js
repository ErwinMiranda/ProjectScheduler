// deps.js — Draws dependency lines between tasks

import { daysBetween } from "./utils.js";
import { tasks, scale } from "./state.js";

/**
 * Draws dependency connection paths inside the right-side SVG overlay
 *
 * @param {*} minDate   left boundary date
 * @param {*} width     pixel width of timeline grid
 * @param {*} rowsRight DOM container containing bar rows
 */
export function drawDependencies(minDate, width, rowsRight) {

    // Remove old dependency SVG
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
    svg.style.zIndex = 2;

    // Draw a path for every dependency
    tasks.forEach((t, i) => {

        if (!t.depends) return;

        const parent = tasks.find(x => x.id === t.depends);
        if (!parent) return;

        const pIndex = tasks.indexOf(parent);
        const childIndex = i;

        const parentRow = rowsRight.children[pIndex];
        const childRow = rowsRight.children[childIndex];

        if (!parentRow || !childRow) return;

        const px = (daysBetween(minDate, parent.end) + 1) * scale;
        const tx = daysBetween(minDate, t.start) * scale;

        const py = parentRow.offsetTop + parentRow.offsetHeight / 2;
        const ty = childRow.offsetTop + childRow.offsetHeight / 2;

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
