// renderer.js — UI construction and rendering logic

import { daysBetween, addDays, formatDate } from "./utils.js";
import { tasks, scale } from "./state.js";
import { drawDependencies } from "./deps.js";
import { makeDraggable } from "./drag.js";
import { enableDurationEditing } from "./edit.js";

/**
 * Main render function — builds the full gantt view
 *
 * @param {*} taskLeftList   DOM container for left rows
 * @param {*} rowsRight      DOM container for right rows
 * @param {*} timelineHeader DOM container for date headers
 * @param {*} depOverlay     Dependency overlay container
 * @param {*} minDate        Start bound of display
 */
export function render(taskLeftList, rowsRight, timelineHeader, depOverlay, minDate) {

    // Clear existing content
    taskLeftList.innerHTML = "";
    rowsRight.innerHTML = "";
    depOverlay.innerHTML = "";

    // Determine grid width
    const maxDate = getMaxDate(tasks);
    const totalDays = daysBetween(minDate, maxDate) + 1;
    const width = totalDays * scale;

    // =============================
    // Build timeline header (dates)
    // =============================
    timelineHeader.innerHTML = "";

    const headRow = document.createElement("div");
    headRow.style.display = "flex";
    headRow.style.minWidth = width + "px";

    for (let i = 0; i < totalDays; i++) {
        const d = addDays(minDate, i);
        const cell = document.createElement("div");
        cell.style.width = scale + "px";
        cell.style.display = "flex";
        cell.style.alignItems = "center";
        cell.style.justifyContent = "center";
        cell.style.height = "30px";
        cell.style.borderRight = "1px solid rgba(0,0,0,0.06)";
        cell.textContent = d.getDate();
        headRow.appendChild(cell);
    }

    timelineHeader.appendChild(headRow);

    const barHeight =
        parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue("--bar-height")) || 20;

    // =============================
    // Build task rows + gantt bars
    // =============================
    tasks.forEach((task, idx) => {

        // ----- LEFT ROW -----
        const leftRow = document.createElement("div");
        leftRow.className = "unified-row";

        leftRow.innerHTML = `
            <div class="row-left">
                <div class="index">${idx + 1}</div>
                <div class="task-title">${task.title}</div>
                <div class="task-dur" data-id="${task.id}">
                    <span class="dur-text">${daysBetween(task.start, task.end) + 1}d</span>
                </div>
                <div class="task-dates">${formatDate(task.start)} → ${formatDate(task.end)}</div>
            </div>
        `;

        taskLeftList.appendChild(leftRow);

        // ----- RIGHT ROW -----
        const rightRow = document.createElement("div");
        rightRow.className = "unified-row";

        const rightCell = document.createElement("div");
        rightCell.className = "row-right";

        const grid = document.createElement("div");
        grid.className = "row-grid";
        grid.style.minWidth = width + "px";

        // Create bar
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.dataset.id = task.id;

        const leftDays = daysBetween(minDate, task.start);
        const span = daysBetween(task.start, task.end) + 1;

        bar.style.left = leftDays * scale + "px";
        bar.style.width = span * scale + "px";
        bar.style.height = barHeight + "px";
        bar.style.fontSize = "12px";

        bar.innerHTML = `
            <div class="handle left"></div>
            <div class="label">${task.title}</div>
            <div class="handle right"></div>
        `;

        grid.appendChild(bar);
        rightCell.appendChild(grid);
        rightRow.appendChild(rightCell);
        rowsRight.appendChild(rightRow);

        // Make this bar draggable/resizable
        makeDraggable(bar);
    });

    // =============================
    // Match right row height to left row height
    // =============================
    requestAnimationFrame(() => {
        const leftRows = taskLeftList.querySelectorAll(".unified-row");
        const rightRows = rowsRight.querySelectorAll(".unified-row");

        rightRows.forEach((r, i) => {
            const leftH = leftRows[i]?.offsetHeight ?? 44;

            r.style.height = leftH + "px";

            const cell = r.querySelector(".row-right");
            if (cell) cell.style.height = leftH + "px";

            const grid = r.querySelector(".row-grid");
            if (grid) grid.style.height = leftH + "px";

            const bar = r.querySelector(".bar");
            if (bar) {
                const barH = bar.offsetHeight;
                bar.style.top = Math.round((leftH - barH) / 2) + "px";
            }
        });

        drawDependencies(minDate, width, rowsRight);
    });

    // Allow duration editing
    enableDurationEditing(taskLeftList);
}

// =============================
// Helper: Get overall max end date
// =============================
function getMaxDate(list) {
    if (!list.length) return addDays(new Date(), 3);
    let max = list[0].end;
    list.forEach(t => { if (t.end > max) max = t.end; });
    return addDays(max, 3);
}
