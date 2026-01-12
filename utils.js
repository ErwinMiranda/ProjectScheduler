// utils.js — date helpers used across modules

const DAY_MS = 86400000;

/**
 * Convert date → UTC normalized midnight
 */
export function toUTC(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Add N days to date
 */
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return toUTC(x);
}

/**
 * Number of days between two dates
 */
export function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

/**
 * Format date → yyyy-mm-dd
 */
export function formatDate(d) {
  if (!d || isNaN(d.getTime())) return "Invalid";
  return d.toISOString().slice(0, 10);
}
export function computeCriticalPath(tasks) {
  if (!tasks.length) return new Set();

  // Normalize tasks to use day numbers
  const DAY = 86400000;

  // Duration in whole days
  const dur = {};
  tasks.forEach((t) => {
    dur[t.id] = Math.max(1, Math.round((t.end - t.start) / DAY) + 1);
  });

  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Build parent→child graph
  const children = {};
  const parents = {};
  tasks.forEach((t) => {
    children[t.id] = [];
    parents[t.id] = t.depends ? [t.depends] : [];
  });

  tasks.forEach((t) => {
    if (t.depends) {
      children[t.depends].push(t.id);
    }
  });

  // -----------------------------
  // FORWARD PASS (ES / EF)
  // -----------------------------
  const ES = {}; // earliest start (in days)
  const EF = {}; // earliest finish

  // Tasks with no dependencies start at ES = 0
  tasks.forEach((t) => {
    ES[t.id] = 0;
    EF[t.id] = dur[t.id];
  });

  // Topological-like relaxation
  let changed = true;
  while (changed) {
    changed = false;

    for (const t of tasks) {
      if (!t.depends) continue;

      const p = byId.get(t.depends);
      if (!p) continue;

      const lag = t.lagDays || 0;
      const lead = t.leadDays || 0;
      const type = t.depType || "FS";

      let constraintES = 0;

      if (type === "SS") {
        constraintES = ES[p.id] + (lag - lead);
      } else {
        constraintES = EF[p.id] + (lag - lead);
      }

      if (constraintES > ES[t.id]) {
        ES[t.id] = constraintES;
        EF[t.id] = ES[t.id] + dur[t.id];
        changed = true;
      }
    }
  }

  // -----------------------------
  // BACKWARD PASS (LS / LF)
  // -----------------------------
  const maxEF = Math.max(...Object.values(EF));
  const LF = {};
  const LS = {};

  tasks.forEach((t) => {
    LF[t.id] = maxEF;
    LS[t.id] = LF[t.id] - dur[t.id];
  });

  changed = true;
  while (changed) {
    changed = false;

    for (const t of tasks) {
      for (const cId of children[t.id]) {
        const c = byId.get(cId);
        const type = c.depType || "FS";
        const lag = c.lagDays || 0;
        const lead = c.leadDays || 0;

        let allowedLF = LF[cId];

        // Child's start constraint
        if (type === "SS") {
          allowedLF = LS[cId] + (lag - lead);
        } else {
          allowedLF = LS[cId] - (lag - lead);
        }

        if (allowedLF < LF[t.id]) {
          LF[t.id] = allowedLF;
          LS[t.id] = LF[t.id] - dur[t.id];
          changed = true;
        }
      }
    }
  }

  // -----------------------------
  // CRITICAL PATH = tasks with 0 slack
  // -----------------------------
  const cp = new Set();
  tasks.forEach((t) => {
    const slack = LS[t.id] - ES[t.id];
    if (Math.abs(slack) < 0.0001) {
      cp.add(t.id);
    }
  });

  return cp;
}
export function showLoading(msg = "Loading...") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  const text = document.getElementById("loadingText");
  if (text) text.textContent = msg;
  overlay.style.display = "flex";
}

export function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
}
export function toDateInput(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
/* ============================================================
   HELPER: WATERFALL SORT (DFS Topological)
   Groups: Parent -> Child -> Grandchild, then sorts by Date
============================================================ */
export function organizeTasksByWaterfall(taskList) {
  // 1. Create Maps for fast lookup
  const taskMap = new Map();
  const childrenMap = new Map();
  const roots = [];

  taskList.forEach((t) => {
    taskMap.set(t.id, t);
    childrenMap.set(t.id, []);
  });

  // 2. Identify Roots (No parent, or parent not in this list) vs Children
  taskList.forEach((t) => {
    if (t.depends && taskMap.has(t.depends)) {
      childrenMap.get(t.depends).push(t);
    } else {
      roots.push(t);
    }
  });

  // 3. Sort Roots by Start Date (The main timeline backbone)
  roots.sort((a, b) => new Date(a.start) - new Date(b.start));

  // 4. Recursive Traversal (DFS) to build final order
  const sortedList = [];
  const visitedIds = new Set();

  function traverse(task) {
    if (visitedIds.has(task.id)) return;
    visitedIds.add(task.id);
    sortedList.push(task);

    // Find children
    const kids = childrenMap.get(task.id) || [];

    // Sort children by Date so siblings appear chronologically
    kids.sort((a, b) => new Date(a.start) - new Date(b.start));

    // Visit children immediately to keep them under parent
    kids.forEach((kid) => traverse(kid));
  }

  // Execute Traversal
  roots.forEach((root) => traverse(root));

  // 5. Re-assign Row Numbers based on new order
  // (This ensures the visual row matches the array index)
  sortedList.forEach((t, index) => {
    t.row = index;
  });

  return sortedList;
}
/* ============================================================
   PRINT / EXPORT TO PDF (Smart Crop with Sidebar Offset)
   Place in utils.js
============================================================ */
import { tasks } from "./state.js";

export function ensurePrintButton() {
  if (document.getElementById("printPdfBtn")) return;

  const headerControls = document.querySelector(".header-controls");
  if (!headerControls) return;

  const printBtn = document.createElement("button");
  printBtn.id = "printPdfBtn";
  printBtn.className = "btn";
  printBtn.textContent = "Print PDF";
  printBtn.title = "Export to PDF (A3 Landscape)";
  printBtn.style.marginLeft = "8px";

  printBtn.onclick = async () => {
    if (typeof showLoading === "function") showLoading("Generating PDF...");
    printBtn.disabled = true;

    try {
      const { jsPDF } = window.jspdf;

      /* --------------------------------------------------------
         1. CALCULATE LIMITS & FORMAT DATES
      -------------------------------------------------------- */
      let tatText = "";
      let fileDateRange = new Date().toISOString().slice(0, 10);

      let minTime = Infinity;
      let maxTime = -Infinity;

      if (tasks && tasks.length > 0) {
        tasks.forEach((t) => {
          const start =
            t.start instanceof Date
              ? t.start.getTime()
              : new Date(t.start).getTime();
          const end =
            t.end instanceof Date ? t.end.getTime() : new Date(t.end).getTime();
          if (!isNaN(start) && start < minTime) minTime = start;
          if (!isNaN(end) && end > maxTime) maxTime = end;
        });

        if (minTime !== Infinity && maxTime !== -Infinity) {
          const diffDays =
            Math.ceil((maxTime - minTime) / (1000 * 60 * 60 * 24)) + 1;
          const startStr = new Date(minTime).toISOString().slice(0, 10);
          const endStr = new Date(maxTime).toISOString().slice(0, 10);

          tatText = ` | ${startStr} to ${endStr} (${diffDays} Days)`;
          fileDateRange = `${startStr}_to_${endStr}`;
        }
      }

      /* --------------------------------------------------------
         2. SMART CROP CALCULATION (FIXED)
      -------------------------------------------------------- */
      const element = document.querySelector(".gantt-scroll");
      const innerContent = document.querySelector(".gantt-inner");

      const fullScrollWidth = innerContent.scrollWidth;

      // --- CONFIG ---
      // We estimate the Sidebar width (Task Name + Date columns)
      // Task Name (~300px) + Start (~100px) + End (~100px) + Padding ≈ 550px
      const estimatedSidebarWidth = 550;

      // Calculate Time Ratios
      const today = new Date().getTime();
      const renderedEnd = Math.max(today, maxTime);
      const totalRenderedMs = renderedEnd - minTime; // Total time currently shown
      const projectMs = maxTime - minTime; // Actual project time

      let targetWidth = fullScrollWidth;

      // Only crop if valid data exists and we have extra empty space
      if (
        maxTime < today &&
        totalRenderedMs > 0 &&
        fullScrollWidth > estimatedSidebarWidth
      ) {
        // 1. Get the width of JUST the timeline part (Total - Sidebar)
        const timelineFullWidth = fullScrollWidth - estimatedSidebarWidth;

        // 2. Calculate how much of that timeline we actually need
        const ratio = projectMs / totalRenderedMs;
        const neededTimelineWidth = timelineFullWidth * ratio;

        // 3. Re-assemble: Sidebar + Needed Timeline + SAFE BUFFER (300px)
        const calculatedWidth =
          estimatedSidebarWidth + neededTimelineWidth + 300;

        // 4. Use the smaller of the two (don't expand if chart is small)
        targetWidth = Math.min(calculatedWidth, fullScrollWidth);
      }

      // 🔥 FIX: ADD 50PX BUFFER TO PREVENT BOTTOM CUT
      const targetHeight = element.scrollHeight + 50;

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        width: targetWidth,
        height: targetHeight,
        windowWidth: targetWidth,
        x: 0,
        y: 0,
        onclone: (clonedDoc) => {
          // A. Fix Container
          const clonedScroll = clonedDoc.querySelector(".gantt-scroll");
          clonedScroll.style.overflow = "visible";
          // Ensure the cloned container accepts the buffer height
          clonedScroll.style.height = targetHeight + "px";
          clonedScroll.style.width = targetWidth + "px";
          clonedScroll.style.background = "#ffffff";

          // B. Fix Sticky Header
          const clonedHeader = clonedDoc.querySelector(".timeline-header");
          if (clonedHeader) {
            clonedHeader.style.position = "static";
            clonedHeader.style.top = "auto";
            clonedHeader.style.width = "100%";
          }

          // ... inside onclone: (clonedDoc) => { ...

          // C. Hide Add/Del Buttons (Row Content)
          clonedDoc
            .querySelectorAll(".task-insert, .task-delete")
            .forEach((el) => {
              el.style.display = "none";
            });

          // Hide Add/Del Header AND Adjust Task Name Header
          const headerDivs = clonedDoc.querySelectorAll(
            ".left-timeline-header > div"
          );
          headerDivs.forEach((div) => {
            const text = div.textContent.trim().toLowerCase();

            // 1. Completely remove the "Add/Del" header space
            if (text.includes("add") || text.includes("del")) {
              div.style.display = "none";
            }

            // 2. Widen the "Task Name" header
            if (text.includes("task name")) {
              div.style.width = "300px"; // Increased width (was 140px)
            }
          });

          // ... rest of your code (Status Badge fix, Day fix, etc.) ...

          // C. Status Badge (Text Moved Up)
          clonedDoc.querySelectorAll("select.task-status").forEach((select) => {
            const badge = clonedDoc.createElement("div");
            const selectedOpt = select.options[select.selectedIndex];
            const text = selectedOpt ? selectedOpt.text : select.value;

            badge.textContent = text;
            badge.style.backgroundColor =
              select.style.backgroundColor || "#334155";
            badge.style.color = "#ffffff";
            badge.style.textAlign = "center";
            badge.style.display = "flex";
            badge.style.alignItems = "center";
            badge.style.justifyContent = "center";
            badge.style.width = "80px";
            //badge.style.height = "20px";
            badge.style.borderRadius = "6px";
            badge.style.fontSize = "13px";
            badge.style.fontWeight = "600";
            //badge.style.paddingBottom = "2px"; // Nudge text up

            if (select.parentNode)
              select.parentNode.replaceChild(badge, select);
          });

          // D. Day Inputs (Converted to Static Badges)
          clonedDoc
            .querySelectorAll(".day-edit-start, .day-edit-end")
            .forEach((input) => {
              const dayBadge = clonedDoc.createElement("div");

              dayBadge.textContent = input.value;
              dayBadge.style.background = "#f1f5f9";
              dayBadge.style.border = "1px solid #cbd5e1";
              dayBadge.style.borderRadius = "4px";
              dayBadge.style.width = "50px";
              dayBadge.style.fontSize = "13px";
              dayBadge.style.color = "#334155";
              dayBadge.style.display = "flex";
              dayBadge.style.alignItems = "center";
              dayBadge.style.justifyContent = "center";
              //dayBadge.style.height = "24px";
              //dayBadge.style.marginTop = "-1px";
              //dayBadge.style.paddingBottom = "2px"; // Nudge text up

              if (input.parentNode)
                input.parentNode.replaceChild(dayBadge, input);
            });

          // E. Force Row Height
          // E. Force Row Height
          clonedDoc.querySelectorAll(".task-dates").forEach((row) => {
            row.style.width = "200px";

            //row.style.height = "44px";
          });
          clonedDoc.querySelectorAll(".task-title").forEach((row) => {
            row.style.width = "240px";
            row.fontSize = "12px";
            //row.style.height = "44px";
          });
        },
      });

      const imgData = canvas.toDataURL("image/png");

      /* --------------------------------------------------------
         3. GENERATE PDF
      -------------------------------------------------------- */
      const pdf = new jsPDF("l", "mm", "a3");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const usableWidth = pageWidth - margin * 2;
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = usableWidth / imgWidth;
      const pdfImageHeight = imgHeight * ratio;

      const woVal = document.getElementById("woFilter").value || "Project";
      const acReg = document.getElementById("acRegLabel").textContent || "";

      pdf.setFontSize(14);
      pdf.text(`Project Schedule: ${woVal} (${acReg})${tatText}`, margin, 10);

      let heightLeft = pdfImageHeight;
      let position = 15;

      pdf.addImage(
        imgData,
        "PNG",
        margin,
        position,
        usableWidth,
        pdfImageHeight
      );
      heightLeft -= pageHeight - position;

      while (heightLeft > 0) {
        position = position - pageHeight;
        pdf.addPage("a3", "l");
        pdf.addImage(
          imgData,
          "PNG",
          margin,
          position,
          usableWidth,
          pdfImageHeight
        );
        heightLeft -= pageHeight;
      }

      pdf.save(`Gantt_${woVal}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("PDF Error:", err);
      alert("Failed to generate PDF. See console.");
    } finally {
      if (typeof hideLoading === "function") hideLoading();
      printBtn.disabled = false;
    }
  };

  headerControls.appendChild(printBtn);
}
