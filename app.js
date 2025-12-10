

import { getDocs, onSnapshot, query, where } from "./firebase.js";
import { addTask } from "./firebase.js";
import { tasksCol } from "./firebase.js";
import { updateTaskList, tasks } from "./state.js";
import { addDays } from "./utils.js";
import { render } from "./renderer.js";

const woFilter = document.getElementById("woFilter");
const taskLeftList = document.getElementById("taskLeftList");
const rowsRight = document.getElementById("rowsRight");
const timelineHeader = document.getElementById("timelineHeader");
const depOverlay = document.getElementById("depOverlay");

let unsubscribe = null;

export function refresh() {
  const minDate = computeMinDate();
  render(taskLeftList, rowsRight, timelineHeader, depOverlay, minDate);
}

// Applies auto dependency shifting (moved here)
export function applyDependencies() {
  const map = Object.fromEntries(tasks.map(t=>[t.id,t]));
  let changed=true,safety=0;
  while(changed && safety++<50){
    changed=false;
    tasks.forEach(t=>{
      if(!t.depends) return;
      const p=map[t.depends];
      if(!p) return;
      const minStart=addDays(p.end,1);
      if(t.start<minStart){
        const dur=(t.end-t.start)/(86400000);
        t.start=minStart;
        t.end=addDays(t.start,dur);
        changed=true;
      }
    });
  }
}

function computeMinDate(){
  if(!tasks.length) return addDays(new Date(),-3);

  let min=tasks[0].start;
  tasks.forEach(t=>{ if(t.start<min) min=t.start;});
  return addDays(min,-3);
}

// Load tasks when WO changes
woFilter.addEventListener("change", async e=>{
  if(unsubscribe) unsubscribe();
  const wo=e.target.value;
  if(!wo){
    updateTaskList([]);
    refresh();
    return;
  }

  const q=query(tasksCol, where("wo","==",wo));
  unsubscribe=onSnapshot(q,snap=>{
    const newList=snap.docs.map(d=>({
      id:d.id,
      ...d.data(),
      start:new Date(d.data().start),
      end:new Date(d.data().end)
    }));
    updateTaskList(newList);
    applyDependencies();
    refresh();
  });
});

// adding tasks
document.getElementById("addTaskBtn").onclick = async () => {
  const wo = woFilter.value;
  if (!wo) return alert("Select WO first");

  const acreg = woFilter.selectedOptions[0].dataset.acreg;
  const title=document.getElementById("newTitle").value.trim();
  const s=document.getElementById("newStart").value;
  const e=document.getElementById("newEnd").value;
  const dep=document.getElementById("newDepends").value||"";

  if(!title||!s||!e) return;

  await addTask(wo,acreg,title,s,e,dep);
};

refresh();

