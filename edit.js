// edit.js — inline title & duration editing + dropdown refresh (OFFLINE-FIRST PATCH)
import { pushHistory } from "./state.js";
import { tasks } from "./state.js";
import { addDays, daysBetween } from "./utils.js";
import { applyDependencies } from "./app.js";
import { render } from "./renderer.js";

/* ============================================================
   TITLE EDITING
==============================================================*/
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

      const commit = () => {
        const value = input.value.trim();
        if (!value) {
          render();
          return;
        }

        pushHistory();
        task.title = value;

        // 🔥 LOCAL UPDATE ONLY — no Firestore write yet
        window.dispatchEvent(new CustomEvent("localchange"));

        render();

        // Refresh dependency dropdown
        import("./app.js").then((m) => m.refreshDependencyDropdown());
      };

      input.addEventListener("blur", commit, { once: true });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") render();
      });
    };
  });
}

/* ============================================================
   DURATION EDITING
==============================================================*/
export function attachDurationEditing() {
  document.querySelectorAll(".task-dur").forEach((cell) => {
    cell.onclick = () => {
      const id = cell.dataset.id;
      const task = tasks.find((t) => t.id === id);

      if (!task || cell.querySelector("input")) return;

      const current = daysBetween(task.start, task.end) + 1;

      cell.innerHTML = `<input type="number" min="1" value="${current}" />`;
      const input = cell.querySelector("input");
      input.focus();
      input.select();

      const commit = () => {
        const v = Math.max(1, Number(input.value));

        pushHistory();

        const oldEnd = task.end;
        const newEnd = addDays(task.start, v - 1);

        const deltaDays = daysBetween(oldEnd, newEnd);

        task.end = newEnd;

        // ✅ Cascade only if duration increased
        if (deltaDays !== 0) {
          import("./app.js").then((m) => {
            m.shiftChildren(task.id, deltaDays);
            applyDependencies();
            render();
          });
        } else {
          applyDependencies();
          render();
        }

        // 🔥 LOCAL UPDATE ONLY — no Firestore write yet
        window.dispatchEvent(new CustomEvent("localchange"));

        // Refresh dependency dropdown
        import("./app.js").then((m) => m.refreshDependencyDropdown());
      };

      input.addEventListener("blur", commit, { once: true });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") render();
      });
    };
  });
}
