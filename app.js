// Baby Log - Option 1: Offline-only PWA using IndexedDB (no libraries)

const DB_NAME = "babylog_db";
const DB_VERSION = 1;
const STORE = "events";
const ACTIVE_FEED_KEY = "activeFeedId"; // stored in localStorage (small + simple)

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
  const d = new Date(ts);
  return d.toLocaleString();
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
  const notes = "";

  // Add event, then re-read last inserted by listing top 1.
  await addEvent({ type: "feed", startTs, endTs: null, side, notes });
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

  // If undoing an active feed start, clear active id.
  if (last.type === "feed" && last.endTs == null && getActiveFeedId() === last.id) {
    setActiveFeed(null);
  }

  await deleteEvent(last.id);
  await refresh();
}

async function lastOfTypes(types) {
  const events = await listEvents(200);
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
  const events = await listEvents(200);
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

  // bind delete buttons
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-del"));
      // If deleting active feed, clear it.
      if (getActiveFeedId() === id) setActiveFeed(null);
      await deleteEvent(id);
      await refresh();
    });
  });
}

function eventsToCsv(events) {
  const header = ["id","type","startTs","endTs","side","notes"];
  const escape = (v) => `"${String(v ?? "").replaceAll('"','""')}"`;
  const rows = events.map(e => header.map(k => escape(e[k])).join(","));
  return header.join(",") + "\n" + rows.join("\n");
}

async function exportCsv() {
  const events = await listEvents(5000);
  const csv = eventsToCsv([...events].reverse()); // oldest first

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0,10);
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
}

await (async function main() {
  bindUi();
  await refresh();
  await registerServiceWorker();
})();
