// Baby Log - Offline-only PWA using IndexedDB (no libraries)

const DB_NAME = "babylog_db";
const DB_VERSION = 1;
const STORE = "events";
const ACTIVE_FEED_KEY = "activeFeedId"; // stored in localStorage (simple)

const $ = (id) => document.getElementById(id);

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("by_startTs", "startTs");
      store.createIndex("by_type", "type");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addEvent(event) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(event);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function updateEvent(id, patch) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const obj = getReq.result;
      if (!obj) return reject(new Error("Event not found"));
      store.put({ ...obj, ...patch });
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteEvent(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function listEvents(limit = 200) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const index = store.index("by_startTs");
    const events = [];
    index.openCursor(null, "prev").onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || events.length >= limit) return resolve(events);
      events.push(cursor.value);
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString();
}

function durationMs(a, b) {
  const ms = Math.max(0, b - a);
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

function currentSide() {
  const el = document.querySelector('input[name="side"]:checked');
  return (el?.value ?? "") || null;
}

function setActiveFeed(id) {
  if (id == null) localStorage.removeItem(ACTIVE_FEED_KEY);
  else localStorage.setItem(ACTIVE_FEED_KEY, String(id));
  renderStatus();
}

function getActiveFeedId() {
  const v = localStorage.getItem(ACTIVE_FEED_KEY);
  return v ? Number(v) : null;
}

async function startFeed() {
  const startTs = Date.now();
  const side = currentSide();

  await addEvent({ type: "feed", startTs, endTs: null, side, notes: "" });
  const latest = (await listEvents(1))[0];
  setActiveFeed(latest?.id ?? null);
  await refresh();
}

async function stopFeed() {
  const id = getActiveFeedId();
  if (!id) return;
  await updateEvent(id, { endTs: Date.now() });
  setActiveFeed(null);
  await refresh();
}

async function logDiaper(type) {
  await addEvent({ type, startTs: Date.now(), endTs: null, side: null, notes: "" });
  await refresh();
}

async function undoLast() {
  const last = (await listEvents(1))[0];
  if (!last) return;

  if (last.type === "feed" && last.endTs == null && getActiveFeedId() === last.id) {
    setActiveFeed(null);
  }

  await deleteEvent(last.id);
  await refresh();
}

/* ------------------------------
   Manual Feed Modal (pickers)
-------------------------------- */

function isoDateLocal(d = new Date()) {
  // Local YYYY-MM-DD (not UTC)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hhmm(d = new Date()) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function parseLocalDateTime(dateStr, timeStr) {
  // Builds a local Date from "YYYY-MM-DD" + "HH:MM"
  const [y, mo, da] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!y || !mo || !da || Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
  return new Date(y, mo - 1, da, hh, mm, 0, 0).getTime();
}

function openManualModal() {
  // Defaults
  const now = new Date();
  const startDefault = new Date(now.getTime() - 20 * 60 * 1000); // 20 min ago

  $("mfDate").value = isoDateLocal(now);
  $("mfStart").value = hhmm(startDefault);
  $("mfEnd").value = hhmm(now);

  // side dropdown defaults from current radio selection
  $("mfSide").value = currentSide() ?? "";
  $("mfNotes").value = "manual";

  $("manualModal").classList.remove("hidden");
  $("mfStart").focus();
}

function closeManualModal() {
  $("manualModal").classList.add("hidden");
}

async function saveManualFromModal() {
  const dateStr = $("mfDate").value;
  const startStr = $("mfStart").value;
  const endStr = $("mfEnd").value;
  const side = $("mfSide").value || null;
  const notes = $("mfNotes").value || "";

  if (!dateStr || !startStr || !endStr) {
    alert("Please choose date, start time, and end time.");
    return;
  }

  const startTs = parseLocalDateTime(dateStr, startStr);
  let endTs = parseLocalDateTime(dateStr, endStr);

  if (Number.isNaN(startTs) || Number.isNaN(endTs)) {
    alert("Invalid date/time.");
    return;
  }

  // Crossing midnight handling
  if (endTs <= startTs) endTs += 24 * 60 * 60 * 1000;

  await addEvent({
    type: "feed",
    startTs,
    endTs,
    side,
    notes
  });

  closeManualModal();
  await refresh();
}

function bindManualModal() {
  // open
  $("manualFeedBtn").addEventListener("click", openManualModal);

  // close buttons
  $("manualCloseBtn").addEventListener("click", closeManualModal);
  $("manualCancelBtn").addEventListener("click", closeManualModal);

  // click outside modal to close
  $("manualModal").addEventListener("click", (e) => {
    if (e.target === $("manualModal")) closeManualModal();
  });

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("manualModal").classList.contains("hidden")) {
      closeManualModal();
    }
  });

  // save
  $("manualSaveBtn").addEventListener("click", saveManualFromModal);

  // Enter key saves if focus is inside modal inputs
  ["mfDate", "mfStart", "mfEnd", "mfSide", "mfNotes"].forEach(id => {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveManualFromModal();
    });
  });
}

async function lastOfTypes(types) {
  const events = await listEvents(300);
  return events.find(e => types.includes(e.type)) || null;
}

async function renderStatus() {
  const lastFeed = await lastOfTypes(["feed"]);
  const lastDiaper = await lastOfTypes(["wet", "soiled", "both"]);

  $("lastFeed").textContent = lastFeed
    ? (lastFeed.endTs
        ? `${fmtTime(lastFeed.startTs)} (${durationMs(lastFeed.startTs, lastFeed.endTs)})` + (lastFeed.side ? ` [${lastFeed.side}]` : "")
        : `${fmtTime(lastFeed.startTs)} (in progress)` + (lastFeed.side ? ` [${lastFeed.side}]` : ""))
    : "—";

  $("lastDiaper").textContent = lastDiaper
    ? `${fmtTime(lastDiaper.startTs)} (${lastDiaper.type})`
    : "—";

  const activeId = getActiveFeedId();
  $("activeFeed").textContent = activeId ? `#${activeId}` : "none";

  $("feedToggleBtn").textContent = activeId ? "⏹️ Stop Feed" : "▶️ Start Feed";
}

function typeLabel(t) {
  if (t === "feed") return "🍼 Feed";
  if (t === "wet") return "💧 Wet";
  if (t === "soiled") return "💩 Soiled";
  if (t === "both") return "💧💩 Both";
  return t;
}

async function renderHistory() {
  const events = await listEvents(300);
  if (!events.length) {
    $("history").textContent = "No entries yet.";
    return;
  }

  $("history").innerHTML = events.map(e => {
    const when = fmtTime(e.startTs);
    let detail = "";
    if (e.type === "feed") {
      detail = e.endTs ? `Duration: ${durationMs(e.startTs, e.endTs)}` : "In progress";
      if (e.side) detail += ` • Side: ${e.side}`;
      if (e.notes) detail += ` • Notes: ${e.notes}`;
    } else {
      if (e.notes) detail = `Notes: ${e.notes}`;
    }

    return `
      <div class="item">
        <div class="itemTop">
          <div><strong>${typeLabel(e.type)}</strong></div>
          <div class="tag">${when}</div>
        </div>
        ${detail ? `<div class="tag">${detail}</div>` : ""}
        <div class="row">
          <div class="tag">#${e.id}</div>
          <button class="btn btn-secondary" data-del="${e.id}" style="padding:8px 10px;font-size:14px;">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-del"));
      if (getActiveFeedId() === id) setActiveFeed(null);
      await deleteEvent(id);
      await refresh();
    });
  });
}

function eventsToCsv(events) {
  const header = ["id", "type", "startTs", "endTs", "side", "notes"];
  const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = events.map(e => header.map(k => escape(e[k])).join(","));
  return header.join(",") + "\n" + rows.join("\n");
}

async function exportCsv() {
  const events = await listEvents(5000);
  const csv = eventsToCsv([...events].reverse()); // oldest first

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `babylog_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function refresh() {
  await renderStatus();
  await renderHistory();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    console.warn("SW register failed", e);
  }
}

function bindUi() {
  $("wetBtn").addEventListener("click", () => logDiaper("wet"));
  $("soiledBtn").addEventListener("click", () => logDiaper("soiled"));
  $("bothBtn").addEventListener("click", () => logDiaper("both"));
  $("undoBtn").addEventListener("click", undoLast);

  $("feedToggleBtn").addEventListener("click", async () => {
    const active = getActiveFeedId();
    if (active) await stopFeed();
    else await startFeed();
  });

  $("exportBtn").addEventListener("click", exportCsv);

  $("clearBtn").addEventListener("click", async () => {
    const ok = confirm("Clear ALL entries? This cannot be undone.");
    if (!ok) return;
    setActiveFeed(null);
    await clearAll();
    await refresh();
  });

  bindManualModal();
}

await (async function main() {
  bindUi();
  await refresh();
  await registerServiceWorker();
})();
