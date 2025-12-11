// woLoader.js — populates work order dropdown

import { getDocs } from "./firebase.js";
import { tasksCol } from "./firebase.js";

export async function loadWOList() {
  const woFilter = document.getElementById("woFilter");

  try {
    const snap = await getDocs(tasksCol);
    const unique = new Map();

    snap.forEach((d) => {
      const data = d.data();
      if (data.wo) unique.set(String(data.wo), data.acreg || "AC REG");
    });

    woFilter.innerHTML = `<option value="">Select Work Order</option>`;

    unique.forEach((acreg, wo) => {
      woFilter.innerHTML += `<option value="${wo}" data-acreg="${acreg}">
                ${wo} — ${acreg}
            </option>`;
    });
  } catch (err) {
    console.error("loadWOList failed", err);
  }
}
