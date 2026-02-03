//main.js
import {
  doc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  deleteField,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { db, tasksCol } from "./firebase.js";

import {
  fetchTasksByWOOnce,
  listenTasksByWO,
  fetchUniqueWOList,
  updateTask,
} from "./firebase.js";

const SKILL_ORDER = [
  "SHOP",
  "CAB",
  "AVI",
  "CRG",
  "ENG",
  "FLC",
  "LDG",
  "STR",
  "ENG/CRG",
  "FLC/LDG",
];
const statusEl = document.getElementById("status-indicator");
const woSelect = document.getElementById("wo-filter");
// 🔥 Track close date PER TASK (for bulk closing)
const taskActionDayMap = new Map();

let skillDisplayOrder = []; // Order of skills based on click sequence
let collapsedSkills = new Set(); // tracks which skills are hidden
window.availableSkills = []; // skills currently present in dataset
window.skillToolbarInitialized = false; // ensures toolbar is built once
let isBatchSaving = false;
let editingQueueIndex = null;
let unsubscribeRealtime = null;
let actionDayKey = null;
// -------------------------
// Start app
// -------------------------

// ---------- helpers for date parsing ----------
// New helper function to draw the gray history line
function resolveStatusOnClose(task, actionDayKey) {
  const startDate = parseDateField(task.rev_sdate ?? task.start);
  const endDate = parseDateField(task.rev_edate ?? task.end);

  if (!startDate || !endDate) return "Closed";

  const startKey = toSerialDayKey(startDate);
  const endKey = toSerialDayKey(endDate);

  // 1️⃣ Single-day task → always Closed
  if (startKey === endKey) {
    return "Closed";
  }

  // 2️⃣ Multi-day task
  // If user closed it on the END date → Closed
  if (actionDayKey === endKey) {
    return "Closed";
  }

  // Otherwise → still ongoing
  return "InProgress";
}

function excelSerialToDate(serial) {
  // Excel serial number to JS Date (handles whole number only)
  const epoch = new Date(Date.UTC(1899, 11, 30)); // Excel epoch
  const days = Math.floor(Number(serial));
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(epoch.getTime() + ms);
}

function parseDateField(val) {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") return excelSerialToDate(val);

  // Safe string parsing
  const d = new Date(val);
  if (isNaN(d.getTime())) return null; // Returns null instead of Invalid Date
  return d;
}

function toSerialDayKey(dateObj) {
  const d = new Date(
    Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()),
  );
  return Math.floor(d.getTime() / (24 * 60 * 60 * 1000));
}
function dayKeyToDate(dayKey) {
  return new Date(dayKey * 24 * 60 * 60 * 1000);
}
function formatDisplayDateShort(dateObj) {
  return dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}
function weekdayShort(dateObj) {
  return dateObj.toLocaleDateString("en-US", { weekday: "short" });
}

function populateSkillDropdown() {
  const select = document.getElementById("b-skill");
  if (!select) return;

  select.innerHTML = ""; // Clear existing options

  // Add a default "General" option
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "GEN"; // Use "GEN" or "Unassigned"
  defaultOpt.textContent = "GEN";
  select.appendChild(defaultOpt);

  // Add all skills from the global list
  SKILL_ORDER.forEach((skill) => {
    const opt = document.createElement("option");
    opt.value = skill;
    opt.textContent = skill;
    select.appendChild(opt);
  });
}
function adaptProjSchedTask(t) {
  // 🔹 Normalize skill field into an array
  const skillList = String(t.skill || "GEN")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Helper to safely parse dates from EITHER start (new) OR start (legacy)
  const getISO = (val) => {
    if (!val) return "";
    if (val.toDate) return val.toDate().toISOString().slice(0, 10); // Firestore Timestamp
    if (val instanceof Date) return val.toISOString().slice(0, 10); // JS Date
    return String(val).slice(0, 10); // String
  };

  // 🔥 CRITICAL FIX: Prefer 'start' field, fallback to 'start' field
  const rawStart = t.start || t.start;
  const rawEnd = t.end || t.end;
  const rawRevS = t.rev_sdate || rawStart;
  const rawRevE = t.rev_edate || rawEnd;

  const commonFields = {
    _id: t.id,
    taskid: t.taskno || t.id,
    acreg: t.acreg || "",
    workorder: t.wo || "",
    status: t.status || "Open",
    remarks: t.remarks || "",
    datesclosed: t.datesclosed || "",
    color: t.color || "",
    row: t.row || 0,

    // 🔥 Dates processed correctly
    start: getISO(rawStart),
    end: getISO(rawEnd),
    rev_sdate: getISO(rawRevS),
    rev_edate: getISO(rawRevE),

    // 🔥 Handle History (orig_sdate)
    orig_sdate: t.orig_sdate ? getISO(t.orig_sdate) : null,

    dependencies: Array.isArray(t.depends)
      ? t.depends
      : t.depends
        ? [t.depends]
        : [],
    depType: t.depType || "FS",
    lagDays: Number(t.lagDays) || 0,
    leadDays: Number(t.leadDays) || 0,
  };

  // Single Skill Case
  if (skillList.length <= 1) {
    return [
      {
        ...commonFields,
        tasktitle: t.title || "",
        skill: skillList[0] || "GEN",
      },
    ];
  }

  // Multi-Skill Case
  return skillList.map((skill) => ({
    ...commonFields,
    tasktitle: t.title || "",
    skill,
    _isMultiSkill: true,
    _allSkills: skillList,
  }));
}

async function loadWOList() {
  const list = await fetchUniqueWOList();
  woSelect.innerHTML = '<option value="">-- Select WO --</option>';

  list.forEach(({ wo, acreg }) => {
    const opt = document.createElement("option");
    opt.value = wo;
    opt.textContent = `${wo} (${acreg})`;
    woSelect.appendChild(opt);
  });

  // restore saved value
  if (woFilterValue) {
    woSelect.value = woFilterValue;
  }
}

loadWOList();

function enableRealtime(wo) {
  // 🔌 Detach old listener if any
  if (typeof unsubscribeRealtime === "function") {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }

  statusEl.textContent = "Firestore: syncing…";

  // 🔥 Attach new listener
  unsubscribeRealtime = listenTasksByWO(wo, (rawTasks) => {
    window.currentRows = rawTasks.flatMap(adaptProjSchedTask);

    statusEl.textContent = "Firestore: live";

    scheduleRender();
  });
}

// ---------- UI state ----------
window.currentRows = []; // cached docs as objects { _id, ...fields }

// ---------- Work Order filter ----------
let savedValue = localStorage.getItem("woFilterValue");
let woFilterValue = savedValue || "";

// ✅ restore filter into input
if (savedValue) {
  document.getElementById("wo-filter").value = savedValue;
}

document.getElementById("wo-search").addEventListener("click", async () => {
  const wo = woSelect.value;
  if (!wo) return;

  woFilterValue = wo.toLowerCase();
  localStorage.setItem("woFilterValue", woFilterValue);

  statusEl.textContent = "Firestore: loading…";

  const rawTasks = await fetchTasksByWOOnce(wo);

  window.currentRows = rawTasks.flatMap(adaptProjSchedTask);

  statusEl.textContent = `Firestore: loaded ${window.currentRows.length} tasks`;

  ensureTimelineRange(true);
  applyWOfilterAndRender();
  enableRealtime(wo);
});

export function applyWOfilterAndRender() {
  if (!woFilterValue) {
    document.getElementById("date-range-heading").innerText = "";
    document.getElementById("matrix-container").innerHTML =
      '<div style="padding:10px;color:#999">Please enter a Work Order</div>';
    return;
  }

  let filteredRows = window.currentRows.filter((r) =>
    (r.workorder || "").toString().toLowerCase().includes(woFilterValue),
  );

  if (filteredRows.length === 0) {
    document.getElementById("matrix-container").innerHTML =
      '<div style="padding:10px;color:#999">No tasks found for this Work Order</div>';
    document.getElementById("date-range-heading").innerText = "";
    return;
  }

  populateSkillToolbarForWO(filteredRows);
  buildMatrixTable(filteredRows);
  populateSkillDropdown();
}
function populateSkillToolbarForWO(filteredRows) {
  const skills = new Set();

  filteredRows.forEach((r) => {
    if (r.skill) skills.add(r.skill);
    else skills.add("Unassigned");
  });

  const ordered = [];

  // Keep your preferred SKILL_ORDER
  SKILL_ORDER.forEach((s) => {
    if (skills.has(s)) {
      ordered.push(s);
      skills.delete(s);
    }
  });

  // Add remaining skills
  [...skills].sort().forEach((s) => ordered.push(s));

  window.availableSkills = ordered;

  // Re-render toolbar with only these skills
  renderSkillToolbar(ordered);
}

// ---------- CRUD helpers ----------
async function createTask(payload) {
  try {
    const docPayload = {
      // 🔑 REQUIRED FIELDS (match firebase.js)
      wo: payload.workorder || "",
      acreg: payload.acreg || "",
      title: payload.title || payload.tasktitle || "Untitled",
      skill: payload.skill || "GEN",
      status: (payload.status || "open").toLowerCase(),

      // 📅 Dates (Firestore expects start / end)
      start: new Date(payload.start).toISOString(),
      end: new Date(payload.end).toISOString(),

      // ✏️ Optional
      remarks: payload.remarks || "",
      depends: payload.depends || [],
      depType: payload.depType || "FS",

      // 🧮 Metadata
      row: Date.now(),
      taskno: payload.taskid || Date.now(),
      updatedAt: serverTimestamp(),
    };

    const ref = await addDoc(tasksCol, docPayload);
    return ref.id;
  } catch (err) {
    console.error("createTask failed:", err);
    throw err;
  }
}

async function closeTasks(taskIds, closingRemark, closeDateKey) {
  for (const id of taskIds) {
    const task = window.currentRows.find((r) => r._id === id);
    if (!task) continue;

    // 🔥 Do NOT allow closing if ANY parent is still open
    if (Array.isArray(task.dependencies) && task.dependencies.length > 0) {
      const parents = task.dependencies
        .map((pid) => window.currentRows.find((t) => t._id === pid))
        .filter(Boolean);

      const openParents = parents.filter(
        (p) => !p.status || p.status.toLowerCase() !== "closed",
      );

      if (openParents.length > 0) {
        const parentNames = openParents
          .map((p) => p.tasktitle || p._id)
          .join(", ");

        alert(
          `❌ Cannot close "${task.tasktitle}".\n` +
            `The following parent tasks are still OPEN:\n` +
            parentNames,
        );
        continue;
      }
    }

    const resolvedStatus = resolveStatusOnClose(task, closeDateKey);

    /* ============================
       📐 REVISED DATE ADJUSTMENT
       (COMPARE AGAINST START)
    ============================ */

    const planStartDate = parseDateField(task.start);
    const revStartDate = parseDateField(task.rev_sdate ?? task.start);
    const revEndDate = parseDateField(task.rev_edate ?? task.end);

    let newRevS = null;
    let newRevE = null;

    if (planStartDate && revStartDate && revEndDate) {
      const planStartKey = toSerialDayKey(planStartDate);
      const revStartKey = toSerialDayKey(revStartDate);
      const revEndKey = toSerialDayKey(revEndDate);

      // 🔥 COMPARE USING PLANNED START
      if (planStartKey !== closeDateKey) {
        const diff = closeDateKey - planStartKey;

        newRevS = dayKeyToISO(revStartKey + diff);
        newRevE = dayKeyToISO(revEndKey + diff);
      }
    }

    /* ============================
       📅 datesclosed logic
    ============================ */

    const closedDateISO = dayKeyToISO(closeDateKey);

    const ref = doc(db, "tasks", task._id);
    const snap = await getDoc(ref);

    let existingDates = "";
    if (snap.exists()) {
      existingDates = snap.data().datesclosed || "";
    }

    const datesArray = existingDates
      ? existingDates.split(",").map((d) => d.trim())
      : [];

    if (datesArray.includes(closedDateISO)) {
      continue;
    }

    const datesClosedValue = datesArray.length
      ? `${existingDates}, ${closedDateISO}`
      : closedDateISO;

    /* ============================
       📦 FINAL UPDATE
    ============================ */

    const updatePayload = {
      status: resolvedStatus,
      remarks: closingRemark,
      datesclosed: datesClosedValue,
    };

    // Only apply revised shift if needed
    if (newRevS && newRevE) {
      updatePayload.rev_sdate = newRevS;
      updatePayload.rev_edate = newRevE;
    }

    await updateTask(task._id, updatePayload);
  }
}

function buildMatrixTable(rows) {
  // normalize rows
  const normalized = rows.map((r) => {
    const s = parseDateField(r.start);
    const e = parseDateField(r.end);
    const rs = parseDateField(r.rev_sdate ?? r.start);
    const re = parseDateField(r.rev_edate ?? r.end);
    const os = parseDateField(r.orig_sdate);
    return {
      ...r,
      _sdate: s,
      _edate: e,
      _rev_sdate: rs,
      _rev_edate: re,
      _orig_sdate: os,
    };
  });

  // compute min/max from revised FIRST
  const sCandidates = normalized
    .map((r) => {
      const s1 = r._sdate;
      const s2 = r._rev_sdate;
      if (s1 && s2) return new Date(Math.min(s1, s2));
      return s1 || s2;
    })
    .filter(Boolean);

  const eCandidates = normalized
    .map((r) => {
      const e1 = r._edate;
      const e2 = r._rev_edate;
      if (e1 && e2) return new Date(Math.max(e1, e2));
      return e1 || e2;
    })
    .filter(Boolean);

  if (!sCandidates.length || !eCandidates.length) {
    document.getElementById("matrix-container").innerHTML =
      '<div style="padding:10px">No date data</div>';
    document.getElementById("date-range-heading").innerText = "No date range";
    return;
  }

  let minDate = new Date(Math.min(...sCandidates.map((d) => d.getTime())));
  let maxDate = new Date(Math.max(...eCandidates.map((d) => d.getTime())));

  minDate = new Date(
    minDate.getFullYear(),
    minDate.getMonth(),
    minDate.getDate(),
  );
  maxDate = new Date(
    maxDate.getFullYear(),
    maxDate.getMonth(),
    maxDate.getDate(),
  );
  window.minDate = minDate;
  // Compute Critical Path (global)
  window.criticalPathIds = computeCriticalPath(rows);
  // --- CRITICAL PATH TOGGLE LOGIC ---
  const cpBtn = document.getElementById("cp-toggle-btn");
  if (!window.cpToggleInitialized) {
    window.cpToggleInitialized = true;
    window.showOnlyCP = false;

    cpBtn.addEventListener("click", () => {
      window.showOnlyCP = !window.showOnlyCP;
      cpBtn.textContent = window.showOnlyCP ? "Show All Tasks" : "Show CP Only";

      // rebuild table respecting toggle
      applyWOfilterAndRender();
    });
  }
  // --- HIGHLIGHT CP BUTTON LOGIC ---
  const cpHighlightBtn = document.getElementById("cp-highlight-btn");
  if (!window.cpHighlightInitialized) {
    window.cpHighlight = false;
    window.cpHighlightInitialized = true;

    cpHighlightBtn.addEventListener("click", () => {
      window.cpHighlight = !window.cpHighlight;

      cpHighlightBtn.textContent = window.cpHighlight
        ? "Unhighlight CP"
        : "Highlight CP";

      // Re-render tasks with updated borders
      applyWOfilterAndRender();
    });
  }

  // build day keys
  const dayKeys = [];
  for (let k = toSerialDayKey(minDate); k <= toSerialDayKey(maxDate); k++) {
    dayKeys.push(k);
  }

  // heading update
  const acregs = [...new Set(rows.map((r) => r.acreg).filter(Boolean))];
  window.currentAcregs = acregs;

  const todayKey = toSerialDayKey(new Date());
  const startKey = toSerialDayKey(minDate);
  const dayOfPlan = todayKey - startKey + 1;

  document.getElementById("date-range-heading").innerText = `${
    acregs.join(", ") || "Milestone Plan"
  } | TAT: ${dayKeys.length} days (${formatDisplayDateShort(
    minDate,
  )} – ${formatDisplayDateShort(maxDate)}) | Day ${dayOfPlan}`;

  // group by skill
  const grouped = {};
  normalized.forEach((task) => {
    const sk = task.skill || "Unassigned";
    if (!grouped[sk]) grouped[sk] = [];
    grouped[sk].push(task);
  });

  const sortedGrouped = Object.entries(grouped).sort(([a], [b]) => {
    const ia = skillDisplayOrder.indexOf(a);
    const ib = skillDisplayOrder.indexOf(b);

    if (ia === -1 && ib === -1) {
      // fallback to SKILL_ORDER
      return SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b);
    }
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // create table
  const table = document.createElement("table");

  // HEADER ROWS (unchanged)
  const headerRow1 = document.createElement("tr");
  headerRow1.innerHTML = `
        <th rowspan="3" style="min-width:120px; position:sticky; left:0; z-index:24;">
            Skill
        </th>`;
  dayKeys.forEach((k) => {
    const dateObj = dayKeyToDate(k);
    const th = document.createElement("th");
    th.dataset.day = k;
    if (dateObj.getUTCDay() === 0) th.classList.add("sunday");
    th.textContent = formatDisplayDateShort(dateObj);
    th.style.position = "sticky";
    th.style.top = "0";
    th.style.background = "white";
    th.style.zIndex = "10";
    headerRow1.appendChild(th);
  });
  table.appendChild(headerRow1);

  const headerRow2 = document.createElement("tr");
  dayKeys.forEach((k) => {
    const dateObj = dayKeyToDate(k);
    const th = document.createElement("th");
    th.textContent = weekdayShort(dateObj);
    if (dateObj.getUTCDay() === 0) th.classList.add("sunday");
    th.style.position = "sticky";
    th.style.top = "30px";
    th.style.background = "white";
    th.style.zIndex = "9";
    headerRow2.appendChild(th);
  });
  table.appendChild(headerRow2);

  const headerRow3 = document.createElement("tr");
  dayKeys.forEach((k, idx) => {
    const dateObj = dayKeyToDate(k);
    const th = document.createElement("th");
    th.textContent = `Day ${idx + 1}`;
    if (dateObj.getUTCDay() === 0) th.classList.add("sunday");
    th.style.position = "sticky";
    th.style.top = "60px";
    th.style.background = "white";
    th.style.zIndex = "8";
    headerRow3.appendChild(th);
  });
  table.appendChild(headerRow3);

  // ================================
  //  MAIN TASK ROWS (no skill row!)
  // ================================
  sortedGrouped.forEach(([skill, tasks], skillIndex) => {
    const groupId = `skill-${skillIndex}`;

    // INSERT THICK SEPARATOR ROW
    const sepTr = document.createElement("tr");
    sepTr.classList.add("skill-separator-row");

    // ↓ KEEP BELOW sticky headers
    sepTr.style.position = "relative";
    sepTr.style.zIndex = "1";
    const sepTd = document.createElement("td");
    sepTd.colSpan = dayKeys.length + 1;
    sepTd.style.borderTop = "1px solid #ccc";
    sepTd.style.padding = "0";
    sepTd.style.height = "0px";
    sepTr.appendChild(sepTd);
    table.appendChild(sepTr);

    // STACK rows
    const stackedRows = [];

    tasks.forEach((task) => {
      const origSKey = task._orig_sdate
        ? toSerialDayKey(task._orig_sdate)
        : null;
      const sKey = task._sdate ? toSerialDayKey(task._sdate) : null;
      const revSKey = task._rev_sdate ? toSerialDayKey(task._rev_sdate) : sKey;
      const revEKey = task._rev_edate
        ? toSerialDayKey(task._rev_edate)
        : task._edate
          ? toSerialDayKey(task._edate)
          : revSKey;

      const used = new Set();

      // history + glow + block
      if (origSKey !== null && sKey !== null && origSKey !== sKey) {
        const low = Math.min(origSKey, sKey);
        const high = Math.max(origSKey, sKey);
        for (let d = low; d <= high; d++) used.add(d);
      }

      if (sKey !== null && revSKey !== null && sKey !== revSKey) {
        const low = Math.min(sKey, revSKey);
        const high = Math.max(sKey, revSKey);
        for (let d = low; d <= high; d++) used.add(d);
      }

      if (revSKey !== null && revEKey !== null) {
        for (let d = revSKey; d <= revEKey; d++) used.add(d);
      }

      // Try to place into existing stacked rows
      let placed = false;
      for (const rowArr of stackedRows) {
        const conflict = dayKeys.some(
          (dk, idx) => used.has(dk) && rowArr[idx + 1]?.hasChildNodes(),
        );
        if (!conflict) {
          insertTaskToRow(rowArr, task, used, dayKeys);
          placed = true;
          break;
        }
      }

      // Create new row if needed
      if (!placed) {
        const rowArr = [];

        // skill cell (first row only)
        if (stackedRows.length === 0) {
          const skillCell = document.createElement("td");
          skillCell.textContent = skill;
          skillCell.dataset.isSkillCell = "true";
          skillCell.style.fontWeight = "bold";
          skillCell.style.background = "#fff";
          skillCell.style.position = "sticky";
          skillCell.style.left = "0";
          skillCell.style.borderRight = "1px solid #ccc";
          skillCell.style.textAlign = "center";
          rowArr.push(skillCell);
        } else {
          rowArr.push(document.createElement("td"));
        }

        for (let i = 0; i < dayKeys.length; i++) {
          rowArr.push(document.createElement("td"));
        }

        insertTaskToRow(rowArr, task, used, dayKeys);
        stackedRows.push(rowArr);
      }
    });

    // append rows
    stackedRows.forEach((rowArr) => {
      const tr = document.createElement("tr");
      tr.dataset.skill = skill;

      // Respect current collapsed state at render-time
      // respect collapsed state
      tr.style.display = collapsedSkills.has(skill) ? "none" : "";

      rowArr.forEach((td) => tr.appendChild(td));
      table.appendChild(tr);
    });
  });

  // cumulative row (unchanged)
  const cumulativeStickyTop = "90px";
  const cumulativeTr = document.createElement("tr");
  cumulativeTr.style.background = "#E9EAF2";
  cumulativeTr.style.position = "sticky";
  cumulativeTr.style.textAlign = "center";
  cumulativeTr.style.top = cumulativeStickyTop;
  cumulativeTr.style.zIndex = "15"; // ⭐ stays above tasks but below headers
  cumulativeTr.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)"; // optional
  const labelCumTd = document.createElement("td");
  labelCumTd.textContent = "Closed / Total";

  labelCumTd.style.position = "sticky";
  labelCumTd.style.top = cumulativeStickyTop;
  labelCumTd.style.left = "0";
  labelCumTd.style.background = "#E9EAF2";
  labelCumTd.style.zIndex = "16"; // ⭐ higher than row to keep sticky
  cumulativeTr.appendChild(labelCumTd);
  // --- FILTER TO SELECTED SKILL(S) ONLY ---
  // Only include tasks from visible (non-collapsed) skills
  const visibleSkills = new Set(
    Object.entries(grouped)
      .filter(([skill]) => !collapsedSkills.has(skill))
      .map(([skill]) => skill),
  );

  // --- NEW cumulative logic (skill-filtered) ---
  const totalsPerDay = {}; // tasks covering each day
  const closedFinishDay = {}; // closed tasks finishing on each day

  // 1. Collect totals ONLY from visible skills
  normalized
    .filter((task) => visibleSkills.has(task.skill || "Unassigned"))
    .forEach((task) => {
      const rs = task._rev_sdate ? toSerialDayKey(task._rev_sdate) : null;
      const re = task._rev_edate ? toSerialDayKey(task._rev_edate) : null;
      if (rs === null || re === null) return;

      // Count tasks covering each day
      for (let d = rs; d <= re; d++) {
        totalsPerDay[d] = (totalsPerDay[d] || 0) + 1;
      }

      // Count closed tasks only once on their end day
      if ((task.status || "").toLowerCase() === "closed") {
        closedFinishDay[re] = (closedFinishDay[re] || 0) + 1;
      }
    });

  // 2. Build cumulative row
  let runningTotal = 0;
  let runningClosed = 0;

  dayKeys.forEach((dk) => {
    runningTotal += totalsPerDay[dk] || 0;
    runningClosed += closedFinishDay[dk] || 0;

    const td = document.createElement("td");
    td.textContent = `${runningClosed} / ${runningTotal}`;
    td.style.background = "#E9EAF2";
    td.style.position = "sticky";
    td.style.top = cumulativeStickyTop;

    td.style.textAlign = "center";
    td.style.verticalAlign = "middle";
    cumulativeTr.appendChild(td);
  });

  table.insertBefore(cumulativeTr, table.rows[3]);

  // ============================
  //  DAILY TOTAL ROW (NEW)
  // ============================
  const dailyTr = document.createElement("tr");
  dailyTr.style.background = "#E9EAF2";
  dailyTr.style.position = "sticky";
  dailyTr.style.top = "118px";
  dailyTr.style.zIndex = "16";

  const dailyLabel = document.createElement("td");
  dailyLabel.textContent = "Daily Total";
  dailyLabel.style.textAlign = "center";
  dailyLabel.style.position = "sticky";
  dailyLabel.style.left = "0";
  dailyLabel.style.background = "#E9EAF2";
  dailyLabel.style.zIndex = "15";
  dailyLabel.style.top = "118px";

  dailyTr.appendChild(dailyLabel);

  // Compute per-day totals ONLY for visible skills
  const dailyTotals = {};

  normalized
    .filter((task) => visibleSkills.has(task.skill || "Unassigned"))
    .forEach((task) => {
      const rs = task._rev_sdate ? toSerialDayKey(task._rev_sdate) : null;
      const re = task._rev_edate ? toSerialDayKey(task._rev_edate) : null;
      if (rs === null || re === null) return;

      for (let d = rs; d <= re; d++) {
        dailyTotals[d] = (dailyTotals[d] || 0) + 1;
      }
    });

  // Build daily row
  dayKeys.forEach((dk) => {
    const td = document.createElement("td");
    const totalDaily = dailyTotals[dk] || 0;

    td.textContent = totalDaily;
    td.style.textAlign = "center";
    td.style.background = "#F4F5FA";
    td.style.position = "sticky";
    td.style.top = "120px";

    dailyTr.appendChild(td);
  });

  // Insert daily row below cumulative
  table.insertBefore(dailyTr, table.rows[4]);

  // set dataset.day and attach drop handlers
  const trs = table.querySelectorAll("tr");
  trs.forEach((tr, idx) => {
    if (idx < 3) return;
    const tds = tr.querySelectorAll("td");
    const headerTh = table
      .querySelector("tr:first-child")
      .querySelectorAll("th");

    for (let i = 1; i < tds.length; i++) {
      const hd = headerTh[i];
      if (hd?.dataset?.day) {
        tds[i].dataset.day = hd.dataset.day;
      }
      attachDropHandlersToTd(tds[i]);
    }
  });
  // Re-apply collapse state after rendering
  for (const skill of collapsedSkills) {
    applySkillCollapse(skill);
  }
  const container = document.getElementById("matrix-container");
  container.innerHTML = "";
  container.appendChild(table);
}

function updateSkillButtonStyle(btn) {
  const skill = btn.dataset.skill;

  if (collapsedSkills.has(skill)) {
    btn.style.background = "#dddddd"; // hidden
    btn.style.color = "#333";
  } else {
    btn.style.background = "#05164d"; // visible
    btn.style.color = "#fff";
  }
}

function insertTaskToRow(rowTds, task, usedDatesSet, dayKeys, dayKey) {
  // --- 1. Define all date keys ---
  const isCritical = window.criticalPathIds?.includes(task._id);
  const origSKey = task._orig_sdate ? toSerialDayKey(task._orig_sdate) : null;
  const planSKey = task._sdate ? toSerialDayKey(task._sdate) : null;
  const revSKey = task._rev_sdate ? toSerialDayKey(task._rev_sdate) : planSKey;
  const revEKey = task._rev_edate
    ? toSerialDayKey(task._rev_edate)
    : task._edate
      ? toSerialDayKey(task._edate)
      : revSKey; // --- 2. Calculate DIFF for Advance/Delay (Plan vs Revised) ---

  const diff = revSKey !== null && planSKey !== null ? revSKey - planSKey : 0;
  // --- CP Only Mode: hide ALL trace lines (history + glow) ---
  const hideTraces =
    window.showOnlyCP && !window.criticalPathIds.includes(task._id);

  const todayKey = toSerialDayKey(new Date());

  dayKeys.forEach((dk, index) => {
    const td = rowTds[index + 1];
    if (!td) return;
    if (dk === todayKey) {
      td.classList.add("today-highlight");
    }
    if (dayKeyToDate(dk).getUTCDay() === 0) td.classList.add("sunday");
    // --- 3. Draw NEW GRAY HISTORY LINE (Original vs Plan) ---
    if (
      !hideTraces &&
      origSKey !== null &&
      planSKey !== null &&
      origSKey !== planSKey &&
      dk >= Math.min(origSKey, planSKey) &&
      dk <= Math.max(origSKey, planSKey)
    ) {
      const historyLine = document.createElement("div");
      const isHistoryAdvance = planSKey < origSKey;

      if (dk === origSKey) {
        historyLine.classList.add(
          "half-history-line",
          isHistoryAdvance ? "left" : "right",
        );
      } else if (dk === planSKey) {
        historyLine.classList.add(
          "half-history-line",
          isHistoryAdvance ? "right" : "left",
        );
      } else {
        historyLine.classList.add("history-line");
      }
      td.appendChild(historyLine); // --- NEW: Draw the gray dot at the start of history ---

      if (dk === origSKey) {
        const dot = document.createElement("span");
        dot.classList.add("start-dot", "dot-history");
        td.appendChild(dot);
      }
    }

    // --- 4. Draw EXISTING GLOW LINE (Plan vs Revised) ---

    if (
      !hideTraces &&
      planSKey !== null &&
      revSKey !== null &&
      planSKey !== revSKey &&
      dk >= Math.min(planSKey, revSKey) &&
      dk <= Math.max(planSKey, revSKey)
    ) {
      const glow = document.createElement("div");
      const isStartCell = dk === planSKey;
      const isAdvance = diff < 0;

      if (isStartCell) {
        glow.classList.add("half-glow", isAdvance ? "left" : "right");
      } else {
        glow.classList.add("glow-span");
      }
      glow.classList.add(
        diff < 0 ? "glow-advance" : diff > 0 ? "glow-delay" : "glow-ontime",
      );
      td.appendChild(glow);

      if (dk === planSKey) {
        const dot = document.createElement("span");
        dot.classList.add(
          "start-dot",
          diff < 0 ? "dot-advance" : diff > 0 ? "dot-delay" : "dot-ontime",
        );
        td.appendChild(dot);
      }
    }
    // --- 5. TASK BLOCK (Renders at Revised position) ---

    if (
      revSKey !== null &&
      revEKey !== null &&
      dk >= revSKey &&
      dk <= revEKey
    ) {
      const taskDiv = document.createElement("div");
      taskDiv.classList.add("task-block");
      taskDiv.style.position = "relative";

      // --- Critical Path Filter: hide non-CP tasks ---
      if (window.showOnlyCP && !window.criticalPathIds.includes(task._id)) {
        return; // do NOT render this task
      }

      // 🔥 CRITICAL PATH HIGHLIGHT
      const isCritical =
        Array.isArray(window.criticalPathIds) &&
        window.criticalPathIds.includes(task._id);

      if (isCritical) {
        if (window.cpHighlight) {
          taskDiv.style.border = "3px solid black";
        } else {
          taskDiv.style.border = "1px solid gray";
        }
      }

      const status = (task.status || "").toLowerCase();

      // ✅ Convert datesclosed string → array
      const datesClosedArray = task.datesclosed
        ? task.datesclosed.split(",").map((d) => d.trim())
        : [];

      // ✅ matrix date (ISO format)
      const matrixDateISO = dayKeyToISO(dk); // or however you already compute it

      const isClosedOnMatrixDate = datesClosedArray.includes(matrixDateISO);

      if (status === "closed") {
        // ✅ Closed = light blue
        taskDiv.style.backgroundColor = "#E7FAFE";
        taskDiv.style.color = "black";
      } else if (
        (status === "in progress" || status === "inprogress") &&
        isClosedOnMatrixDate
      ) {
        // 🔴 In Progress BUT closed on this matrix date
        taskDiv.style.backgroundColor = "#E7FAFE";
        taskDiv.style.color = "black";
      } else if (status === "in progress" || status === "inprogress") {
        // 🟧 Normal In Progress
        taskDiv.style.backgroundColor = "#fcb740"; // amber
        taskDiv.style.color = "black";
      } else {
        // 🟨 Open / default
        taskDiv.style.backgroundColor = "#FDFBBE";
        taskDiv.style.color = "black";
      }

      if (diff < 0) taskDiv.classList.add("advance");
      else if (diff > 0) taskDiv.classList.add("delay");
      else taskDiv.classList.add("ontime");

      let diffText = "";
      if (diff !== null && diff !== 0) {
        diffText = `${Math.abs(diff)} day(s) ${diff < 0 ? "advance" : "delay"}`;
      } else if (diff === 0) {
        diffText = "On time";
      }
      const startKey = toSerialDayKey(window.minDate || minDate);
      const dayNumber = dk - startKey + 1;

      taskDiv.textContent = task.tasktitle || "(no title)";
      let baseTooltip =
        `Skill: ${task.skill || ""}\n` +
        `Date: ${formatDisplayDateShort(
          dayKeyToDate(dk),
        )} (Day ${dayNumber})\n` +
        `${task.tasktitle || ""}\n` +
        `Remarks: ${task.remarks || ""}\n` +
        `Status: ${task.status || ""}\n` +
        `${diffText}`;

      taskDiv.title = baseTooltip + buildDependencyTooltip(task);

      taskDiv.dataset.taskId = task._id;
      if (task.remarks && task.remarks.trim() !== "") {
        const icon = document.createElement("span");
        icon.textContent = "⚠️";
        icon.style.position = "absolute";
        icon.style.bottom = "2px";
        icon.style.right = "1px";
        icon.style.fontSize = "10px";
        taskDiv.appendChild(icon);
      }

      taskDiv.draggable = true;
      taskDiv.addEventListener("dragstart", onTaskDragStart);
      taskDiv.addEventListener("dragend", onTaskDragEnd); // Double-click on TASK: ALWAYS open Bulk Action Modal

      // Double-click on TASK: ALWAYS open Bulk Action Modal
      taskDiv.addEventListener("dblclick", (e) => {
        e.stopPropagation(); // Prevent triggering "Blank Row" click
        // ⛔ BLOCK double-click for CLOSED tasks
        if ((task.status || "").toLowerCase() === "closed") {
          return; // do nothing
        }
        const thisTaskId = task._id;

        // 1. Ensure the task is selected
        if (!selectedTaskIds.includes(thisTaskId)) {
          if (!e.ctrlKey && !e.metaKey) {
            clearSelection();
          }
          selectedTaskIds.push(thisTaskId);
          taskDiv.classList.add("task-selected");
        }

        // 2. Set the Anchor
        bulkActionAnchorTaskId = thisTaskId;

        // 3. Configure the Modal UI
        const count = selectedTaskIds.length;
        document.getElementById("bulk-action-title").textContent =
          count > 1 ? `Bulk Action for ${count} Milestone` : "Milestone Action";

        // --- UPDATED: Set date to the TASK'S current start date ---
        // Priority: Revised Start -> Planned Start -> Today (fallback)
        const dateObj = actionDayKey
          ? dayKeyToDate(actionDayKey)
          : parseDateField(task.rev_sdate || task.start);

        if (dateObj) {
          bulkActionDate.value = dayKeyToISO(toSerialDayKey(dateObj));
        } else {
          // Fallback if task has no date
          bulkActionDate.value = dayKeyToISO(toSerialDayKey(new Date()));
        }
        // -------------------------------------------------------

        bulkActionRemarks.value = "";

        // Show "Edit Details" button ONLY if single task is selected
        bulkEditDetails.style.display = count === 1 ? "" : "none";

        bulkActionModal.style.display = "flex";
      });

      taskDiv.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (selectedTaskIds.length > 1) {
          bulkClosingMode = true;
          remarksEditingTaskId = null;
          remarksTextarea.value = "";
          remarksEditor.style.left = ev.clientX + window.scrollX + 6 + "px";
          remarksEditor.style.top = ev.clientY + window.scrollY + 6 + "px";
          remarksEditor.style.display = "block";
          remarksTextarea.focus();
        } else {
          bulkClosingMode = false;
          openRemarksEditor(ev, task._id);
        }
      });

      // --- DEPENDENCY INDICATOR ---
      const hasParents =
        Array.isArray(task.dependencies) && task.dependencies.length > 0;

      const hasChildren = window.currentRows.some(
        (t) =>
          Array.isArray(t.dependencies) && t.dependencies.includes(task._id),
      );

      let depIcon = "";
      if (hasParents && hasChildren)
        depIcon = "↔"; // both directions
      else if (hasParents)
        depIcon = "←"; // depends on others
      else if (hasChildren) depIcon = "→"; // others depend on it

      if (depIcon) {
        const icon = document.createElement("div");
        icon.classList.add("task-dependency-indicator");
        icon.textContent = depIcon;
        taskDiv.appendChild(icon);
      }

      td.appendChild(taskDiv);
      // 📌 Capture matrix day whenever user interacts with the task
      taskDiv.addEventListener("mousedown", () => {
        const td = taskDiv.closest("td");
        if (!td?.dataset?.day) return;

        const dayKey = Number(td.dataset.day);
        const taskId = taskDiv.dataset.taskId;

        // single-task close reference
        actionDayKey = dayKey;

        // bulk-close per-task date tracking
        if (taskId) {
          taskActionDayMap.set(taskId, dayKey);
        }
      });
    }
  });
}

// convert dayKey integer -> ISO string YYYY-MM-DD
function dayKeyToISO(dayKey) {
  const dt = dayKeyToDate(Number(dayKey));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------- Drag & Drop handlers ----------
function onTaskDragStart(e) {
  const tid = e.target.dataset.taskId;
  if (!tid) return;

  const t = window.currentRows.find((r) => r._id === tid);
  if (t && (t.status || "").toLowerCase() === "closed") {
    e.preventDefault();
    return;
  }

  // If the dragged task is not in the selection, select only it
  if (!selectedTaskIds.includes(tid)) {
    document
      .querySelectorAll(".task-selected")
      .forEach((el) => el.classList.remove("task-selected"));
    selectedTaskIds = [tid];
    e.target.classList.add("task-selected");
  }

  e.dataTransfer.setData("text/plain", tid);
  e.dataTransfer.effectAllowed = "move";

  // Custom drag image
  try {
    const clone = e.target.cloneNode(true);
    clone.style.position = "absolute";
    clone.style.top = "-100px";
    clone.style.left = "-100px";
    clone.style.width = "220px";
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 10, 10);
    setTimeout(() => document.body.removeChild(clone), 0);
  } catch (err) {}
}

async function onTaskDragEnd(e) {
  // Remove highlights
  document
    .querySelectorAll("td.drop-target")
    .forEach((td) => td.classList.remove("drop-target"));

  tableContainer.style.cursor = "default";

  // 🔥 FORCE REBUILD AFTER DRAGGING & CASCADE
  setTimeout(() => {
    ensureTimelineRange(true); // recalc min/max dates
    applyWOfilterAndRender(); // rebuild table
  }, 250);
}

function attachDropHandlersToTd(td) {
  if (td._dropAttached) return;
  td._dropAttached = true;
  td.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    td.classList.add("drop-target");
  });
  td.addEventListener("dragleave", (ev) => {
    td.classList.remove("drop-target");
  });
  td.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    td.classList.remove("drop-target");

    const tid = ev.dataTransfer.getData("text/plain");
    if (!tid) return;

    const dayStr = td.dataset.day;
    if (!dayStr) return;

    const dayKey = Number(dayStr);

    // Get dragged task
    const draggedTask = window.currentRows.find((r) => r._id === tid);
    if (!draggedTask) return;

    // Get original start date of dragged task
    const revS = parseDateField(draggedTask.rev_sdate ?? draggedTask.start);
    //const startKey = toSerialDayKey(revS || parseDateField(draggedTask.start));
    // Use the date column where the task was picked
    const startKey =
      taskActionDayMap.get(tid) ??
      toSerialDayKey(
        parseDateField(draggedTask.rev_sdate ?? draggedTask.start),
      );

    // COMPUTE DAY SHIFT FIRST ✔️
    const dayShift = dayKey - startKey;

    // BUILD TASK MAP ✔️
    const taskMap = Object.fromEntries(
      window.currentRows.map((t) => [t._id, t]),
    );

    // VALIDATE BEFORE MOVING ANYTHING ✔️
    for (const taskId of selectedTaskIds) {
      const task = taskMap[taskId];
      if (!task) continue;

      const curStart = toSerialDayKey(
        parseDateField(task.rev_sdate ?? task.start),
      );
      const curEnd = toSerialDayKey(parseDateField(task.rev_edate ?? task.end));

      // NEW positions after drag
      const newStart = curStart + dayShift;
      const newEnd = curEnd + dayShift;

      // Check parents
      for (const parentId of task.dependencies || []) {
        const parent = taskMap[parentId];
        if (!parent) continue;

        const parentEnd = toSerialDayKey(
          parseDateField(parent.rev_edate ?? parent.end),
        );

        // BLOCK MOVE ✔️
        if (newStart < parentEnd) {
          alert(
            `Cannot move "${task.tasktitle}" before its parent "${parent.tasktitle}".`,
          );
          return; // CANCEL DROP
        }
      }
    }

    // APPLY MOVE (only if passed validation) ✔️
    // APPLY MOVE (only if passed validation) ✔️
    for (const id of selectedTaskIds) {
      const task = taskMap[id];
      if (!task) continue;

      const curStart = toSerialDayKey(
        parseDateField(task.rev_sdate ?? task.start),
      );
      const curEnd = toSerialDayKey(parseDateField(task.rev_edate ?? task.end));
      const duration = curEnd - curStart;

      const newStartKey = curStart + dayShift;
      const newEndKey = newStartKey + duration;

      const newStartISO = dayKeyToISO(newStartKey);
      const newEndISO = dayKeyToISO(newEndKey);

      // 🔥 SHIFT ENTIRE datesclosed HISTORY
      const newDatesClosed = shiftDatesClosed(task.datesclosed, dayShift);

      await updateTask(task._id, {
        rev_sdate: newStartISO,
        rev_edate: newEndISO,
        datesclosed: newDatesClosed,
      });

      cascadeVisited.clear();
      await cascadeDependents(task._id, dayShift);
    }

    clearSelection();
  });

  // ✅ NEW: double click empty cell to add a task
  td.addEventListener("dblclick", async () => {
    if (td.querySelector(".task-block")) return; // already has a task
    const dayKey = Number(td.dataset.day);
    if (!dayKey) return;

    const skill = td.closest("tr")?.dataset?.skill || "Unassigned";

    // --- Generate unique task ID based on date + time ---
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const taskId =
      now.getFullYear().toString() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      "-" +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds()) +
      "-" +
      now.getMilliseconds();
    // ✅ get acreg from the table heading data we saved
    const acregFromHeading =
      window.currentAcregs && window.currentAcregs.length
        ? window.currentAcregs[0]
        : "";
    // --- Pre-fill modal form ---
    modalEditingId = null; // new task
    f.taskid.value = taskId;
    f.skill.value = skill;
    f.start.value = dayKeyToISO(dayKey);
    f.end.value = dayKeyToISO(dayKey);
    f.rev_sdate.value = dayKeyToISO(dayKey);
    f.rev_edate.value = dayKeyToISO(dayKey);
    f.tasktitle.value = "";
    f.acreg.value = acregFromHeading;
    f.remarks.value = "Newly Added";
    f.statusOpen.checked = true;
    f.workorder.value = woFilterValue || "";

    modalTitle.textContent = "Add Milestone";
    modal.style.display = "flex";
  });
}

let renderPending = false;

export function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    ensureTimelineRange(true);
    applyWOfilterAndRender();
    renderPending = false;
  });
}

// ---------- Remarks editor ----------
const remarksEditor = document.getElementById("remarks-editor");
const remarksTextarea = document.getElementById("remarks-text");
let remarksEditingTaskId = null;

function openRemarksEditor(mouseEvent, taskId) {
  const task = window.currentRows.find((r) => r._id === taskId);
  if (!task) return;
  remarksEditingTaskId = taskId;
  remarksTextarea.value = task.remarks || "";
  // position editor near mouse
  const x = mouseEvent.clientX + window.scrollX;
  const y = mouseEvent.clientY + window.scrollY;
  remarksEditor.style.left = x + 6 + "px";
  remarksEditor.style.top = y + 6 + "px";
  remarksEditor.style.display = "block";
  remarksTextarea.focus();

  // show/hide close button
  const closeBtn = document.getElementById("remarks-close-task");
  if ((task.status || "").toLowerCase() === "closed") {
    closeBtn.style.display = "none";
  } else closeBtn.style.display = "";
}

document.getElementById("remarks-save").addEventListener("click", async () => {
  const remarksText = remarksTextarea.value.trim();

  if (selectedTaskIds.length > 1) {
    // Multi-select: append to all selected tasks
    for (const id of selectedTaskIds) {
      const task = window.currentRows.find((r) => r._id === id);
      if (!task) continue;

      const existingRemarks = task.remarks?.trim() || "";
      const newRemarks = existingRemarks
        ? `${existingRemarks}\n${remarksText}` // append on new line
        : remarksText;

      await updateTask(id, { remarks: newRemarks });
    }
  } else if (remarksEditingTaskId) {
    // Single task mode (replace)
    await updateTask(remarksEditingTaskId, { remarks: remarksText });
  }

  // Close the editor and clear selection
  remarksEditor.style.display = "none";
  remarksEditingTaskId = null;
  selectedTaskIds = [];
  document
    .querySelectorAll(".task-selected")
    .forEach((el) => el.classList.remove("task-selected"));
});

document.getElementById("remarks-cancel").addEventListener("click", () => {
  remarksEditor.style.display = "none";
  remarksEditingTaskId = null;
});
document
  .getElementById("remarks-close-task")
  .addEventListener("click", async () => {
    const remarksText = remarksTextarea.value.trim();

    // Must have at least one matrix date
    if (!actionDayKey && taskActionDayMap.size === 0) {
      alert("Please click a date cell in the matrix before closing.");
      return;
    }

    /* =========================
       BULK CLOSING MODE
    ========================== */
    if (bulkClosingMode) {
      for (const id of selectedTaskIds) {
        const task = window.currentRows.find((r) => r._id === id);
        if (!task) continue;

        // ✅ PER-TASK DATE (fallback to last clicked)
        const closeDateKey = taskActionDayMap.get(id) ?? actionDayKey;

        if (!closeDateKey) {
          alert(`No date selected for "${task.tasktitle}"`);
          continue;
        }

        // ⛔ Parent check
        if (task.dependencies?.length) {
          const parents = task.dependencies
            .map((pid) => window.currentRows.find((r) => r._id === pid))
            .filter(Boolean);

          const openParents = parents.filter(
            (p) => !p.status || p.status.toLowerCase() !== "closed",
          );

          if (openParents.length) {
            alert(
              `❌ Cannot close "${task.tasktitle}".\nParent tasks still open.`,
            );
            return;
          }
        }

        const resolvedStatus = resolveStatusOnClose(task, closeDateKey);
        const closedDateISO = dayKeyToISO(closeDateKey);

        const ref = doc(db, "tasks", task._id);
        const snap = await getDoc(ref);

        const existingDates = snap.exists()
          ? snap.data().datesclosed || ""
          : "";

        const datesArray = existingDates
          ? existingDates.split(",").map((d) => d.trim())
          : [];

        if (datesArray.includes(closedDateISO)) continue;

        const datesClosedValue = datesArray.length
          ? `${existingDates}, ${closedDateISO}`
          : closedDateISO;

        await updateTask(task._id, {
          status: resolvedStatus,
          remarks: remarksText,
          datesclosed: datesClosedValue,
        });
      }

      clearSelection();
      bulkClosingMode = false;
      taskActionDayMap.clear();
      actionDayKey = null;
      remarksEditor.style.display = "none";
      remarksEditingTaskId = null;
    } else if (remarksEditingTaskId) {
      /* =========================
       SINGLE TASK CLOSING
    ========================== */
      const task = window.currentRows.find(
        (r) => r._id === remarksEditingTaskId,
      );
      if (!task) return;

      if (!actionDayKey) {
        alert("Please click a date cell in the matrix before closing.");
        return;
      }

      const closeDateKey = actionDayKey;
      const resolvedStatus = resolveStatusOnClose(task, closeDateKey);
      const closedDateISO = dayKeyToISO(closeDateKey);

      const ref = doc(db, "tasks", task._id);
      const snap = await getDoc(ref);

      const existingDates = snap.exists() ? snap.data().datesclosed || "" : "";

      const datesArray = existingDates
        ? existingDates.split(",").map((d) => d.trim())
        : [];

      if (datesArray.includes(closedDateISO)) {
        remarksEditor.style.display = "none";
        remarksEditingTaskId = null;
        return;
      }

      const datesClosedValue = datesArray.length
        ? `${existingDates}, ${closedDateISO}`
        : closedDateISO;

      await updateTask(task._id, {
        status: resolvedStatus,
        remarks: remarksText,
        datesclosed: datesClosedValue,
      });

      remarksEditor.style.display = "none";
      remarksEditingTaskId = null;
      actionDayKey = null;
      clearSelection();
      bulkClosingMode = false;
      taskActionDayMap.clear();
    }
  });

///new***********************
let selectedTaskIds = [];
let bulkClosingMode = false;
let bulkActionAnchorTaskId = null;

document.addEventListener("click", (e) => {
  if (e.target.closest(".task-block")) return;
  if (e.target.closest("#remarks-editor")) return;
  if (e.target.closest("#bulk-action-modal")) return;
  if (e.target.closest("#task-modal")) return;
  clearSelection();
});

document.addEventListener("click", (e) => {
  const taskDiv = e.target.closest(".task-block");
  if (!taskDiv) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const tid = taskDiv.dataset.taskId;

  // Prevent selecting closed tasks
  const task = window.currentRows.find((r) => r._id === tid);
  if (task && (task.status || "").toLowerCase() === "closed") {
    return; // Ignore clicks on closed tasks
  }

  if (e.ctrlKey) {
    // Toggle selection
    if (selectedTaskIds.includes(tid)) {
      selectedTaskIds = selectedTaskIds.filter((id) => id !== tid);
      taskDiv.classList.remove("task-selected");
    } else {
      selectedTaskIds.push(tid);
      taskDiv.classList.add("task-selected");
    }
  } else {
    // Clear selection and select only this task
    document
      .querySelectorAll(".task-selected")
      .forEach((el) => el.classList.remove("task-selected"));
    selectedTaskIds = [tid];
    taskDiv.classList.add("task-selected");
  }
});

function clearSelection() {
  document
    .querySelectorAll(".task-selected")
    .forEach((el) => el.classList.remove("task-selected"));
  selectedTaskIds = [];
}

// Clear selection when clicking anywhere that's NOT a task, remarks, or bulk-close modal
document.addEventListener("click", (e) => {
  if (
    e.target.closest(".task-block") ||
    e.target.closest("#remarks-editor") ||
    e.target.closest("#bulk-action-modal")
  )
    // <-- ADD THIS LINE
    return;
  clearSelection();
});

// hide editor when clicking outside
document.addEventListener("click", (ev) => {
  if (!remarksEditor.contains(ev.target)) {
    remarksEditor.style.display = "none";
    remarksEditingTaskId = null;
  }
});

// ---------- Modal edit / add ----------
const modal = document.getElementById("task-modal");
const modalTitle = document.getElementById("modal-title");
const f = {
  taskid: document.getElementById("f-taskid"),
  skill: document.getElementById("f-skill"),
  start: document.getElementById("f-start"),
  end: document.getElementById("f-end"),
  rev_sdate: document.getElementById("f-rev_sdate"),
  rev_edate: document.getElementById("f-rev_edate"),
  tasktitle: document.getElementById("f-tasktitle"),
  acreg: document.getElementById("f-acreg"),
  remarks: document.getElementById("f-remarks"),
  statusOpen: document.getElementById("f-status-open"),
  statusClosed: document.getElementById("f-status-closed"),
  workorder: document.getElementById("f-workorder"),
};
let modalEditingId = null;
// Get the new Bulk Action Modal elements
const bulkActionModal = document.getElementById("bulk-action-modal");
const bulkActionDate = document.getElementById("bulk-action-date");
const bulkActionRemarks = document.getElementById("bulk-action-remarks");
const bulkActionCancel = document.getElementById("bulk-action-cancel");
const bulkEditDetails = document.getElementById("bulk-edit-details");
const bulkCloseConfirm = document.getElementById("bulk-close-confirm");
const bulkReplanConfirm = document.getElementById("bulk-replan-confirm");
const bulkNewPlanConfirm = document.getElementById("bulk-new-plan-confirm");
// document.getElementById('add-task-btn').addEventListener('click', () => openTaskModal(null));
document
  .getElementById("cancel-modal")
  .addEventListener("click", closeTaskModal);
document
  .getElementById("delete-task-btn")

  .addEventListener("click", async () => {
    if (!modalEditingId) {
      alert("No milestone selected to delete");
      return;
    }
    if (!confirm("Delete this milestone?")) return;
    await deleteTask(modalEditingId);
    closeTaskModal();
  });
document
  .getElementById("save-modal")

  .addEventListener("click", async () => {
    const payload = {
      taskid: f.taskid.value || undefined,
      skill: f.skill.value || undefined,
      start: f.start.value || undefined,
      end: f.end.value || undefined,
      rev_sdate: f.rev_sdate.value || undefined,
      rev_edate: f.rev_edate.value || undefined,
      title: f.tasktitle.value || undefined,
      acreg: f.acreg.value || undefined,
      remarks: f.remarks.value,
      status: f.statusClosed.checked ? "Closed" : "open",
      workorder: f.workorder.value || undefined,
    };
    if (payload.status.toLowerCase() === "open") {
      payload.datesclosed = "";
    }

    // ⛔ MUST RUN BEFORE any updateTask()
    // ---------------------------------------
    if (modalEditingId && payload.status === "Closed") {
      const task = window.currentRows.find((t) => t._id === modalEditingId);

      if (task && task.dependencies && task.dependencies.length > 0) {
        const parents = task.dependencies
          .map((pid) => window.currentRows.find((t) => t._id === pid))
          .filter(Boolean);

        const openParents = parents.filter(
          (p) => !p.status || p.status.toLowerCase() !== "closed",
        );

        if (openParents.length > 0) {
          const names = openParents.map((p) => p.tasktitle || p._id).join(", ");

          alert(
            `❌ Cannot close "${task.tasktitle}".\n` +
              `It has parent tasks still OPEN:\n${names}`,
          );
          closeTaskModal();
          return; // ⛔ STOP — DO NOT SAVE ANY UPDATE
        }
      }
    }
    // ---------------------------------------

    // ✔️ Only update after dependency check passes
    if (modalEditingId) {
      await updateTask(modalEditingId, payload);
    } else {
      if (payload.taskid) {
        payload._id = payload.taskid;
        await createTask(payload);
      } else {
        await createTask(payload);
      }
    }

    closeTaskModal();
  });

// --- New Bulk Action Modal Listeners ---

bulkActionCancel.addEventListener("click", () => {
  bulkActionModal.style.display = "none";
  bulkActionAnchorTaskId = null;
});

// Allow switching from Action Modal -> Full Edit Modal
bulkEditDetails.addEventListener("click", () => {
  // Close the action modal
  bulkActionModal.style.display = "none";

  // Find the task (it's stored in the anchor ID)
  const task = window.currentRows.find((r) => r._id === bulkActionAnchorTaskId);

  // Clear selection logic
  clearSelection();
  bulkActionAnchorTaskId = null;

  // Open the full editor
  if (task) {
    openTaskModal(task);
  }
});

// "Confirm Close" button logic (this is your existing logic)

async function performRelativeMove(isNewPlan = false) {
  const dateStr = bulkActionDate.value;
  const remarks = bulkActionRemarks.value;

  // --- 1. Get New Start Date (from modal) ---
  if (!dateStr) {
    alert("Please select an Action Date.");
    return;
  }
  const newStartDate = parseDateField(dateStr);
  if (!newStartDate || isNaN(newStartDate.getTime())) {
    alert("Invalid date format.");
    return;
  }
  const newStartDateKey = toSerialDayKey(newStartDate);

  // --- 2. Find the Anchor Task and Calculate the Date Shift ---
  const anchorTask = window.currentRows.find(
    (r) => r._id === bulkActionAnchorTaskId,
  );
  if (!anchorTask) {
    alert("Error: Anchor milestone not found. Cannot perform relative replan.");
    return;
  }
  const anchorOrigSDate = parseDateField(anchorTask.start);
  if (!anchorOrigSDate) {
    alert(
      "Error: Anchor milestone is missing its original start date (start).",
    );
    return;
  }
  const anchorOrigSKey = toSerialDayKey(anchorOrigSDate);
  const dateShift = newStartDateKey - anchorOrigSKey;

  // --- 3. Loop and Replan ALL Selected Tasks ---
  for (const id of selectedTaskIds) {
    const task = window.currentRows.find((r) => r._id === id);
    if (!task) continue;

    const start = parseDateField(task.start);
    const end = parseDateField(task.end);
    let duration = 0;

    if (start && end) {
      const taskOrigSKey = toSerialDayKey(start);
      const taskOrigEKey = toSerialDayKey(end);
      duration = taskOrigEKey - taskOrigSKey;
      if (duration < 0) duration = 0;

      const newSKey = taskOrigSKey + dateShift;
      const newEKey = newSKey + duration;
      const newS_ISO = dayKeyToISO(newSKey);
      const newE_ISO = dayKeyToISO(newEKey);

      // --- Build the Update Payload ---
      const updatePayload = {
        start: newS_ISO,
        end: newE_ISO,
        rev_sdate: newS_ISO,
        rev_edate: newE_ISO,
        remarks: remarks,
        //status: "open",
      };

      // THIS IS THE KEY LOGIC
      if (isNewPlan) {
        // "New Plan" button: Erase history
        updatePayload.orig_sdate = null;
        updatePayload.status = task.status;
      } else {
        // "Replan" button: Create history if it doesn't exist
        if (!task.orig_sdate && task.start) {
          updatePayload.orig_sdate = task.start;
          updatePayload.status = task.status;
        }
      }
      // --- End Payload ---

      await updateTask(id, updatePayload);
    } else {
      console.warn(`Skipping task ${task._id}, missing start or end.`);
    }
  }

  bulkActionModal.style.display = "none";
  clearSelection();
  bulkActionAnchorTaskId = null; // Clear the anchor
}

// "Confirm Replan" button (blue) now calls the helper
bulkReplanConfirm.addEventListener("click", () => {
  performRelativeMove(false); // false = NOT a new plan, so keep history
});

// "New Plan" button (yellow) now calls the helper
bulkNewPlanConfirm.addEventListener("click", () => {
  performRelativeMove(true); // true = IS a new plan, so erase history
});
// ---------- VVV ADD THIS ENTIRE FUNCTION VVV ----------

async function addTasksToCurrentWO(newTasks) {
  // 1. Get the globally selected Work Order
  const currentWO = woFilterValue; // This variable exists in your code

  // 2. Validation: Stop if no WO is selected
  if (!currentWO || currentWO === "") {
    alert(
      "Error: No Work Order selected. Please select a WO from the dropdown first.",
    );
    return;
  }

  // 3. Get the Aircraft Reg (AC Reg) automatically
  const currentAC =
    window.currentAcregs && window.currentAcregs.length > 0
      ? window.currentAcregs[0]
      : "";

  // 4. Loop and Create
  for (const task of newTasks) {
    try {
      // Construct the full payload
      const payload = {
        title: task.title || "Untitled",
        skill: task.skill || "GEN", // Default skill if missing

        // Dates (ensure they are YYYY-MM-DD strings)
        start: task.start,
        end: task.end,
        rev_sdate: task.start, // Default revised to same as plan
        rev_edate: task.end,

        // The Automatic Parts
        workorder: currentWO,
        acreg: currentAC,
        status: "open",
      };

      await createTask(payload); // Assumes createTask function exists
    } catch (err) {
      console.error(`Failed to add task "${task.title}":`, err);
    }
  }
}
// This array will hold the tasks before we save them
let taskQueue = [];
let userHasManuallySetEndDate = false;
// Get all the new elements
const batchAddModal = document.getElementById("batch-add-modal");
const openBatchAddBtn = document.getElementById("open-batch-add-btn");
const batchAddCancel = document.getElementById("batch-add-cancel");
const addToQueueBtn = document.getElementById("add-to-queue-btn");
const batchSaveAllBtn = document.getElementById("batch-save-all-btn");
const taskQueueList = document.getElementById("task-queue-list");
const queueCountEl = document.getElementById("queue-count");

// Form Inputs
const b = {
  title: document.getElementById("b-tasktitle"),
  skill: document.getElementById("b-skill"),
  start: document.getElementById("b-start"),
  end: document.getElementById("b-end"),
};

// 1. When Start Date changes:
b.start.addEventListener("change", () => {
  // If user hasn't manually set an end date, link them.
  if (!userHasManuallySetEndDate) {
    b.end.value = b.start.value;
  } else {
    // If user HAS set a date, just make sure it's not invalid
    if (b.end.value < b.start.value) {
      b.end.value = b.start.value;
    }
  }
});

// 2. When End Date changes, set the flag
b.end.addEventListener("change", () => {
  // As soon as the user changes the end date, we set the flag.
  // We add a small check to not set the flag if the dates are the same.
  if (b.end.value !== b.start.value) {
    userHasManuallySetEndDate = true;
  }
});

// --- Helper function to re-draw the queue list ---
function renderTaskQueue() {
  taskQueueList.innerHTML = "";
  queueCountEl.textContent = taskQueue.length;

  if (taskQueue.length === 0) {
    taskQueueList.innerHTML =
      '<p style="color: #888; font-size: 13px;">Queue is empty.</p>';
    return;
  }

  taskQueue.forEach((task, index) => {
    const item = document.createElement("div");
    item.className = "queue-item";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "6px 8px";
    item.style.border = "1px solid #ccc";
    item.style.borderRadius = "6px";
    item.style.marginBottom = "6px";
    item.style.background = "#f7f7f7";

    item.innerHTML = `
              <div>
                <strong>${task.title}</strong><br>
                <span style="font-size:12px;">
                  Skill: ${task.skill} |
                  Start: ${task.start} |
                  End: ${task.end}
                </span>
              </div>

              <div style="display:flex; gap:6px;">
                <button class="queue-edit-btn" data-index="${index}"
                  style="background:#05164d; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">
                  Edit
                </button>

                <button class="queue-remove-btn" data-index="${index}"
                  style="background:#dc2626; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">
                  Remove
                </button>
              </div>
            `;

    taskQueueList.appendChild(item);
  });

  // Attach edit/remove events
  document.querySelectorAll(".queue-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      taskQueue.splice(i, 1);
      renderTaskQueue();
    });
  });

  document.querySelectorAll(".queue-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      loadTaskIntoForm(i);
    });
  });
}
function loadTaskIntoForm(index) {
  const task = taskQueue[index];
  if (!task) return;

  editingQueueIndex = index;

  b.title.value = task.title;
  b.skill.value = task.skill;
  b.start.value = task.start;
  b.end.value = task.end;

  addToQueueBtn.textContent = "Update Task";
  addToQueueBtn.style.background = "#f59e0b";
}
//addToQueueBtn.onclick = addTaskToQueueDefault;
function resetBatchForm() {
  b.title.value = "";
  b.skill.value = "";
  const today = dayKeyToISO(toSerialDayKey(new Date()));
  b.start.value = today;
  b.end.value = today;
  userHasManuallySetEndDate = false;

  editingQueueIndex = null;
}
function addTaskToQueueDefault() {
  const task = {
    title: b.title.value.trim(),
    skill: b.skill.value.trim(),
    start: b.start.value,
    end: b.end.value,
  };

  if (!task.title || !task.skill || !task.start || !task.end) {
    alert("Please fill in Title, Skill, Start Date, and End Date.");
    return;
  }

  taskQueue.push(task);
  renderTaskQueue();
  resetBatchForm();
}

// 1. Open the batch modal
openBatchAddBtn.addEventListener("click", () => {
  // Check if a WO is selected
  if (!woFilterValue || woFilterValue === "") {
    alert("Please select a Work Order from the dropdown first.");
    return;
  }
  userHasManuallySetEndDate = false;
  taskQueue = []; // Clear the queue
  renderTaskQueue(); // Re-draw the empty list

  // Set default date to today
  const todayISO = dayKeyToISO(toSerialDayKey(new Date()));
  b.start.value = todayISO;
  b.end.value = todayISO;
  b.title.value = "";
  b.skill.value = "";

  batchAddModal.style.display = "flex";
  b.title.focus();
});

// 2. Add a single task to the queue
addToQueueBtn.addEventListener("click", () => {
  const title = b.title.value.trim();
  const skill = b.skill.value;
  const start = b.start.value;
  const end = b.end.value;

  // VALIDATION — this was failing before because fields were undefined
  if (!title || !skill || !start || !end) {
    alert("Please fill in Title, Skill, Start Date, and End Date.");
    return;
  }

  if (editingQueueIndex === null) {
    // NORMAL ADD MODE
    taskQueue.push({ title, skill, start, end });
  } else {
    // EDIT MODE
    taskQueue[editingQueueIndex] = { title, skill, start, end };
    editingQueueIndex = null;

    // Restore button
    addToQueueBtn.textContent = "Add to Queue";
    addToQueueBtn.style.background = "";
  }

  renderTaskQueue();
});

// 3. Save the entire queue to Firestore
batchSaveAllBtn.addEventListener("click", async () => {
  if (isBatchSaving) return; // ⛔ Prevent duplicate clicks immediately
  if (taskQueue.length === 0) {
    alert("Queue is empty. Nothing to save.");
    return;
  }

  isBatchSaving = true; // 🔒 Lock
  batchSaveAllBtn.disabled = true; // 🔒 Disable button
  batchSaveAllBtn.textContent = "Saving..."; // UX feedback

  try {
    await addTasksToCurrentWO(taskQueue);

    // Close and reset
    batchAddModal.style.display = "none";
    taskQueue = [];
  } catch (err) {
    console.error("Batch save failed:", err);
    alert("Error saving tasks. Please try again.");
  }

  // 🔓 Unlock and restore UI
  isBatchSaving = false;
  batchSaveAllBtn.disabled = false;
  batchSaveAllBtn.textContent = "Save All";
});

// 4. Cancel and close the modal
batchAddCancel.addEventListener("click", () => {
  if (
    taskQueue.length > 0 &&
    !confirm(
      "You have milestone in the queue. Are you sure you want to cancel?",
    )
  ) {
    return; // Do not close
  }
  batchAddModal.style.display = "none";
  taskQueue = [];
});

function openTaskModal(task) {
  modalEditingId = null;
  modalTitle.textContent = task ? "Edit Milestone" : "Add Milestone";
  // reset
  // Reset inputs (but skip radio buttons so we don't wipe their values)
  Object.values(f).forEach((inp) => {
    if (inp && inp.type !== "radio") inp.value = "";
  });
  document.getElementById("delete-task-btn").style.display = task ? "" : "none";
  if (task) {
    modalEditingId = task._id;
    f.taskid.value = task.taskid || task._id;
    f.skill.value = task.skill || "";
    f.start.value =
      task.start || task._sdate
        ? task.start || task._sdate.toISOString().slice(0, 10)
        : "";
    f.end.value =
      task.end || task._edate
        ? task.end || task._edate.toISOString().slice(0, 10)
        : "";
    f.rev_sdate.value =
      task.rev_sdate || task._rev_sdate
        ? task.rev_sdate || task._rev_sdate.toISOString().slice(0, 10)
        : "";
    f.rev_edate.value =
      task.rev_edate || task._rev_edate
        ? task.rev_edate || task._rev_edate.toISOString().slice(0, 10)
        : "";
    f.tasktitle.value = task.tasktitle || "";
    f.acreg.value = task.acreg || "";
    f.remarks.value = task.remarks || "";
    // CHANGED: Set the correct radio button
    const currentStatus = (task.status || "open").toLowerCase();
    if (currentStatus === "closed") {
      f.statusClosed.checked = true;
    } else {
      f.statusOpen.checked = true;
    }
    f.workorder.value = task.workorder || "";
  }
  // Ensure Open is default for new tasks
  if (!task) f.statusOpen.checked = true;
  modal.style.display = "flex";
}
function closeTaskModal() {
  modal.style.display = "none";
  modalEditingId = null;
}

const tableContainer = document.getElementById("matrix-container");

let isPanning = false;
let startX, startY, scrollLeft, scrollTop;

tableContainer.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // left click only
  isPanning = true;
  tableContainer.style.cursor = "grabbing";
  startX = e.pageX - tableContainer.offsetLeft;
  startY = e.pageY - tableContainer.offsetTop;
  scrollLeft = tableContainer.scrollLeft;
  scrollTop = tableContainer.scrollTop;
});

tableContainer.addEventListener("mousemove", (e) => {
  // Only pan if left button is still held
  if (!isPanning || e.buttons !== 1) return;

  e.preventDefault();
  const x = e.pageX - tableContainer.offsetLeft;
  const y = e.pageY - tableContainer.offsetTop;
  const walkX = x - startX;
  const walkY = y - startY;
  tableContainer.scrollLeft = scrollLeft - walkX;
  tableContainer.scrollTop = scrollTop - walkY;
});

// Stop on mouseup anywhere
window.addEventListener("mouseup", () => {
  isPanning = false;
  tableContainer.style.cursor = "default";
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "d" || e.key === "D")) {
    e.preventDefault();
    createDependencyFromSelection();
  }
});

async function createDependencyFromSelection() {
  if (selectedTaskIds.length < 2) {
    alert("Select at least two tasks.");
    return;
  }

  // Load row objects and sort by timeline
  const ordered = selectedTaskIds
    .map((id) => window.currentRows.find((t) => t._id === id))
    .filter(Boolean)
    .sort((a, b) => {
      const aStart = parseDateField(a.rev_sdate || a.start);
      const bStart = parseDateField(b.rev_sdate || b.start);
      return aStart - bStart;
    });

  // -------------------------------------------------------------------
  // CASE A — EXACTLY TWO TASKS (your original behavior)
  // -------------------------------------------------------------------
  if (ordered.length === 2) {
    const A = ordered[0];
    const B = ordered[1];

    if (doesCreateCycle(A._id, B._id)) {
      alert("❌ Cannot create dependency: circular dependency detected.");
      return;
    }

    const deps = Array.isArray(B.dependencies) ? [...B.dependencies] : [];
    if (!deps.includes(A._id)) deps.push(A._id);

    await updateTask(B._id, { dependencies: deps });

    alert(
      `Dependency created:\n"${B.tasktitle}" now depends on "${A.tasktitle}".`,
    );
    clearSelection();
    return;
  }

  // -------------------------------------------------------------------
  // CASE B — 3 OR MORE TASKS → SERIAL CHAIN
  // -------------------------------------------------------------------
  let chainMsg = "Serial dependency created:\n\n";

  for (let i = 0; i < ordered.length - 1; i++) {
    const parent = ordered[i];
    const child = ordered[i + 1];

    // Skip if cycle would be created
    if (doesCreateCycle(parent._id, child._id)) {
      alert(
        `❌ Skipping link: "${child.tasktitle}" → "${parent.tasktitle}" would cause a circular dependency.`,
      );
      continue;
    }

    const deps = Array.isArray(child.dependencies)
      ? [...child.dependencies]
      : [];
    if (!deps.includes(parent._id)) deps.push(parent._id);

    await updateTask(child._id, { dependencies: deps });
    chainMsg += `${parent.tasktitle} → ${child.tasktitle}\n`;
  }

  alert(chainMsg);
  clearSelection();
}

function doesCreateCycle(parentId, childId) {
  const visited = new Set();

  function dfs(taskId) {
    if (taskId === parentId) return true; // cycle found
    if (visited.has(taskId)) return false;

    visited.add(taskId);

    const t = window.currentRows.find((r) => r._id === taskId);
    if (!t || !Array.isArray(t.dependencies)) return false;

    return t.dependencies.some((dep) => dfs(dep));
  }

  return dfs(childId);
}

export function ensureTimelineRange(forceRecalculate = false) {
  // If already initialized and not forced, keep existing
  if (!forceRecalculate && window.minDate && window.maxDate) {
    return {
      minKey: toSerialDayKey(window.minDate),
      maxKey: toSerialDayKey(window.maxDate),
    };
  }

  // If we reach here, we MUST calculate min/max safely
  const validTasks = window.currentRows
    ? window.currentRows.filter((t) => t.start || t.rev_sdate)
    : [];

  if (validTasks.length === 0) {
    console.warn("⚠ Timeline cannot initialize — no tasks available yet");
    return { minKey: 0, maxKey: 0 };
  }

  const startKeys = validTasks
    .map((t) => parseDateField(t.rev_sdate || t.start))
    .filter(Boolean)
    .map(toSerialDayKey);

  const endKeys = validTasks
    .map((t) => parseDateField(t.rev_edate || t.end))
    .filter(Boolean)
    .map(toSerialDayKey);

  const minKey = Math.min(...startKeys);
  const maxKey = Math.max(...endKeys);

  window.minDate = dayKeyToDate(minKey);
  window.maxDate = dayKeyToDate(maxKey);

  return { minKey, maxKey };
}

let cascadeRenderPending = false;

const cascadeVisited = new Set();

async function cascadeDependents(parentId, dayShift) {
  if (dayShift === 0) return;

  if (cascadeVisited.has(parentId)) return; // ⭐ stop recursion loop
  cascadeVisited.add(parentId);

  const parent = window.currentRows.find((t) => t._id === parentId);
  if (!parent) return;

  const { minKey, maxKey } = ensureTimelineRange();

  const children = window.currentRows.filter(
    (t) => Array.isArray(t.dependencies) && t.dependencies.includes(parentId),
  );

  for (const child of children) {
    const revS = parseDateField(child.rev_sdate || child.start);
    const revE = parseDateField(child.rev_edate || child.end);
    if (!revS || !revE) continue;

    const startKey = toSerialDayKey(revS);
    const endKey = toSerialDayKey(revE);
    const duration = endKey - startKey;

    let newS = startKey + dayShift;
    let newE = newS + duration;

    // Clamp left boundary
    if (newS < minKey) {
      newS = minKey;
      newE = newS + duration;
    }
    // Clamp right boundary
    if (newE > maxKey) {
      newE = maxKey;
      newS = newE - duration;
    }

    await updateTask(child._id, {
      rev_sdate: dayKeyToISO(newS),
      rev_edate: dayKeyToISO(newE),
    });

    await cascadeDependents(child._id, dayShift);
  }

  // After ALL cascading is finished → trigger a single rebuild
  if (!cascadeRenderPending) {
    cascadeRenderPending = true;

    setTimeout(() => {
      cascadeRenderPending = false;
      ensureTimelineRange(true); // recalc min/max BEFORE rendering
      applyWOfilterAndRender(); // redraw the table completely
    }, 150); // slight delay groups multiple updates together ✔
  }
}

// ============================================================
// 🔥 OPTION B3 — TIMELINE CP USING EARLIEST SUCCESSOR START
// ============================================================
function computeCriticalPath(rows) {
  // --- Build map ---
  const tasks = {};
  rows.forEach((t) => {
    const s = parseDateField(t.rev_sdate ?? t.start);
    const e = parseDateField(t.rev_edate ?? t.end);
    const startKey = s ? toSerialDayKey(s) : null;
    const endKey = e ? toSerialDayKey(e) : startKey;

    tasks[t._id] = {
      id: t._id,
      startKey,
      endKey,
      parents: Array.isArray(t.dependencies) ? t.dependencies : [],
      children: [],
    };
  });

  // --- Build children (successor list) ---
  Object.values(tasks).forEach((t) => {
    t.parents.forEach((pid) => {
      if (tasks[pid]) tasks[pid].children.push(t.id);
    });
  });

  // Memo store
  const memo = {};

  function exploreForward(taskId) {
    if (memo[taskId]) return memo[taskId];

    const t = tasks[taskId];
    if (!t) return null;

    // If no successors → this is an endpoint
    if (t.children.length === 0) {
      memo[taskId] = {
        chain: [taskId],
        start: t.startKey,
        end: t.endKey,
      };
      return memo[taskId];
    }

    let best = null;

    // Explore successors
    for (const cId of t.children) {
      const child = exploreForward(cId);
      if (!child) continue;

      // SUCCESSOR DRIVEN TIMELINE:
      const start = Math.min(t.startKey, child.start);
      const end = Math.max(t.endKey, child.end);

      const candidate = {
        chain: [taskId, ...child.chain],
        start,
        end,
      };

      if (!best) best = candidate;
      else {
        const bestLen = best.end - best.start;
        const candLen = end - start;
        if (candLen > bestLen) best = candidate;
      }
    }

    memo[taskId] = best;
    return best;
  }

  // Evaluate all possible chains from all tasks
  let globalBest = null;

  Object.keys(tasks).forEach((id) => {
    const result = exploreForward(id);
    if (!result) return;
    const len = result.end - result.start;
    if (!globalBest || len > globalBest.end - globalBest.start) {
      globalBest = result;
    }
  });

  return globalBest ? globalBest.chain : [];
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "x" || e.key === "X")) {
    e.preventDefault();
    removeDependencyFromSelection();
  }
});

async function removeDependencyFromSelection() {
  if (selectedTaskIds.length < 2) {
    alert("Select at least TWO tasks to remove dependency links.");
    return;
  }

  const selectedSet = new Set(selectedTaskIds);
  const rows = window.currentRows;

  let removedCount = 0;

  // Loop through all selected tasks
  for (const tid of selectedTaskIds) {
    const task = rows.find((t) => t._id === tid);
    if (!task) continue;

    // Remove PARENT dependencies inside the selected group
    if (Array.isArray(task.dependencies)) {
      const newDeps = task.dependencies.filter((dep) => !selectedSet.has(dep));
      if (newDeps.length !== task.dependencies.length) {
        await updateTask(tid, { dependencies: newDeps });
        removedCount++;
      }
    }

    // Remove CHILD dependencies inside the selected group
    const children = rows.filter(
      (t) => Array.isArray(t.dependencies) && t.dependencies.includes(tid),
    );

    for (const child of children) {
      if (!selectedSet.has(child._id)) continue; // only modify inside group

      const newDepList = child.dependencies.filter((dep) => dep !== tid);
      await updateTask(child._id, { dependencies: newDepList });
      removedCount++;
    }
  }

  if (removedCount > 0) {
    alert(`Removed ${removedCount} dependency link(s) inside selection.`);
  } else {
    alert("No dependencies found among selected tasks.");
  }

  clearSelection();
}

function buildDependencyTooltip(task) {
  if (!task) return "";

  const tasks = window.currentRows;

  // ---- PARENTS ----
  let parentLines = "";
  if (Array.isArray(task.dependencies) && task.dependencies.length > 0) {
    parentLines = task.dependencies
      .map((pid) => {
        const t = tasks.find((x) => x._id === pid);
        return t ? `• ${t.tasktitle || "(no title)"}` : "";
      })
      .filter(Boolean)
      .join("\n");
  } else {
    parentLines = "• None";
  }

  // ---- CHILDREN ----
  const children = tasks.filter(
    (x) => Array.isArray(x.dependencies) && x.dependencies.includes(task._id),
  );

  let childLines = "";
  if (children.length > 0) {
    childLines = children
      .map((t) => `• ${t.tasktitle || "(no title)"}`)
      .join("\n");
  } else {
    childLines = "• None";
  }

  return (
    "\n\nDependencies:" +
    "\nParents:\n" +
    parentLines +
    "\nChildren:\n" +
    childLines
  );
}

document.addEventListener("keydown", async (e) => {
  // Must have selected tasks
  if (selectedTaskIds.length === 0) return;

  // Accept both Delete and Backspace (optional)
  if (e.key !== "Delete") return;

  // Prevent browser from navigating back
  e.preventDefault();

  const count = selectedTaskIds.length;

  // Confirmation
  if (!confirm(`Delete ${count} selected milestone(s)?`)) return;

  // Perform the delete
  for (const id of selectedTaskIds) {
    await deleteTask(id); // You already have this function
  }

  // Clear selection after deleting
  clearSelection();
});

document.addEventListener("click", (e) => {
  const taskDiv = e.target.closest(".task-block");
  if (!taskDiv) return;

  const tid = taskDiv.dataset.taskId;
  const task = window.currentRows.find((t) => t._id === tid);
  if (!task) return;

  // SHIFT + ALT = Only select CLOSED tasks
  if (e.shiftKey && e.altKey) {
    if ((task.status || "").toLowerCase() !== "closed") {
      return; // ignore open tasks
    }

    // Multi-select closed tasks only
    if (!selectedTaskIds.includes(tid)) {
      selectedTaskIds.push(tid);
      taskDiv.classList.add("task-selected");
    }

    return;
  }
});

document.addEventListener("keydown", async (e) => {
  // SHIFT + ALT + O
  if (e.key.toLowerCase() === "o" && e.shiftKey && e.altKey) {
    if (selectedTaskIds.length === 0) return;

    // Filter only CLOSED tasks
    const closedOnly = selectedTaskIds.filter((id) => {
      const t = window.currentRows.find((r) => r._id === id);
      return t && (t.status || "").toLowerCase() === "closed";
    });

    if (closedOnly.length === 0) {
      alert("No closed milestones selected to open.");
      return;
    }

    if (!confirm(`Open ${closedOnly.length} closed milestone(s)?`)) return;

    for (const id of closedOnly) {
      await updateTask(id, {
        status: "open",
        datesclosed: "",
        // keep dates unchanged
      });
    }

    clearSelection();
  }
});
export function applySkillCollapse(skill) {
  const rows = document.querySelectorAll(`tr[data-skill="${skill}"]`);

  rows.forEach((tr) => {
    if (collapsedSkills.has(skill)) {
      tr.style.display = "none"; // hide only this skill
    } else {
      tr.style.display = ""; // show only this skill
    }
  });
}

export function renderSkillToolbar(skills) {
  const bar = document.getElementById("skill-toolbar");
  bar.innerHTML = "";

  // keep the same order passed in `skills`
  skills.forEach((skill) => {
    const btn = document.createElement("button");
    btn.dataset.skill = skill;
    btn.textContent = skill;
    btn.style.padding = "4px 10px";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.border = "1px solid #cfcfcf";
    btn.style.transition = "background .12s, color .12s";

    // initial style from collapsedSkills set
    const isCollapsed = collapsedSkills.has(skill);
    btn.style.background = isCollapsed ? "#ddd" : "#05164d";
    btn.style.color = isCollapsed ? "#333" : "#fff";

    btn.addEventListener("click", () => {
      const skill = btn.dataset.skill;

      // 🔄 Toggle collapsed state
      if (collapsedSkills.has(skill)) {
        collapsedSkills.delete(skill);

        // 🔵 If becoming visible → add to skillDisplayOrder (at end)
        if (!skillDisplayOrder.includes(skill)) {
          skillDisplayOrder.push(skill);
        }
      } else {
        collapsedSkills.add(skill);

        // ⚪ If becoming hidden → remove from skillDisplayOrder
        skillDisplayOrder = skillDisplayOrder.filter((s) => s !== skill);
      }

      // 🔧 Update button color
      const nowCollapsed = collapsedSkills.has(skill);
      btn.style.background = nowCollapsed ? "#ddd" : "#05164d";
      btn.style.color = nowCollapsed ? "#333" : "#fff";

      // 🔄 Apply change to table rows
      applySkillCollapse(skill);

      // 👀 Special case: all skills hidden → show message
      const allHidden =
        window.availableSkills.length > 0 &&
        window.availableSkills.every((s) => collapsedSkills.has(s));

      const container = document.getElementById("matrix-container");

      if (allHidden) {
        container.innerHTML =
          '<div style="padding:12px;color:#777">No milestone visible — all skills hidden</div>';
      } else {
        // Re-render table with new skillDisplayOrder
        scheduleRender();
      }
    });

    bar.appendChild(btn);
  });
}
function shiftDatesClosed(datesclosed, dayShift) {
  if (!datesclosed || !dayShift) return datesclosed;

  const shifted = datesclosed
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((iso) => {
      const key = toSerialDayKey(parseDateField(iso));
      return dayKeyToISO(key + dayShift);
    });

  return shifted.join(", ");
}
