
import { daysBetween, addDays, formatDate } from "./utils.js";
import { tasks, scale } from "./state.js";
import { drawDependencies } from "./deps.js";
import { makeDraggable } from "./drag.js";
import { enableDurationEditing } from "./edit.js";

export function render(taskLeftList, rowsRight, timelineHeader, depOverlay, minDate) {

    // clear
    taskLeftList.innerHTML="";
    rowsRight.innerHTML="";
    depOverlay.innerHTML="";

    // compute bounds
    const totalDays = daysBetween(minDate, getMaxDate(tasks)) + 1;
    const width = totalDays * scale;

    // build timeline header
    timelineHeader.innerHTML="";
    const head=document.createElement("div");
    head.style.display="flex";
    head.style.minWidth=width+"px";
    for(let i=0;i<totalDays;i++){
        const d=addDays(minDate,i);
        const cell=document.createElement("div");
        cell.style.width=scale+"px";
        cell.style.textAlign="center";
        cell.textContent=d.getDate();
        head.appendChild(cell);
    }
    timelineHeader.appendChild(head);

    // Build task rows + bars...
    tasks.forEach((t,idx)=>{
        // Same render logic you have, condensed...
        // Create left row
        const left=document.createElement("div");
        left.className="unified-row";
        left.innerHTML=`
            <div class="row-left">
                <div class="index">${idx+1}</div>
                <div class="task-title">${t.title}</div>
                <div class="task-dur" data-id="${t.id}">
                    <span class="dur-text">${daysBetween(t.start,t.end)+1}d</span>
                </div>
                <div class="task-dates">${formatDate(t.start)} → ${formatDate(t.end)}</div>
            </div>`;
        taskLeftList.appendChild(left);

        // Right row
        const right=document.createElement("div");
        right.className="unified-row";
        const cell=document.createElement("div");
        cell.className="row-right";
        const grid=document.createElement("div");
        grid.className="row-grid";
        grid.style.minWidth=width+"px";

        const bar=document.createElement("div");
        bar.className="bar";
        bar.dataset.id=t.id;
        const leftPx=daysBetween(minDate,t.start)*scale;
        const span=daysBetween(t.start,t.end)+1;
        bar.style.left=leftPx+"px";
        bar.style.width=(span*scale)+"px";
        bar.innerHTML=`
            <div class="handle left"></div>
            <div class="label">${t.title}</div>
            <div class="handle right"></div>`;
        
        grid.appendChild(bar);
        cell.appendChild(grid);
        right.appendChild(cell);
        rowsRight.appendChild(right);

        makeDraggable(bar);
    });

    // dependency redraw
    requestAnimationFrame(()=>drawDependencies(minDate,width,rowsRight));

    enableDurationEditing(taskLeftList);
}

