// edit.js — inline title & duration editing + dropdown refresh (OFFLINE-FIRST PATCH)
import { pushHistory } from "./state.js";
import { tasks } from "./state.js";
import { addDays, daysBetween, toDateInput } from "./utils.js";
import { applyDependencies } from "./app.js";
import { render } from "./renderer.js";

/* ============================================================
   TITLE EDITING (With Inline JS Styling Fix)
==============================================================*/
export function attachTitleEditing() {
  document.querySelectorAll(".task-title").forEach((cell) => {
    cell.ondblclick = () => {
      const id = cell.parentElement.querySelector(".task-dur").dataset.id;
      const task = tasks.find((t) => t.id === id);

      if (!task || cell.querySelector("input")) return;

      const current = task.title;

      // 1. Temporarily unlock the parent cell so the input isn't clipped
      cell.style.overflow = "visible";
      cell.style.position = "relative";
      cell.style.zIndex = "10000"; // Ensure the cell itself is on top

      // 2. Create the input
      cell.innerHTML = `<input type="text" value="${current}" />`;
      const input = cell.querySelector("input");

      // 3. APPLY STYLES DIRECTLY IN JS (The "Pop-out" Logic)
      Object.assign(input.style, {
        position: "absolute",
        left: "-5px", // Nudge left to align nicely
        top: "-5px", // Nudge up to center vertically
        width: "250px", // FORCE WIDE WIDTH (Overlaps Status column)
        height: "32px", // Fixed comfortable height
        zIndex: "10001", // Top of the stack
        background: "#ffffff",
        border: "2px solid #0d1727ff", // Blue focus ring
        borderRadius: "4px",
        padding: "0 8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)", // Drop shadow for depth
        outline: "none",
        fontSize: "13px",
        fontFamily: "inherit",
        color: "#0f172a",
      });

      input.focus();
      input.select();

      const commit = () => {
        const value = input.value.trim();
        if (!value) {
          render(); // Re-render handles cleaning up styles automatically
          return;
        }

        pushHistory();
        task.title = value;

        // 🔥 LOCAL UPDATE ONLY — no Firestore write yet
        window.dispatchEvent(new CustomEvent("localchange"));

        render(); // This rebuilds the DOM, effectively removing our temporary styles

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
export function attachDateEditing() {
  document.querySelectorAll(".task-dates").forEach((wrap) => {
    const id = wrap.dataset.id;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    const startInput = wrap.querySelector(".task-start");
    const endInput = wrap.querySelector(".task-end");

    const commit = () => {
      const newStart = new Date(startInput.value);
      const newEnd = new Date(endInput.value);

      if (isNaN(newStart) || isNaN(newEnd)) return;

      // how long the task originally was
      const duration = daysBetween(task.start, task.end);

      pushHistory();

      if (startInput === document.activeElement) {
        // START changed → move task, keep duration
        task.start = newStart;
        task.end = addDays(newStart, duration);
        endInput.value = toDateInput(task.end);
      } else {
        // END changed → resize task
        if (newEnd < newStart) return;
        task.start = newStart;
        task.end = newEnd;
      }

      window.dispatchEvent(new CustomEvent("localchange"));
      applyDependencies();
      render();
    };

    startInput.addEventListener("change", commit);
    endInput.addEventListener("change", commit);

    // prevent drag conflict
    [startInput, endInput].forEach((i) => {
      i.addEventListener("mousedown", (e) => e.stopPropagation());
    });
  });
}

/* ============================================================
   SKILL EDITING (Dark Mode Pop-up + Enter Key Support)
==============================================================*/
export function attachSkillEditing() {
  const SKILLS_LIST = ["AVI", "CRG", "CAB", "ENG", "FLC", "LDG", "STR", "SHOP"];

  document.querySelectorAll(".task-skill").forEach((cell) => {
    cell.onclick = (e) => {
      e.stopPropagation();

      // 1. Force close others
      document.querySelectorAll(".skill-popup").forEach((p) => p.remove());

      const rowLeft = cell.closest(".row-left");
      const id = rowLeft.querySelector(".task-dur").dataset.id;
      const task = tasks.find((t) => t.id === id);

      if (!task) return;

      const currentSkills = (task.skill || "").split(",").filter(Boolean);

      // Reset z-index
      document
        .querySelectorAll(".task-skill")
        .forEach((c) => (c.style.zIndex = "auto"));

      cell.style.overflow = "visible";
      cell.style.position = "relative";
      cell.style.zIndex = "10000";

      // 2. Create Popup
      const popup = document.createElement("div");
      popup.className = "skill-popup";

      // Stop clicks inside from bubbling
      popup.addEventListener("click", (e) => e.stopPropagation());
      popup.addEventListener("mousedown", (e) => e.stopPropagation());

      Object.assign(popup.style, {
        position: "absolute",
        top: "100%",
        left: "0",
        zIndex: "10001",
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: "6px",
        padding: "8px",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
        minWidth: "160px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6px",
        marginTop: "4px",
      });

      // 3. Create Checkboxes
      SKILLS_LIST.forEach((skillCode) => {
        const label = document.createElement("label");
        Object.assign(label.style, {
          display: "flex",
          alignItems: "center",
          fontSize: "11px",
          color: "#f8fafc",
          cursor: "pointer",
          fontWeight: "500",
          userSelect: "none",
        });

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = skillCode;
        checkbox.style.marginRight = "6px";
        checkbox.style.cursor = "pointer";

        if (currentSkills.includes(skillCode)) {
          checkbox.checked = true;
        }

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(skillCode));
        popup.appendChild(label);
      });

      cell.appendChild(popup);

      // --- SHARED SAVE LOGIC ---
      const commitAndClose = () => {
        const selected = [];
        popup.querySelectorAll("input:checked").forEach((chk) => {
          selected.push(chk.value);
        });

        pushHistory();
        task.skill = selected.join(",");

        window.dispatchEvent(new CustomEvent("localchange"));
        render(); // Re-render (closes popup)

        // Clean up listeners
        document.removeEventListener("mousedown", onOutsideClick);
        document.removeEventListener("keydown", onKeyPress);
      };

      // Handler 1: Click Outside
      const onOutsideClick = (ev) => {
        if (popup.contains(ev.target)) return;
        commitAndClose();
      };

      // Handler 2: Enter Key (Save) or Escape (Cancel)
      const onKeyPress = (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault(); // Prevent default browser action
          commitAndClose();
        }
        if (ev.key === "Escape") {
          render(); // Just re-render to close without saving
        }
      };

      // Attach Listeners (Delayed to avoid immediate trigger)
      setTimeout(() => {
        document.addEventListener("mousedown", onOutsideClick);
        document.addEventListener("keydown", onKeyPress);
      }, 0);
    };
  });
}
