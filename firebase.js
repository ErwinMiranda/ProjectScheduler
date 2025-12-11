// firebase.js — shared Firebase access module

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  onSnapshot,
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
   Add a New Task
-------------------------------------------- */
export async function addTask(wo, acreg, title, start, end, dep) {
  return addDoc(tasksCol, {
    wo,
    acreg,
    title,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    depends: dep,
    row: Date.now(), // ⭐ new row ordering
    updatedAt: serverTimestamp(),
  });
}

/* -------------------------------------------
   Save Task Updates (date, title, dependency, row)
-------------------------------------------- */
export async function saveTask(task) {
  const ref = doc(db, "tasks", task.id);
  return updateDoc(ref, {
    title: task.title,
    start: task.start.toISOString(),
    end: task.end.toISOString(),
    depends: task.depends || "",
    row: task.row || 0, // ⭐ persist row position
    updatedAt: serverTimestamp(),
  });
}

/* -------------------------------------------
   Live Listener by Work Order
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
        depends: data.depends || "",
        row: data.row || 0, // ⭐ read row
      };
    });

    // ⭐ Sort by row ONLY
    list.sort((a, b) => (a.row || 0) - (b.row || 0));

    callback(list);
  });
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
