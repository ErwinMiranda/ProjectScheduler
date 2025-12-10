
import { daysBetween, addDays } from "./utils.js";
import { tasks, scale } from "./state.js";
import { saveTask } from "./firebase.js";
import { renderPage } from "./app.js"; // callback entry

export function makeDraggable(el){
    let dragging=false,mode=null,startX=0,origLeft=0,origWidth=0;
    const id=el.dataset.id;
    const LH=el.querySelector(".handle.left");
    const RH=el.querySelector(".handle.right");

    LH.addEventListener("mousedown",e=>start("left",e));
    RH.addEventListener("mousedown",e=>start("right",e));
    el.addEventListener("mousedown",e=>start("move",e));

    function start(m,e){
        dragging=true;
        mode=m;
        startX=e.clientX;
        origLeft=parseFloat(el.style.left)||0;
        origWidth=parseFloat(el.style.width)||scale;
        document.body.style.userSelect="none";

        window.addEventListener("mousemove",move);
        window.addEventListener("mouseup",end);
    }

    function move(e){
        if(!dragging) return;
        const dx=e.clientX-startX;
        if(mode==="move"){
            el.style.left=Math.max(0,origLeft+dx)+"px";
        } else if(mode==="left"){
            el.style.left=Math.max(0,origLeft+dx)+"px";
            el.style.width=Math.max(scale,origWidth-dx)+"px";
        } else {
            el.style.width=Math.max(scale,origWidth+dx)+"px";
        }
    }

    async function end(){
        dragging=false;
        document.body.style.userSelect="auto";
        window.removeEventListener("mousemove",move);
        window.removeEventListener("mouseup",end);

        const [minDate] = renderPage.getBounds();
        const t=tasks.find(x=>x.id===id);
        if(!t) return;

        const leftPx=parseFloat(el.style.left);
        const widthPx=parseFloat(el.style.width);

        const leftDays=Math.round(leftPx/scale);
        const spanDays=Math.max(1,Math.round(widthPx/scale));

        t.start=addDays(minDate,leftDays);
        t.end=addDays(t.start,spanDays-1);

        renderPage.applyDependencies();
        renderPage.refresh();
        await saveTask(t);
    }
}

