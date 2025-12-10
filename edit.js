// edit.js — Inline duration editor logic

import { daysBetween, addDays } from "./utils.js";
import { tasks } from "./state.js";
import { saveTask } from "./firebase.js";
import { applyDependencies, refresh } from "./app.js";

/**
 * Enables click-to-edit duration feature on left task rows
 */
export function enableDurationEditing(taskLeftList) {

    taskLeftList.querySelectorAll(".task-dur").forEach(cell => {

        cell.onclick = () => {
            const id = cell.dataset.id;
            const t = tasks.find(x => x.id === id);

            // Already editing or no task → ignore
            if (!t || cell.querySelector("input")) return;

            const cur = daysBetween(t.start, t.end) + 1;

            // Replace text with input field
            cell.innerHTML = `<input type="number" min="1" value="${cur}">`;

            const input = cell.querySelector("input");
            input.focus();
            input.select();

            const commit = async () => {
                const val = Math.max(1, Number(input.value));

                // Update end date based on new duration
                t.end = addDays(t.start, val - 1);

                applyDependencies();
                refresh();

                try {
                    await saveTask(t);
                } catch (e) {
                    console.error("Update failed:", e);
                }
            };

            // Commit on blur or Enter
            input.addEventListener("blur", commit, { once: true });
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") input.blur();
                if (e.key === "Escape") refresh();
            });
        };
    });
}
