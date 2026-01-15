// firebase.js — shared Firebase access module (ONLINE + OFFLINE SUPPORT)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  onSnapshot,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* -------------------------------------------
   Firebase Init
-------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCMA528UF3Di50hAhK3ytMaRPTXo8_syDY",
  authDomain: "projectscheduler-ea4fe.firebaseapp.com",
  projectId: "projectscheduler-ea4fe",
  storageBucket: "projectscheduler-ea4fe.firebasestorage.app",
  messagingSenderId: "397430880860",
  appId: "1:397430880860:web:4c31f8b0f49afe7222c499",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const tasksCol = collection(db, "tasks");

/* -------------------------------------------
   Add NEW Task (Legacy/Online Mode)
-------------------------------------------- */
export async function addTask(wo, acreg, title, start, end, dep) {
  return addDoc(tasksCol, {
    wo,
    acreg,
    title,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    status: "Open", // ✅ Added Default
    depends: dep,
    row: Date.now(),
    lagDays: 0,
    leadDays: 0,
    taskno: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

/* -------------------------------------------
   Save ONLINE updates for existing tasks
-------------------------------------------- */
export async function saveTask(task) {
  const ref = doc(db, "tasks", task.id);
  return updateDoc(ref, {
    wo: task.wo,
    acreg: task.acreg,
    title: task.title || "",
    start: task.start.toISOString(),
    end: task.end.toISOString(),
    status: task.status || "Open", // ✅ Added
    skill: data.skill || "",
    remarks: data.remarks || "",
    depends: task.depends || "",
    depType: task.depType || "FS",
    row: task.row || 0,
    lagDays: Number(task.lagDays) || 0,
    leadDays: Number(task.leadDays) || 0,
    taskno: task.taskno || Date.now(),
    updatedAt: serverTimestamp(),
    color: task.color || "", // Fixed 't.color' typo
  });
}

/* -------------------------------------------
   REALTIME Listener (Compatibility)
-------------------------------------------- */
export function listenTasksByWO(wo, callback) {
  const q = query(tasksCol, where("wo", "==", wo));

  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        wo: data.wo,
        acreg: data.acreg,
        title: data.title || "",
        start: new Date(data.start),
        end: new Date(data.end),
        status: data.status || "Open", // ✅ Added
        skill: data.skill || "",
        remarks: data.remarks || "",
        depends: data.depends || "",
        row: data.row || 0,
        lagDays: Number.isFinite(data.lagDays) ? data.lagDays : 0,
        leadDays: Number.isFinite(data.leadDays) ? data.leadDays : 0,
        taskno: data.taskno || 0,
        color: data.color || "",
      };
    });

    list.sort((a, b) => (a.row || 0) - (b.row || 0));
    callback(list);
  });
}

/* -------------------------------------------
   ONE-TIME Fetch (Offline-First Mode)
-------------------------------------------- */
export async function fetchTasksByWOOnce(wo) {
  const q = query(tasksCol, where("wo", "==", wo));
  const snap = await getDocs(q);

  const list = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      wo: data.wo,
      acreg: data.acreg,
      title: data.title || "",
      start: new Date(data.start),
      end: new Date(data.end),
      duration:
        data.duration ||
        Math.round((new Date(data.end) - new Date(data.start)) / 86400000) + 1,
      status: data.status || "Open",
      skill: data.skill || "",
      remarks: data.remarks || "",
      depends: data.depends || "",
      depType: data.depType || "FS",
      row: data.row || 0,
      lagDays: Number.isFinite(data.lagDays) ? data.lagDays : 0,
      leadDays: Number.isFinite(data.leadDays) ? data.leadDays : 0,
      taskno: data.taskno || 0,
      color: data.color || "",
    };
  });

  list.sort((a, b) => (a.row || 0) - (b.row || 0));
  return list;
}

/* -------------------------------------------
   BATCH SAVE (Offline → Upload)
-------------------------------------------- */
export async function batchSaveTasks(taskArray) {
  const results = {
    updated: 0,
    created: 0,
    createdMap: {}, // local index → Firestore ID
  };

  for (let i = 0; i < taskArray.length; i++) {
    const t = taskArray[i];

    const duration =
      t.duration ||
      Math.round((new Date(t.end) - new Date(t.start)) / 86400000) + 1;

    const payload = {
      wo: t.wo || "",
      acreg: t.acreg || "",
      title: t.title || "",
      start:
        t.start instanceof Date
          ? t.start.toISOString()
          : new Date(t.start).toISOString(),
      end:
        t.end instanceof Date
          ? t.end.toISOString()
          : new Date(t.end).toISOString(),
      duration,
      status: t.status || "Open",
      skill: t.skill || "",
      remarks: t.remarks || "",
      depends: t.depends || "",
      depType: t.depType || "FS",
      lagDays: Number(t.lagDays) || 0,
      leadDays: Number(t.leadDays) || 0,
      row: Number(t.row) || 0,
      taskno: t.taskno || Date.now(),
      color: t.color || "",
      updatedAt: serverTimestamp(),
    };

    try {
      const isLocal = String(t.id || "").startsWith("local-");

      if (!t.id) throw new Error("Task missing id during save");

      if (!isLocal) {
        // Existing task → UPDATE
        await updateDoc(doc(db, "tasks", t.id), payload);
        results.updated++;
      } else {
        // Local-only → CREATE
        const newRef = await addDoc(tasksCol, payload);
        results.created++;
        results.createdMap[i] = newRef.id;

        // Replace local ID with Firestore ID
        t.id = newRef.id;
      }
    } catch (err) {
      console.error("Error in batchSaveTasks @ index", i, err);
    }
  }

  return results;
}

/* -------------------------------------------
   Fetch Unique WO → acreg list
-------------------------------------------- */
export async function fetchUniqueWOList() {
  const snap = await getDocs(tasksCol);
  const map = new Map();

  snap.forEach((d) => {
    const data = d.data();
    if (data.wo) {
      map.set(String(data.wo), data.acreg || "AC REG");
    }
  });

  return [...map.entries()].map(([wo, acreg]) => ({
    wo,
    acreg,
  }));
}

/* -------------------------------------------
   Save as Templates
-------------------------------------------- */
export async function saveTemplateToFirestore(name, desc, tasks) {
  return addDoc(collection(db, "templates"), {
    name,
    desc,
    tasks,
    createdAt: new Date().toISOString(),
  });
}

export async function loadAllTemplates() {
  const snap = await getDocs(collection(db, "templates"));
  const list = [];
  snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
  return list;
}

/* -------------------------------------------
   DELETE Task (REQUIRED)
-------------------------------------------- */
export async function deleteTaskFromFirestore(taskId) {
  if (!taskId) return;
  const ref = doc(db, "tasks", taskId);
  await deleteDoc(ref);
}
