// deps.js
import { daysBetween } from "./utils.js";
import { tasks, scale } from "./state.js";

export function drawDependencies(minDate, width, rowsRight) {
  const svgNS = "http://www.w3.org/2000/svg";

  const prev = rowsRight.querySelector("svg.__deps_svg");
  if (prev) prev.remove();

  if (!tasks.length) return;

  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("__deps_svg");
  svg.setAttribute("width", width+"px");
  svg.setAttribute("height", rowsRight.scrollHeight+"px");
  svg.style.position="absolute";
  svg.style.left="0px";
  svg.style.top="0px";
  svg.style.pointerEvents="none";

  tasks.forEach((t,i)=>{
    if(!t.depends) return;
    const p = tasks.find(x=>x.id===t.depends);
    if(!p) return;
    const pIndex = tasks.indexOf(p);
    const parentRow = rowsRight.children[pIndex];
    const childRow = rowsRight.children[i];
    if(!parentRow||!childRow) return;

    const px = (daysBetween(minDate,p.end)+1)*scale;
    const tx = daysBetween(minDate,t.start)*scale;
    const py = parentRow.offsetTop + parentRow.offsetHeight/2;
    const ty = childRow.offsetTop + childRow.offsetHeight/2;

    const path=document.createElementNS(svgNS,"path");
    path.setAttribute("d",`M ${px} ${py} C ${px+40} ${py} ${tx-40} ${ty} ${tx} ${ty}`);
    path.setAttribute("stroke","#94a3b8");
    path.setAttribute("fill","none");
    path.setAttribute("stroke-width","1.5");
    svg.appendChild(path);
  });
  rowsRight.appendChild(svg);
}
/ deps.js placeholder
