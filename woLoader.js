import { getDocs } from "./firebase.js";
import { tasksCol } from "./firebase.js";

export async function loadWOList() {
    console.log("🔥 loadWOList called");

    const woFilter = document.getElementById("woFilter");
    if (!woFilter) {
        console.warn("⚠ woFilter element NOT found in DOM");
        return;
    }

    try {
        const snap = await getDocs(tasksCol);
        console.log("📌 Firestore docs count:", snap.size);

        const unique = new Map();

        snap.forEach(doc => {
            console.log("➡ Reading doc:", doc.id, doc.data());
            const data = doc.data();
            if (data.wo) unique.set(String(data.wo), data.acreg || "AC REG");
        });

        console.log("🎯 Unique WO found:", [...unique]);

        woFilter.innerHTML = `<option value="">Select Work Order</option>`;

        unique.forEach((acreg, wo) => {
            woFilter.innerHTML += `
                <option value="${wo}" data-acreg="${acreg}">
                    ${wo} — ${acreg}
                </option>
            `;
        });

    } catch (err) {
        console.error("❌ loadWOList failed", err);
    }
}
