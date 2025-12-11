// edit.js — inline duration editing for left-panel task cells
import { pushHistory } from "./state.js";
import { tasks } from "./state.js";
import { addDays, daysBetween } from "./utils.js";
import { saveTask } from "./firebase.js";
import { applyDependencies } from "./app.js";
import { render } from "./renderer.js";

// edit task name
export function attachTitleEditing() {
  document.querySelectorAll(".task-title").forEach((cell) => {
    cell.ondblclick = () => {
      const id = cell.parentElement.querySelector(".task-dur").dataset.id;
      const task = tasks.find((t) => t.id === id);

      if (!task || cell.querySelector("input")) return;

      const current = task.title;

      cell.innerHTML = `<input type="text" value="${current}" />`;

      const input = cell.querySelector("input");
      input.focus();
      input.select();

      const commit = async () => {
        const value = input.value.trim();
        if (!value) {
          render();
          return;
        }

        pushHistory();
        task.title = value;
        render();

        try {
          await saveTask(task);
        } catch (err) {
          console.error("Failed to update task title:", err);
        }
      };

      input.addEventListener("blur", commit, { once: true });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") render();
      });
    };
  });
}

/**
 * Attach click-to-edit behavior to duration cells
 */
export function attachDurationEditing() {
  document.querySelectorAll(".task-dur").forEach((cell) => {
    cell.onclick = () => {
      const id = cell.dataset.id;
      const task = tasks.find((t) => t.id === id);

      if (!task || cell.querySelector("input")) return;

      const current = daysBetween(task.start, task.end) + 1;

      // Build small number input
      cell.innerHTML = `<input type="number" min="1" value="${current}" />`;

      const input = cell.querySelector("input");
      input.focus();
      input.select();

      const commit = async () => {
        const v = Math.max(1, Number(input.value));

        // Compute new end date based on duration
        pushHistory();
        task.end = addDays(task.start, v - 1);

        applyDependencies();
        render();

        try {
          await saveTask(task);
        } catch (err) {
          console.error("Failed to update duration:", err);
        }
      };

      // finalize edit
      input.addEventListener("blur", commit, { once: true });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") render();
      });
    };
  });
}
