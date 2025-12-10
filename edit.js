
import { daysBetween, addDays } from "./utils.js";
import { tasks } from "./state.js";
import { saveTask } from "./firebase.js";
import { renderPage } from "./app.js";

export function enableDurationEditing(taskLeftList){
    taskLeftList.querySelectorAll(".task-dur").forEach(cell=>{
        cell.onclick=()=>{
            const id=cell.dataset.id;
            const t=tasks.find(x=>x.id===id);
            if(!t || cell.querySelector("input")) return;

            const cur=daysBetween(t.start,t.end)+1;
            cell.innerHTML=`<input type="number" min="1" value="${cur}">`;

            const input = cell.querySelector("input");
            input.focus();
            input.select();
            const commit=()=>{
                const v=Math.max(1,Number(input.value));
                t.end=addDays(t.start,v-1);
                renderPage.applyDependencies();
                renderPage.refresh();
                saveTask(t);
            };
            input.addEventListener("blur",commit,{once:true});
            input.addEventListener("keydown",e=>{
                if(e.key==="Enter") input.blur();
                if(e.key==="Escape") renderPage.refresh();
            });
        };
    });
}

