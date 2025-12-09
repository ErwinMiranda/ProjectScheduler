
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCMA528UF3Di50hAhK3ytMaRPTXo8_syDY",
  authDomain: "projectscheduler-ea4fe.firebaseapp.com",
  projectId: "projectscheduler-ea4fe",
  storageBucket: "projectscheduler-ea4fe.firebasestorage.app",
  messagingSenderId: "397430880860",
  appId: "1:397430880860:web:4c31f8b0f49afe7222c499",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
export const tasksCol = collection(db, "tasks");

export async function saveTask(task) {
  const ref = doc(db, "tasks", task.id);
  await updateDoc(ref, {
    title: task.title,
    start: task.start.toISOString(),
    end: task.end.toISOString(),
    depends: task.depends || "",
    updatedAt: serverTimestamp(),
  });
}

export async function addTask(wo, acreg, title, start, end, depends) {
  return await addDoc(tasksCol, {
    wo,
    acreg,
    title,
    start,
    end,
    depends,
    taskno: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export { onSnapshot, getDocs, query, where };
